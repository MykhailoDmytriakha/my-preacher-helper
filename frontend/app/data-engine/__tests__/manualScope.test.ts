import { prepareDomainCommand } from '../domainPolicy';
import { ManualScope, type ManualCapture, type ManualPath, type ManualSavedIntent, type ManualScopePort, type ManualScopeRecord } from '../manualScope';
import { applyCommand, mergeFields } from '../protocol';
import { DataSession } from '../session';

import type { DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'sermons', id: 'sermon' };
const snapshot = (title = 'A', scratch = 'scratch0', revision = 1): ResourceSnapshot => ({ resource, value: { userId: 'owner', title, verse: '', date: '2026-09-12', thoughts: [], scratch: [{ id: 's', text: scratch, createdAt: '2026-09-12' }] }, metadata: { protocol: 1, generation: 'g', revision, deleted: false } });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const saved = (id: string, value: DocumentData, predecessorId: string | null = null): ManualSavedIntent => ({ id, owner: 'owner', resource, value: clone(value), predecessorId });
function fixture(selection: readonly ManualPath[] = [['title']]) {
  let current = true;
  let disk: ManualScopeRecord | undefined;
  const captured: ManualCapture = { checkpoint: new DataSession(snapshot()).checkpoint(), provenance: [], requests: [] };
  const persist = jest.fn(async (record: ManualScopeRecord) => { disk = clone(record); });
  const save = jest.fn<ReturnType<ManualScopePort['save']>, Parameters<ManualScopePort['save']>>(async (_scope, checkpoint, options) => saved(`request-${checkpoint.editGeneration}`, checkpoint.draft!, options.predecessorId ?? null));
  const options = { owner: 'owner', resource, scopeId: 'scope', selection, port: { capture: () => captured, isCurrent: () => current, persist, save } };
  return { options, captured, persist, save, disk: () => disk!, changeOwner: () => { current = false; } };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('manual form scope', () => {
  it('pins pristine A at open; remote C before first typing cannot become the Save baseline', async () => {
    const test = fixture();
    const scope = ManualScope.begin(test.options);
    test.captured.checkpoint = new DataSession(snapshot('C', 'remote scratch', 2)).checkpoint();
    await scope.update(value => ({ ...value, title: 'D' }));
    expect(test.save).not.toHaveBeenCalled();
    expect(test.disk()).toMatchObject({ kind: 'manual', baseline: { value: { title: 'A' } }, stage: [{ value: 'D' }] });
    await scope.save();
    const checkpoint = test.save.mock.calls[0][1];
    const command = prepareDomainCommand('owner', 'operation', checkpoint.confirmed, checkpoint.draft).command;
    const result = applyCommand(command, snapshot('C', 'remote scratch', 2));
    expect(result.kind).toBe('conflict');
    expect(scope.getState().record.baseline.value!.title).toBe('A');
  });

  it('chains queued title B to D without sending unsaved scratch C or replacing the true snapshot', async () => {
    const test = fixture();
    const first = saved('R1', snapshot('B').value!);
    test.captured.requests = [first];
    test.captured.provenance = [{ path: ['title'], requestId: 'R1' }];
    test.captured.checkpoint.draft = snapshot('B', 'unsaved C').value;
    const scope = ManualScope.begin(test.options);
    expect(scope.getState().value).toEqual(snapshot('B').value);
    await scope.update(value => ({ ...value, title: 'D' }));
    await scope.save();
    const [, captured, options] = test.save.mock.calls[0];
    expect(options).toEqual({ predecessorId: 'R1' });
    expect(captured.confirmed).toEqual(snapshot());
    expect(captured.draft).toEqual(snapshot('D').value);
    expect(test.captured.checkpoint.draft).toEqual(snapshot('B', 'unsaved C').value);
    // The shared queue performs its existing predecessor merge after ACK.
    const merged = mergeFields({ exists: true, value: first.value }, { exists: true, value: captured.draft! }, { exists: true, value: snapshot('B', 'remote sibling', 2).value! });
    expect(merged.conflicts).toEqual([]);
    expect(merged.value).toMatchObject({ value: snapshot('D', 'remote sibling', 2).value });
    await scope.cancel();
    await scope.reopen();
    await scope.update(value => ({ ...value, title: 'E' }));
    await scope.save();
    expect(test.save.mock.calls[1][2]).toEqual({ predecessorId: 'request-1' });
    expect(test.save.mock.calls[1][1].draft!.title).toBe('E');
  });

  it('treats saved unrelated predecessor fields as unchanged, not a new requested write', async () => {
    const test = fixture();
    const first = saved('R1', snapshot('B', 'saved S').value!);
    test.captured.requests = [first]; test.captured.provenance = [{ path: ['title'], requestId: 'R1' }];
    test.captured.checkpoint.draft = snapshot('B', 'unsaved C').value;
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, title: 'D' })); await scope.save();
    const value = test.save.mock.calls[0][1].draft!;
    expect(value).toEqual(snapshot('D', 'saved S').value);
    const merged = mergeFields({ exists: true, value: first.value }, { exists: true, value }, { exists: true, value: snapshot('B', 'server merged S').value! });
    expect(merged.value).toMatchObject({ value: snapshot('D', 'server merged S').value });
  });

  it('captures each Save while local persistence waits, deduplicates repeated clicks, and cancels only later typing', async () => {
    const test = fixture(), first = deferred<ManualSavedIntent>();
    test.save.mockImplementationOnce(() => first.promise);
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, title: 'B' }));
    const savingB = scope.save();
    expect(scope.save()).toBe(savingB);
    const typingD = scope.update(value => ({ ...value, title: 'D' }));
    const savingD = scope.save();
    const cancelling = scope.cancel();
    await Promise.resolve();
    first.resolve(saved('R1', snapshot('B').value!));
    await Promise.all([savingB, typingD, savingD, cancelling]);
    expect(test.save).toHaveBeenCalledTimes(2);
    expect(test.save.mock.calls[0][1].draft!.title).toBe('B');
    expect(test.save.mock.calls[1][1].draft!.title).toBe('D');
    expect(test.save.mock.calls[1][2]).toEqual({ predecessorId: 'R1' });
    expect(scope.getState()).toMatchObject({ dirty: false, value: { title: 'D' }, record: { active: false } });
    expect(() => scope.update(value => value)).toThrow('closed');
  });

  it('restores stage-only records without submitting and preserves failed persistence for retry', async () => {
    const test = fixture();
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, title: 'unsent' }));
    const restored = ManualScope.restore(test.options, test.disk());
    expect(restored.getState()).toMatchObject({ dirty: true, value: { title: 'unsent' } });
    expect(test.save).not.toHaveBeenCalled();
    test.persist.mockRejectedValueOnce(new Error('quota'));
    await expect(restored.update(value => ({ ...value, title: 'latest' }))).rejects.toThrow('quota');
    expect(restored.getState()).toMatchObject({ durable: false, value: { title: 'latest' } });
    await restored.retryPersistence();
    expect(test.disk().stage).toEqual([{ exists: true, value: 'latest' }]);
    await restored.cancel();
    expect(restored.getState().value.title).toBe('A');
    expect(test.save).not.toHaveBeenCalled();
  });

  it('selects nested fields and stable child IDs while rejecting updates to unrelated fields', async () => {
    const test = fixture([['preparation', 'contextIdea'], ['thoughts', { id: 't' }, 'text']]);
    test.captured.checkpoint.confirmed.value!.thoughts = [{ id: 't', text: 'old', tags: [], date: 'date' }, { id: 'other', text: 'untouched', tags: [], date: 'date' }];
    test.captured.checkpoint.draft = clone(test.captured.checkpoint.confirmed.value);
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, preparation: { contextIdea: 'idea' }, thoughts: (value.thoughts as DocumentData[]).map(thought => thought.id === 't' ? { ...thought, text: 'new' } : thought) }));
    expect(() => scope.update(value => ({ ...value, title: 'unselected' }))).toThrow('unselected');
    await scope.save();
    expect(test.save.mock.calls[0][1].draft).toMatchObject({ title: 'A', preparation: { contextIdea: 'idea' }, thoughts: [{ id: 't', text: 'new' }, { id: 'other', text: 'untouched' }] });
  });

  it('rejects missing, foreign, unrelated or incomparable predecessor evidence and overlapping ownership', () => {
    const test = fixture([['title'], ['verse']]);
    test.captured.provenance = [{ path: ['title'], requestId: 'missing' }];
    expect(() => ManualScope.begin(test.options)).toThrow('Missing');
    test.captured.requests = [{ ...saved('missing', snapshot().value!), owner: 'other' }];
    expect(() => ManualScope.begin(test.options)).toThrow('identity');
    test.captured.requests = [saved('one', snapshot().value!), saved('two', snapshot().value!)];
    test.captured.provenance = [{ path: ['title'], requestId: 'one' }, { path: ['verse'], requestId: 'two' }];
    expect(() => ManualScope.begin(test.options)).toThrow('incompatible');
    test.captured.provenance = [];
    test.captured.checkpoint.draft!.title = 'unsaved elsewhere';
    expect(() => ManualScope.begin(test.options)).toThrow('unsaved editor');
    expect(() => ManualScope.begin({ ...test.options, selection: [['preparation'], ['preparation', 'contextIdea']] })).toThrow('Overlapping');
    expect(() => ManualScope.begin({ ...test.options, selection: [['userId']] })).toThrow('read-only');
  });

  it('fences owner changes during durable Save and rejects foreign recovery without publishing late work', async () => {
    const test = fixture(), delayed = deferred<ManualSavedIntent>();
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, title: 'B' }));
    const disk = clone(test.disk());
    expect(() => ManualScope.restore({ ...test.options, owner: 'other' }, disk)).toThrow('identity');
    test.save.mockImplementationOnce(() => delayed.promise);
    const saving = scope.save();
    await Promise.resolve();
    test.changeOwner();
    delayed.resolve(saved('R1', snapshot('B').value!));
    await expect(saving).rejects.toThrow('owner changed');
    expect(test.disk()).toEqual(disk);
    expect(() => scope.getState()).toThrow('owner changed');
    expect(() => ManualScope.begin(test.options)).toThrow('owner changed');
    scope.dispose();
  });
  it('keeps a Save reverting to A behind the still-persisting Save B', async () => {
    const test = fixture(), first = deferred<ManualSavedIntent>();
    test.save.mockImplementationOnce(() => first.promise);
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, title: 'B' }));
    const savingB = scope.save();
    const typingA = scope.update(value => ({ ...value, title: 'A' }));
    const savingA = scope.save();
    first.resolve(saved('R1', snapshot('B').value!));
    await Promise.all([savingB, typingA, savingA]);
    expect(test.save).toHaveBeenCalledTimes(2);
    expect(test.save.mock.calls[1][1].draft!.title).toBe('A');
    expect(test.save.mock.calls[1][2]).toEqual({ predecessorId: 'R1' });
  });

  it('preserves stable creation IDs and can remove only the selected child', async () => {
    const test = fixture([['thoughts', { id: 'new' }]]);
    const scope = ManualScope.begin(test.options);
    await expect(scope.save()).resolves.toBeNull();
    await scope.update(value => ({ ...value, thoughts: [{ id: 'new', text: 'typed', tags: [], date: 'date' }] }));
    await scope.save();
    await scope.update(value => ({ ...value, thoughts: [] }));
    await scope.save();
    expect(test.save.mock.calls[0][1].draft!.thoughts).toEqual([{ id: 'new', text: 'typed', tags: [], date: 'date' }]);
    expect(test.save.mock.calls[1][1].draft!.thoughts).toEqual([]);
    expect(test.save.mock.calls[1][2]).toEqual({ predecessorId: 'request-1' });
  });

  it('rejects altered recovery ownership, invalid selected values, tombstones and untrusted identities', async () => {
    const test = fixture();
    const scope = ManualScope.begin(test.options); await scope.settled();
    const disk = test.disk();
    expect(() => ManualScope.restore(test.options, { ...disk, baseline: { ...disk.baseline, value: { userId: 'foreign', title: 'secret' } } })).toThrow('ownership');
    expect(() => ManualScope.restore(test.options, { ...disk, stage: [{ exists: true }] })).toThrow('field value');
    expect(() => ManualScope.restore(test.options, { ...disk, baseline: { ...disk.baseline, value: null } })).toThrow('live');
    expect(() => ManualScope.begin({ ...test.options, selection: [['title', '__proto__']] })).toThrow('selection');
    test.captured.checkpoint.confirmed = { ...snapshot(), value: null };
    expect(() => ManualScope.begin(test.options)).toThrow('live');
    scope.dispose();
    expect(() => scope.cancel()).toThrow('owner changed');
  });

  it('chooses the explicit descendant for multiple selected fields instead of numeric generations', async () => {
    const test = fixture([['title'], ['verse']]);
    const first = saved('parent-high-generation', snapshot('B').value!);
    const descendant = saved('child-low-generation', { ...first.value, verse: 'verse B' }, first.id);
    test.captured.requests = [descendant, first];
    test.captured.provenance = [{ path: ['title'], requestId: first.id }, { path: ['verse'], requestId: descendant.id }];
    test.captured.checkpoint.draft = { ...descendant.value, scratch: snapshot('B', 'unsent C').value!.scratch };
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, title: 'D' })); await scope.save();
    expect(test.save.mock.calls[0][2]).toEqual({ predecessorId: descendant.id });
    expect(test.save.mock.calls[0][1].draft!.scratch).toEqual(snapshot().value!.scratch);
  });

  it.each([
    { active: 'yes' }, { active: null }, { savedGeneration: -1 }, { savedGeneration: 0.5 },
    { savedGeneration: 5 }, { savedGeneration: undefined }, { generation: 1.5 },
    { stage: null }, { savedSelection: {} }, { predecessor: undefined },
  ])('rejects malformed persisted lifecycle fields %j', async patch => {
    const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
    expect(() => ManualScope.restore(test.options, { ...test.disk(), ...patch } as ManualScopeRecord)).toThrow();
  });

  it('rejects cyclic or malformed predecessor ancestry both at begin and recovery', async () => {
    const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
    const one = saved('one', snapshot().value!, 'two');
    const two = saved('two', snapshot().value!, 'one');
    test.captured.requests = [one, two]; test.captured.provenance = [{ path: ['title'], requestId: 'one' }];
    expect(() => ManualScope.begin(test.options)).toThrow('Cyclic');
    expect(() => ManualScope.restore(test.options, { ...test.disk(), predecessor: one })).toThrow('Cyclic');
    expect(() => ManualScope.restore(test.options, { ...test.disk(), predecessor: { ...one, predecessorId: 'one' } })).toThrow('identity');
    expect(() => ManualScope.restore(test.options, { ...test.disk(), predecessor: { ...one, predecessorId: 4 } } as unknown as ManualScopeRecord)).toThrow('identity');
    expect(() => ManualScope.restore(test.options, { ...test.disk(), predecessor: { ...one, value: snapshot('changed immutable value').value! } })).toThrow('evidence changed');
    expect(() => ManualScope.restore(test.options, { ...test.disk(), savedSelection: [{ exists: true, value: 'never submitted' }] })).toThrow('saved selection');
  });

});
