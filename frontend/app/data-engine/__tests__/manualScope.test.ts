import { prepareDomainCommand } from '../domainPolicy';
import { ManualScope, manualOpeningObservation, type ManualCapture, type ManualPath, type ManualSavedIntent, type ManualScopePort, type ManualScopeRecord } from '../manualScope';
import { applyCommand, mergeFields } from '../protocol';
import { DataSession } from '../session';

import type { DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'sermons', id: 'sermon' };
const snapshot = (title = 'A', scratch = 'scratch0', revision = 1): ResourceSnapshot => ({ resource, value: { userId: 'owner', title, verse: '', date: '2026-09-12', thoughts: [], scratch: [{ id: 's', text: scratch, createdAt: '2026-09-12' }] }, metadata: { protocol: 1, generation: 'g', revision, deleted: false } });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const saved = (id: string, value: DocumentData, predecessorId: string | null = null): ManualSavedIntent => ({ id, owner: 'owner', resource, value: clone(value), predecessorId });
function fixture(selection: readonly ManualPath[] = [['title']], base = snapshot()) {
  let current = true;
  let disk: ManualScopeRecord | undefined;
  const captured: ManualCapture = { checkpoint: new DataSession(base).checkpoint(), provenance: [], requests: [] };
  const persist = jest.fn(async (record: ManualScopeRecord) => { disk = clone(record); });
  const save = jest.fn<ReturnType<ManualScopePort['save']>, Parameters<ManualScopePort['save']>>(async (_scope, checkpoint, options) => ({ ...saved(`request-${checkpoint.editGeneration}`, checkpoint.draft!, options.predecessorId ?? null), resource: base.resource }));
  const options = { owner: 'owner', resource: base.resource, scopeId: 'scope', selection, port: { capture: () => captured, isCurrent: () => current, persist, save } };
  return { options, captured, persist, save, disk: () => disk!, changeOwner: () => { current = false; } };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('manual form scope', () => {
  it('restores both gestures when the subpoint returns before the manual Save', async () => {
    const opening = { introduction: [], main: [
      { id: 'a', text: 'A', subPoints: [{ id: 'child', text: 'Child', position: 0 }] },
      { id: 'b', text: 'B', subPoints: [] },
    ], conclusion: [] };
    const moved = { ...opening, main: [
      { ...opening.main[0], subPoints: [] }, { ...opening.main[1], subPoints: opening.main[0].subPoints },
    ] };
    const base = snapshot();
    const test = fixture([['outline']], { ...base, value: { ...base.value!, outline: opening } });
    const scope = ManualScope.begin(test.options);
    const first = { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_015 };
    const second = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    await scope.update(value => ({ ...value, outline: moved }), { outlineSubpoint: { subPointId: 'child', time: first } });
    await scope.update(value => ({ ...value, outline: opening }), { outlineSubpoint: { subPointId: 'child', time: second } });
    const restored = ManualScope.restore(test.options, test.disk());
    expect(restored.getState()).toMatchObject({ dirty: true, durable: true });
    expect(test.save).not.toHaveBeenCalled();
    await restored.save();
    expect(test.save.mock.calls[0][2]).toMatchObject({ outlineSubpointMoves: [
      { subPointId: 'child', time: first, destination: { parentId: 'b' } },
      { subPointId: 'child', time: second, destination: { parentId: 'a' } },
    ] });
    expect(restored.getState().dirty).toBe(false);
  });

  it('opens the first meeting form over a recovered description without adopting a view-only empty list', async () => {
    const base = { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], description: 'Stored words' };
    const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' }, value: base });
    test.captured.checkpoint.draft = { ...base, description: 'Recovered words', meetingDates: [] };
    test.captured.checkpoint.dirty = true;
    const scope = ManualScope.begin(test.options);
    expect(scope.getState()).toMatchObject({ dirty: false, record: { stage: [{ exists: false }], baseline: { value: base } } });
    expect(scope.getState().value).not.toHaveProperty('meetingDates');
    expect(test.save).not.toHaveBeenCalled();

    const meeting = { id: 'first', date: '2026-12-24', createdAt: '2026-11-25' };
    await scope.update(value => ({ ...value, meetingDates: [meeting] }));
    await scope.save();
    expect(test.save).toHaveBeenCalledTimes(1);
    expect(test.save.mock.calls[0][1].draft).toMatchObject({ description: 'Stored words', meetingDates: [meeting] });
  });

  it('still refuses a meeting form if the document editor owns a changed meeting list', () => {
    const meeting = { id: 'first', date: '2026-12-24', createdAt: '2026-11-25' };
    const base = { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [] };
    const changes: [DocumentData, DocumentData][] = [
      [base, { ...base, meetingDates: [meeting] }],
      [{ ...base, meetingDates: [meeting] }, { ...base, meetingDates: [] }],
    ];
    for (const [before, after] of changes) {
      const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' }, value: before });
      test.captured.checkpoint.draft = after;
      expect(() => ManualScope.begin(test.options)).toThrow('An unsaved editor already owns a selected field');
      expect(test.save).not.toHaveBeenCalled();
    }
  });

  it('does not treat undo of a captured first meeting as a view-only empty list', () => {
    const base = { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [] };
    const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' }, value: base });
    const meeting = { id: 'first', date: '', createdAt: '2026-11-25' };
    test.captured.checkpoint.pending.first = { generation: 1, value: { ...base, meetingDates: [meeting] } };
    test.captured.checkpoint.draft = { ...base, meetingDates: [] };
    test.captured.checkpoint.editGeneration = 2;
    test.captured.checkpoint.dirty = true;
    expect(() => ManualScope.begin(test.options)).toThrow('An unsaved editor already owns a selected field');
  });

  it('recognizes a meeting correction as durable when no field-action evidence is available', async () => {
    const meeting = { id: 'meeting', date: '2026-12-13', location: 'Hall', createdAt: '2026-11-08' };
    const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' },
      value: { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [meeting] } });
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, meetingDates: [{ ...meeting, date: '2026-12-24' }] }));
    const restored = ManualScope.restore(test.options, test.disk());
    expect(restored.getState().value.meetingDates).toEqual([{ ...meeting, date: '2026-12-24' }]);
    expect(scope.getState()).toMatchObject({ dirty: true, durable: true, value: restored.getState().value });
    expect(test.save).not.toHaveBeenCalled();
  });

  it.each(['2026-12-24', ''])('sends the original time of a recovered meeting date %j', async date => {
    const meeting = { id: 'meeting', date: '2026-12-13', location: 'Hall', createdAt: '2026-11-08' };
    const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' },
      value: { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [meeting] } });
    const scope = ManualScope.begin(test.options);
    const time = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    const locationTime = { earliestMs: 1_800_000_000_030, latestMs: 1_800_000_000_035 };
    await scope.update(value => ({ ...value, meetingDates: [{ ...meeting, date }] }), { meetingDate: { time } });
    const restored = ManualScope.restore(test.options, test.disk());
    await restored.update(value => ({ ...value, meetingDates: [{ ...meeting, date, location: 'Side room' }] }),
      { field: 'location', rowId: meeting.id, time: locationTime });
    expect(test.save).not.toHaveBeenCalled();
    await restored.save();
    expect(test.save.mock.calls[0][2]).toMatchObject({
      meetingDateAction: { rowId: meeting.id, after: date, time },
      groupMeetingFieldCaptures: { location: { rowId: meeting.id, after: 'Side room', time: locationTime } },
    });
  });

  it('retains the time of returning to the opening meeting date while the first Save waits', async () => {
    const meeting = { id: 'meeting', date: '2026-12-13', createdAt: '2026-11-08' };
    const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' },
      value: { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [meeting] } });
    const held = deferred<void>();
    test.save.mockImplementationOnce(async (_scope, checkpoint) => {
      await held.promise;
      return { ...saved('first-date', checkpoint.draft!), resource: test.options.resource };
    });
    const firstTime = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    const secondTime = { earliestMs: 1_800_000_000_030, latestMs: 1_800_000_000_035 };
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, meetingDates: [{ ...meeting, date: '2026-12-24' }] }), { meetingDate: { time: firstTime } });
    const first = scope.save();
    const change = scope.update(value => ({ ...value, meetingDates: [meeting] }), { meetingDate: { time: secondTime } });
    const second = scope.save();
    held.resolve();
    await Promise.all([first, change, second]);
    expect(test.save.mock.calls[1][2]).toMatchObject({
      predecessorId: 'first-date', meetingDateAction: { rowId: meeting.id, after: meeting.date, time: secondTime },
    });
  });

  it.each(['unknown time', 'unfinished date', 'replaced meeting'])('does not borrow a prior clock after %s', async reason => {
    const meeting = { id: 'meeting', date: '2026-12-13', createdAt: '2026-11-08' };
    const test = fixture([['meetingDates']], { ...snapshot(), resource: { collection: 'groups', id: 'group' },
      value: { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [meeting] } });
    const scope = ManualScope.begin(test.options);
    const time = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    const changed = { ...meeting, date: '2026-12-24' };
    await scope.update(value => ({ ...value, meetingDates: [changed] }), { meetingDate: { time } });
    const replacement = reason === 'replaced meeting' ? { ...changed, createdAt: '2026-11-09' }
      : { ...changed, date: reason === 'unknown time' ? '2026-12-25' : '2026-12-' };
    await scope.update(value => ({ ...value, meetingDates: [replacement] }), { meetingDate: { time: null } });
    if (reason === 'unfinished date') {
      expect(test.disk().meetingDateCapture).toBeUndefined();
      return;
    }
    const restored = ManualScope.restore(test.options, test.disk());
    await restored.save();
    if (reason === 'unknown time') expect(test.save.mock.calls[0][2]).toMatchObject({ meetingDateAction: { rowId: 'meeting', after: '2026-12-25', time: null } });
    else expect(test.save.mock.calls[0][2]).not.toHaveProperty('meetingDateAction');
  });

  it('recognizes a new preaching date with an audience as durable before there is a dated row to compare', async () => {
    const date = { id: 'date', date: '2026-12-13', createdAt: '2026-11-08', status: 'planned',
      church: { id: 'church', name: 'Church', city: 'Town' } };
    const base = snapshot();
    const test = fixture([['preachDates']], base);
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, preachDates: [{ ...date, audience: 'Leaders' }] }), { rowId: date.id, detail: 'audience' });
    const restored = ManualScope.restore(test.options, test.disk());
    expect(restored.getState().value.preachDates).toEqual([{ ...date, audience: 'Leaders' }]);
    expect(scope.getState()).toMatchObject({ dirty: true, durable: true, value: restored.getState().value });
    expect(test.save).not.toHaveBeenCalled();
  });

  it('restores both meeting action times from disk without sending until Save', async () => {
    const meeting = { id: 'meeting', date: '', location: 'Hall', createdAt: '2026-11-08' };
    const base: ResourceSnapshot = {
      resource: { collection: 'groups', id: 'group' },
      value: { userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [meeting] },
      metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    };
    const test = fixture([['meetingDates']], base);
    const scope = ManualScope.begin(test.options);
    const location = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    const audience = { earliestMs: 1_800_000_000_050, latestMs: 1_800_000_000_055 };
    await scope.update(value => ({ ...value, meetingDates: [{ ...meeting, location: '' }] }), { field: 'location', rowId: meeting.id, time: location });
    await scope.update(value => ({ ...value, meetingDates: [{ ...meeting, location: '', audience: 'All' }] }), { field: 'audience', rowId: meeting.id, time: audience });
    const restored = ManualScope.restore(test.options, test.disk());
    expect(test.save).not.toHaveBeenCalled();
    await restored.save();
    expect(test.save.mock.calls[0][2]).toMatchObject({ groupMeetingFieldCaptures: {
      location: { rowId: meeting.id, time: location, after: '' },
      audience: { rowId: meeting.id, time: audience, after: 'All' },
    } });
  });

  it('keeps authored preaching details across recovery and timestamps them only on explicit Save', async () => {
    const church = { id: 'church', name: 'Church', city: 'Town' };
    const date = { id: 'date', date: '2026-12-13', createdAt: '2026-11-08', status: 'planned', church };
    const base = snapshot();
    base.value = { ...base.value, preachDates: [date] };
    const test = fixture([['preachDates']], base);
    const scope = ManualScope.begin(test.options);
    await scope.update(value => ({ ...value, preachDates: [{ ...date, church: { ...church, city: 'Other town' } }] }),
      { rowId: date.id, detail: 'churchCity' });
    await scope.update(value => ({ ...value, preachDates: [{ ...date, church: { ...church, city: 'Other town' }, notes: 'Private note' }] }));
    const restored = ManualScope.restore(test.options, test.disk());
    expect(test.save).not.toHaveBeenCalled();
    const time = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    await restored.save({ rowId: date.id, time });
    expect(test.save.mock.calls[0][2]).toMatchObject({
      preachDateFieldSave: { rowId: date.id, rowCreatedAt: date.createdAt, fields: { churchCity: true }, time },
    });
  });

  it('captures unclocked bulk status intent only for dates from the opening', async () => {
    const initial = { id: 'first', date: '2026-12-13', createdAt: '2026-11-08', status: 'preached', church: { id: 'c', name: 'Church' } };
    const before = snapshot();
    before.value = { ...before.value, preachDates: [initial], isPreached: true };
    const test = fixture([['preachDates'], ['isPreached']], before);
    const scope = ManualScope.begin(test.options);
    await scope.update(current => ({ ...current, isPreached: false, preachDates: [
      { ...initial, status: 'planned' }, { ...initial, id: 'added-in-stage', status: 'planned' },
    ] }));
    const restored = ManualScope.restore(test.options, test.disk());
    await restored.save(undefined, { status: 'planned', time: null });
    expect(test.save.mock.calls[0][2].preachStatusCapture).toEqual({
      status: 'planned', time: null, rows: [{ rowId: initial.id, rowCreatedAt: initial.createdAt }],
    });
  });

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

it('suspends a correction without erasing it and permits explicit recovery after restart', async () => {
  const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
  await scope.update(value => ({ ...value, title: 'Correction' })); await scope.suspend();
  expect(test.disk()).toMatchObject({ active: false, stage: [{ exists: true, value: 'Correction' }] });
  expect(() => scope.update(value => value)).toThrow();
  const recovered = ManualScope.restore(test.options, test.disk()); await recovered.reopen();
  expect(recovered.getState()).toMatchObject({ value: { title: 'Correction' }, dirty: true, durable: true });
  expect(test.save).not.toHaveBeenCalled();
});

it('keeps the original opening distinct from later saved values through persistence and recovery', async () => {
  const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
  await scope.update(value => ({ ...value, title: 'B' })); await scope.save();
  expect(scope.getState()).toMatchObject({ openingValue: { title: 'A' }, value: { title: 'B' } });
  const restored = ManualScope.restore(test.options, test.disk());
  await restored.update(value => ({ ...value, title: 'C' })); await restored.save();
  expect(restored.getState()).toMatchObject({ openingValue: { title: 'A' }, value: { title: 'C' } });
  expect(restored.getState().record.savedSelection).toEqual([{ exists: true, value: 'C' }]);
  const oldSaved = test.disk(); delete oldSaved.openingSelection;
  expect(ManualScope.restore(test.options, oldSaved).getState().openingValue).toBeNull();
});

it('recovers an old never-saved opening without guessing an already-saved origin', async () => {
  const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
  await scope.update(value => ({ ...value, title: 'Unsent' }));
  const old = test.disk(); delete old.openingSelection;
  expect(ManualScope.restore(test.options, old).getState()).toMatchObject({ openingValue: { title: 'A' }, value: { title: 'Unsent' } });
  expect(() => ManualScope.restore(test.options, { ...old, openingSelection: [] })).toThrow('opening selection');
});

it('pins async proposal input and stages its result durably without sending', async () => {
  const test = fixture(); const scope = ManualScope.begin(test.options);
  const result = deferred<DocumentData>();
  const producer = jest.fn(async () => result.promise);
  const pending = scope.propose(producer); await scope.settled(); await Promise.resolve();
  expect(producer).toHaveBeenCalledWith(snapshot().value);
  test.captured.checkpoint = new DataSession(snapshot('Remote', 'remote', 2)).checkpoint();
  result.resolve({ ...snapshot().value!, title: 'Proposal' }); await pending;
  expect(test.disk().stage[0].value).toBe('Proposal'); expect(test.save).not.toHaveBeenCalled();
  expect(test.disk().baseline).toEqual(snapshot());
});

it.each(['edit', 'cancel', 'dispose', 'owner', 'abort'] as const)('rejects late proposal after %s without replacing retained work', async reason => {
  const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
  const result = deferred<DocumentData>(), controller = new AbortController();
  const pending = scope.propose(async () => result.promise, controller.signal); await Promise.resolve();
  if (reason === 'edit') await scope.update(value => ({ ...value, title: 'Newer typing' }));
  if (reason === 'cancel') await scope.cancel();
  if (reason === 'dispose') scope.dispose();
  if (reason === 'owner') test.changeOwner();
  if (reason === 'abort') controller.abort();
  const before = test.disk();
  result.resolve({ ...snapshot().value!, title: 'Late proposal' });
  await expect(pending).rejects.toThrow(); expect(test.disk()).toEqual(before); expect(test.save).not.toHaveBeenCalled();
});

it('accepts only the latest async proposal and rejects out-of-selection output', async () => {
  const test = fixture(); const scope = ManualScope.begin(test.options); await scope.settled();
  const first = deferred<DocumentData>(), second = deferred<DocumentData>();
  const older = scope.propose(async () => first.promise); await Promise.resolve();
  const newer = scope.propose(async () => second.promise); await Promise.resolve();
  second.resolve({ ...snapshot().value!, title: 'Latest proposal' }); await newer;
  first.resolve({ ...snapshot().value!, title: 'Old proposal' }); await expect(older).rejects.toThrow();
  expect(test.disk().stage[0].value).toBe('Latest proposal');
  await expect(scope.propose(async source => ({ ...source, verse: 'Unselected' }))).rejects.toThrow('unselected');
  expect(test.disk().stage[0].value).toBe('Latest proposal');
});

it('does not call a producer until the source is durably owned', async () => {
  const test = fixture(); test.persist.mockRejectedValue(new Error('Storage full'));
  const scope = ManualScope.begin(test.options), producer = jest.fn(async source => source);
  await expect(scope.propose(producer)).rejects.toThrow('Storage full'); expect(producer).not.toHaveBeenCalled();
});


describe('editing from a saved observation in an untouched manual dialog', () => {
  it('does not repin a deliberate return to the opening words when an observation is available', async () => {
    const test = fixture(), scope = ManualScope.begin(test.options); await scope.settled();
    const observed = snapshot('Phone', 'remote sibling', 2);
    await Promise.all([scope.update(value => ({ ...value, title: 'Typed' })),
      scope.update(value => ({ ...value, title: 'A' }), undefined, undefined, { snapshot: observed, follow: true })]);
    expect(scope.getState()).toMatchObject({ dirty: false, durable: true, value: { title: 'A' },
      record: { baseline: { metadata: { revision: 1 } } } });
    expect(test.save).not.toHaveBeenCalled();
  });

  it('does not repin to a different child that happens to have the same ID', async () => {
    const thought = { id: 'row', date: '2026-11-25', text: 'Old thought', tags: [] };
    const current = snapshot();
    const original = { ...current, value: { ...current.value!, thoughts: [thought] } };
    const test = fixture([['thoughts', { id: 'row' }]], original);
    const scope = ManualScope.begin(test.options); await scope.settled();
    const replaced = { ...original, metadata: { ...original.metadata!, revision: 2 },
      value: { ...original.value, thoughts: [{ ...thought, date: '2026-11-26', text: 'New thought' }] } };
    const sameBirth = (opening: DocumentData, observed: DocumentData) =>
      (opening.thoughts as DocumentData[])[0]?.date === (observed.thoughts as DocumentData[])[0]?.date;
    await scope.update(value => value, undefined, undefined, { snapshot: replaced, follow: sameBirth });
    expect(scope.getState()).toMatchObject({ dirty: false, durable: true, value: { thoughts: [thought] },
      record: { baseline: { metadata: { revision: 1 } } } });
  });

  it.each([false, true])('follows the first version of a legacy record only with matching birth evidence, nested=%s', async nested => {
    const before = snapshot();
    const birth = '2026-11-25T09:00:00.000Z';
    const thought = { id: 'row', date: birth, text: 'Old thought', tags: [] };
    const original = { ...before, metadata: null, value: { ...before.value!, thoughts: [thought],
      ...(nested ? {} : { createdAt: birth }) } };
    const test = fixture(nested ? [['thoughts', { id: 'row' }]] : [['title']], original);
    const scope = ManualScope.begin(test.options); await scope.settled();
    const opening = scope.getState().record;
    const observed = { ...original, metadata: before.metadata, value: { ...original.value, title: 'Saved title',
      thoughts: [{ ...thought, text: 'Saved thought' }] } };
    const include = nested ? (a: DocumentData, b: DocumentData) =>
      (a.thoughts as DocumentData[])[0]?.date === (b.thoughts as DocumentData[])[0]?.date : true;
    const observation = manualOpeningObservation(opening, new DataSession(observed).checkpoint(), include);
    expect(observation?.snapshot).toEqual(observed);
    const replaced = { ...observed, value: { ...observed.value, createdAt: '2026-11-26T09:00:00.000Z',
      thoughts: [{ ...thought, date: '2026-11-26T09:00:00.000Z', text: 'Unrelated thought' }] } };
    expect(manualOpeningObservation(opening, new DataSession(replaced).checkpoint(), include)).toBeUndefined();
    expect(scope.getState().record.baseline).toEqual(original);
    expect(test.persist).toHaveBeenCalledTimes(1);
  });

  it('stages the next edit from the exact shown revision even if the parent receives a newer one', async () => {
    const test = fixture(), scope = ManualScope.begin(test.options); await scope.settled();
    const shown = snapshot('Phone', 'remote sibling', 2);
    test.captured.checkpoint = new DataSession(snapshot('An even newer copy', 'remote sibling', 3)).checkpoint();
    const held = deferred<void>();
    test.persist.mockImplementationOnce(async () => held.promise);
    const updating = scope.update(value => ({ ...value, title: value.title + ' then laptop' }),
      undefined, undefined, { snapshot: shown, follow: true });
    expect(scope.getState()).toMatchObject({ dirty: true, durable: false, value: { title: 'Phone then laptop' },
      record: { baseline: { metadata: { revision: 2 } } } });
    expect(test.save).not.toHaveBeenCalled();
    held.resolve(); await updating;
    await scope.save();
    expect(test.save.mock.calls[0][1]).toMatchObject({ confirmed: { metadata: { revision: 2 }, value: { title: 'Phone' } },
      draft: { title: 'Phone then laptop' } });
  });
});

describe('pristine preparation field follow', () => {
  it('follows a genuine current copy without submitting anything', async () => {
    const test = fixture(), scope = ManualScope.begin(test.options); await scope.settled();
    test.captured.checkpoint = new DataSession(snapshot('Phone', 'remote sibling', 2)).checkpoint();
    await scope.follow(test.captured);
    expect(scope.getState()).toMatchObject({ dirty: false, durable: true, value: { title: 'Phone' },
      record: { baseline: { metadata: { revision: 2 } }, savedSelection: [{ exists: true, value: 'Phone' }] } });
    expect(test.save).not.toHaveBeenCalled();
  });
  it('keeps a keystroke that arrives before queued pristine follow executes', async () => {
    const test = fixture(), scope = ManualScope.begin(test.options); await scope.settled();
    test.captured.checkpoint = new DataSession(snapshot('Phone', 'remote sibling', 2)).checkpoint();
    const following = scope.follow(test.captured);
    const typing = scope.update(value => ({ ...value, title: 'Typed before follow' }));
    await Promise.all([following, typing]);
    expect(scope.getState()).toMatchObject({ dirty: true, value: { title: 'Typed before follow' },
      record: { baseline: { metadata: { revision: 1 } } } });
    await scope.save();
    expect(test.save.mock.calls[0][1]).toMatchObject({ confirmed: { metadata: { revision: 1 } }, draft: { title: 'Typed before follow' } });
  });
  it('keeps a failed explicit Save and its later return to the opening words', async () => {
    const test = fixture(), scope = ManualScope.begin(test.options); await scope.settled();
    await scope.update(value => ({ ...value, title: 'Saved before return' }));
    test.save.mockRejectedValueOnce(new Error('Disk full'));
    await expect(scope.save()).rejects.toThrow('Disk full');
    await scope.update(value => ({ ...value, title: 'A' }));
    test.captured.checkpoint = new DataSession(snapshot('Phone', 'remote sibling', 2)).checkpoint();
    await scope.follow(test.captured);
    expect(scope.getState()).toMatchObject({ captureFailed: true, value: { title: 'A' }, record: { baseline: { metadata: { revision: 1 } } } });
    await scope.retryPersistence();
    expect(scope.getState()).toMatchObject({ dirty: true, value: { title: 'A' }, record: { predecessor: { value: { title: 'Saved before return' } } } });
  });
});
