import { collectCommitRows, commitProjectionKey } from '../retention.client';
import { DataEngine } from '../engine';
import { CollectionReader } from '../collections';
import { ResourceObserver } from '../observer';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { captureMembershipPins } from '../membershipCapture';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { projectMembershipAction } from '../membershipIntent';
import { MembershipScope, validateMembershipScope, type MembershipPin, type MembershipScopePort, type MembershipScopeRecord } from '../membershipScope';
import { createIndexedDbMembershipScopes } from '../membershipScopes.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { createEngineStorageTransaction, engineOwnerRange } from '../storage.client';
import { installStorageHarness } from './storageHarness';
import type { DocumentData, ResourceSnapshot } from '../types';
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ref = { type: 'group' as const, refId: 'group' };
const member = { id: 'group-group', ...ref, position: 1 };
const snapshot = (id: string, occupied = false): ResourceSnapshot => ({ resource: { collection: 'series', id }, metadata: { protocol: 1, generation: `gen-${id}`, revision: 1, deleted: false },
  value: { userId: 'owner', title: id, theme: id, bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: occupied ? [member] : [], sermonIds: [], seriesKind: occupied ? 'group' : 'sermon' } });
const pins = (): MembershipPin[] => [{ baseline: snapshot('a', true), predecessor: null }, { baseline: snapshot('b'), predecessor: null }];
const move = { kind: 'assign' as const, targetId: 'b', refs: [ref] };
function fixture() {
  const disk = installStorageHarness(), scopes = createIndexedDbMembershipScopes(), commits = createIndexedDbCommitStore();
  let current = true, sequence = 0;
  const send = jest.fn(async () => { throw new Error('offline'); });
  const runtime = new DataEngineRuntime({ transport: { send, read: async (_owner, resource) => snapshot(resource.id) }, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store: commits, runtime, operationId: () => `op-${++sequence}`, readConfirmed: async resource => snapshot(resource.id), canDeliver: () => false });
  queue.setOwner('owner');
  const save = jest.fn<ReturnType<MembershipScopePort['save']>, Parameters<MembershipScopePort['save']>>(async captures => {
    if (captures.length > 1) return queue.saveAtomic(captures);
    const item = captures[0]; const result = await queue.save(item.editorId, item.captured, { predecessorId: item.predecessorId, retentionScope: item.retentionScope });
    return result ? [result] : [];
  });
  const persist = jest.fn((record: MembershipScopeRecord, revision: number | null) => scopes.persist(record, revision));
  const port = { isCurrent: () => current, persist, save };
  return { disk, scopes, commits, queue, send, save, persist, port, changeOwner: () => { current = false; },
    begin: (id = 'scope', captured = pins()) => MembershipScope.begin('owner', id, captured, port) };
}

describe('membership intent projection', () => {
  it('allows an empty complete opening list without permitting an uncaptured target', async () => {
    const t = fixture(), scope = t.begin('empty-list', []); await scope.settled();
    expect(scope.getState().values).toEqual([]);
    expect(() => scope.update(move)).toThrow('target was not present');
    expect(await scope.save()).toEqual([]); expect(t.save).not.toHaveBeenCalled();
    expect(await t.commits.list('owner')).toEqual([]);
  });
  it('moves mixed selections out of every opening source, preserving unrelated fields and inputs', () => {
    const sermon = { id: 'sermon-sermon', type: 'sermon', refId: 'sermon', position: 1 };
    const values = new Map([['a', snapshot('a', true).value!], ['b', snapshot('b').value!], ['c', { ...snapshot('c').value!, items: [sermon] } as DocumentData]]);
    const before = clone([...values]);
    const projected = projectMembershipAction(values, { ...move, refs: [ref, { type: 'sermon', refId: 'sermon' }] });
    expect(projected.get('a')!.items).toEqual([]); expect(projected.get('c')!.items).toEqual([]);
    expect(projected.get('b')).toMatchObject({ title: 'b', items: [member, { ...sermon, position: 2 }], sermonIds: ['sermon'], seriesKind: 'mixed' });
    expect([...values]).toEqual(before);
  });
  it('handles removal, exact reorder, legacy lists and no-op without rewriting untouched documents', () => {
    const values = new Map([['a', { ...snapshot('a').value!, items: undefined, sermonIds: ['x', 'y'] } as unknown as DocumentData], ['b', snapshot('b').value!]]);
    const sorted = projectMembershipAction(values, { kind: 'reorder', seriesId: 'a', itemIds: ['sermon-y', 'sermon-x'] });
    expect(sorted.get('a')!.sermonIds).toEqual(['y', 'x']);
    expect(sorted.get('b')).toBe(values.get('b'));
    expect(projectMembershipAction(sorted, { kind: 'remove', refs: [{ type: 'sermon', refId: 'y' }] }).get('a')!.sermonIds).toEqual(['x']);
    expect(projectMembershipAction(values, null).get('a')).toBe(values.get('a'));
    expect(projectMembershipAction(values, { kind: 'remove', refs: [ref] }).get('a')).toBe(values.get('a'));
  });
  it('refuses targets not captured at opening and malformed or ambiguous selections', () => {
    const values = new Map([['a', snapshot('a', true).value!]]);
    for (const action of [move, { ...move, targetId: 'a', position: -1 }, { ...move, targetId: 'a', refs: [ref, ref] },
      { kind: 'remove', refs: [] }, { kind: 'remove', refs: [{ type: 'other', refId: 'x' }] },
      { kind: 'reorder', seriesId: 'a', itemIds: [] }, { kind: 'reorder', seriesId: 'a', itemIds: ['wrong'] },
      { kind: 'reorder', seriesId: 'a', itemIds: ['group-group', 'group-group'] }]) {
      expect(() => projectMembershipAction(values, action as never)).toThrow();
    }
  });
});

describe('durable pinned membership stage', () => {
  const creationResource = { collection: 'sermons', id: 'new-sermon' };
  const creationValue = { userId: 'owner', title: '', verse: '', date: 'now', thoughts: [] };
  const create = (t: ReturnType<typeof fixture>) => MembershipScope.beginCreation('owner', 'creation:scope', creationResource, creationValue, t.port);
  it('durably stages incomplete creation before any series selection, then restores the same resource without sending', async () => {
    const t = fixture(), scope = create(t); await scope.settled();
    await scope.updateCreation({ ...creationValue, title: 'Unsent title' });
    expect(() => scope.save()).toThrow(); expect(scope.getState().record.phase).toBe('editing');
    const restored = MembershipScope.restore((await t.scopes.read('owner', 'creation:scope'))!, t.port);
    expect(restored.getState().record.creation).toEqual({ resource: creationResource, value: { ...creationValue, title: 'Unsent title' }, seriesOpened: false });
    expect(t.save).not.toHaveBeenCalled(); expect(await t.commits.list('owner')).toEqual([]);
    const transaction = createEngineStorageTransaction();
    const oldStages = await transaction('readonly', (store, read, done) => read(store.getAll(engineOwnerRange('membership-scope', 'owner')), done));
    expect(oldStages).toEqual([]);
    await restored.updateCreation({ ...creationValue, title: 'Complete title', verse: 'Romans 1' });
    expect(await restored.save()).toHaveLength(1);
    expect((await t.commits.list('owner'))[0]).toMatchObject({ baseline: { resource: creationResource, value: null }, value: { title: 'Complete title' } });
  });

  it('retains an unresolved preset across restart and missing targets, refusing silent standalone creation', async () => {
    const t = fixture(), scope = MembershipScope.beginCreation('owner', 'creation:preset', creationResource,
      { ...creationValue, title: 'In series', verse: 'Romans 1' }, t.port, 'b');
    await scope.settled();
    const restored = MembershipScope.restore((await t.scopes.read('owner', 'creation:preset'))!, t.port);
    expect(() => restored.save()).toThrow('Resolve the requested series');
    expect(() => restored.pinCreationSeries([])).toThrow('target was not present');
    expect(restored.getState().record.creation).toMatchObject({ requestedSeriesId: 'b', seriesOpened: false });
    expect(t.save).not.toHaveBeenCalled();
    await restored.pinCreationSeries(pins());
    expect(restored.getState().record.action).toEqual({ kind: 'assign', targetId: 'b', refs: [{ type: 'sermon', refId: creationResource.id }] });
    expect(restored.getState().record.creation?.requestedSeriesId).toBeUndefined();
    expect(await restored.save()).toHaveLength(2);
  });

  it('allows an explicit removal of the preset without any catalog read or delayed reassignment', async () => {
    const t = fixture(), scope = MembershipScope.beginCreation('owner', 'creation:preset', creationResource,
      { ...creationValue, title: 'Standalone', verse: 'Romans 1' }, t.port, 'missing');
    await scope.settled(); await scope.update(null);
    const restored = MembershipScope.restore((await t.scopes.read('owner', 'creation:preset'))!, t.port);
    await restored.pinCreationSeries(pins());
    expect(restored.getState().record.action).toBeNull();
    expect(await restored.save()).toHaveLength(1);
  });

  it('pins the optional selector once and preserves both frozen creation participants across capture failure', async () => {
    const t = fixture(), scope = create(t); await scope.settled();
    await scope.updateCreation({ ...creationValue, title: 'New sermon', verse: 'Romans 1' });
    await scope.pinCreationSeries(pins());
    await scope.update({ kind: 'assign', targetId: 'b', refs: [{ type: 'sermon', refId: creationResource.id }] });
    const original = scope.getState().record;
    await scope.pinCreationSeries([]); expect(scope.getState().record.pins).toEqual(original.pins);
    t.persist.mockImplementation(async (record, revision) => {
      if (record.phase === 'submitted') throw new Error('crash after capture');
      return t.scopes.persist(record, revision);
    });
    await expect(scope.save()).rejects.toThrow('crash after capture');
    const first = await t.commits.list('owner'); expect(first).toHaveLength(2);
    expect(() => scope.updateCreation({ ...creationValue, title: 'Different' })).toThrow('frozen');
    t.persist.mockImplementation((record, revision) => t.scopes.persist(record, revision));
    const restored = MembershipScope.restore((await t.scopes.read('owner', 'creation:scope'))!, t.port);
    expect(await restored.save()).toEqual(first.map(row => row.id));
    expect(await t.commits.list('owner')).toEqual(first); expect(t.send).not.toHaveBeenCalled();
  });

  it('rejects a different owner, resource, selector reset and edits after creation is frozen', async () => {
    const t = fixture(), scope = create(t); await scope.settled();
    expect(() => scope.updateCreation({ ...creationValue, userId: 'other' })).toThrow('Invalid creation');
    expect(() => scope.updateCreation({ ...creationValue, seriesId: 'b' })).toThrow('Edit membership through');
    await scope.pinCreationSeries(pins());
    expect(() => scope.update(move)).toThrow('only its own');
    const record = scope.getState().record;
    await expect(t.scopes.persist({ ...record, creation: { ...record.creation!, resource: { ...creationResource, id: 'replacement' } } }, record.revision)).rejects.toThrow('Frozen');
    await expect(t.scopes.persist({ ...record, pins: [], creation: { ...record.creation!, seriesOpened: false } }, record.revision)).rejects.toThrow('Frozen');
    await scope.cancel(); await t.scopes.compact('owner', record.scopeId);
    expect(await t.scopes.list('owner')).toEqual([]);
  });
  it('pins before typing, stages durably without delivery, and captures the complete move once', async () => {
    const t = fixture(), captured = pins(), scope = t.begin('scope', captured);
    captured[0].baseline.value!.title = 'Later remote';
    await scope.update(move);
    expect(t.save).not.toHaveBeenCalled(); expect(t.send).not.toHaveBeenCalled();
    expect((await t.scopes.read('owner', 'scope'))!.pins[0].baseline.value!.title).toBe('a');
    const saving = scope.save(); expect(scope.save()).toBe(saving);
    expect(() => scope.update(null)).toThrow('frozen'); expect(() => scope.cancel()).toThrow('frozen');
    const ids = await saving;
    expect(ids).toHaveLength(2); expect(await scope.save()).toEqual(ids); expect(t.save).toHaveBeenCalledTimes(1);
    const requests = await t.commits.list('owner');
    expect(requests[0].atomic!.participants).toEqual(ids);
    expect(requests.map(request => request.value!.items)).toEqual([[], [member]]);
    expect(scope.getState()).toMatchObject({ durable: true, record: { phase: 'submitted' } });
    expect(t.send).not.toHaveBeenCalled();
  });
  it('restores an unsent selection without sending and cancels only the stage', async () => {
    const t = fixture(), scope = t.begin(); await scope.update(move); scope.dispose();
    const recovered = MembershipScope.restore((await t.scopes.read('owner', 'scope'))!, t.port);
    expect(recovered.getState().values[1].value.items).toEqual([member]); expect(t.save).not.toHaveBeenCalled();
    await recovered.cancel(); expect((await t.commits.list('owner'))).toEqual([]);
    await t.scopes.compact('owner', 'scope'); expect(await t.scopes.list('owner')).toEqual([]);
    expect(await t.scopes.completion('owner', 'scope')).toBe('cancelled');
    expect(await t.scopes.completion('other', 'scope')).toBeNull();
    expect(() => recovered.save()).toThrow('cancelled');
    await expect(t.begin().settled()).rejects.toThrow('another session');
  });
  it('recovers a crash after request capture before stage completion using the identical operation', async () => {
    const t = fixture(), scope = t.begin(); await scope.update(move);
    t.persist.mockImplementation(async (record, revision) => {
      if (record.phase === 'submitted') throw new Error('disk full after capture');
      return t.scopes.persist(record, revision);
    });
    await expect(scope.save()).rejects.toThrow('disk full after capture');
    const first = await t.commits.list('owner'); expect(first).toHaveLength(2);
    const stored = (await t.scopes.read('owner', 'scope'))!; expect(stored.phase).toBe('saving'); scope.dispose();
    t.persist.mockImplementation((record, revision) => t.scopes.persist(record, revision));
    const restored = MembershipScope.restore(stored, t.port);
    expect(() => restored.update(null)).toThrow('frozen');
    const ids = await restored.save(); expect(ids).toEqual(first.map(request => request.id));
    expect(await t.commits.list('owner')).toHaveLength(2);
  });
  it('repairs failed completion persistence in the same instance without capturing again', async () => {
    const t = fixture(), scope = t.begin(); await scope.update(move);
    t.persist.mockImplementationOnce(async (record, revision) => t.scopes.persist(record, revision))
      .mockRejectedValueOnce(new Error('completion failed'));
    await expect(scope.save()).rejects.toThrow('completion failed');
    expect(scope.getState().durable).toBe(false);
    await scope.save(); expect(t.save).toHaveBeenCalledTimes(1);
    expect((await t.scopes.read('owner', 'scope'))!.phase).toBe('submitted');
  });
  it('never captures on stage storage failure and retries its frozen original selection', async () => {
    const t = fixture(), scope = t.begin(); await scope.update(move); t.disk.writeFailure = true;
    await expect(scope.save()).rejects.toThrow('disk full'); expect(t.save).not.toHaveBeenCalled();
    expect(() => scope.update(null)).toThrow('frozen'); t.disk.writeFailure = false;
    await scope.save(); expect(t.save).toHaveBeenCalledTimes(1);
  });
  it('preserves a queued creation predecessor and supports a one-resource remove', async () => {
    const t = fixture(), session = new DataSession({ resource: { collection: 'series', id: 'b' }, value: null, metadata: null });
    session.edit(snapshot('b').value); const created = (await t.queue.save('creation', session.checkpoint()))!;
    const captured = pins(); captured[1] = { baseline: created.baseline, predecessor: { id: created.id, owner: 'owner', resource: created.baseline.resource, value: created.value!, predecessorId: null } };
    const scope = t.begin('with-create', captured); await scope.update(move); await scope.save();
    expect((await t.commits.list('owner')).find(request => request.atomic && request.baseline.resource.id === 'b')!.predecessor).toBe(created.id);
    const remove = t.begin('remove'); await remove.update({ kind: 'remove', refs: [ref] });
    const ids = await remove.save(); expect(ids).toHaveLength(1);
    expect((await t.commits.list('owner')).find(request => request.id === ids[0])!.atomic).toBeUndefined();
  });
  it('does not capture no-op actions and fences account changes and disposed scopes', async () => {
    const t = fixture(), scope = t.begin(); await scope.settled(); expect(await scope.save()).toEqual([]); expect(t.save).not.toHaveBeenCalled();
    const other = t.begin('other'); await other.settled(); t.changeOwner();
    expect(() => other.getState()).toThrow('owner changed'); expect(() => other.update(move)).toThrow('owner changed');
    scope.dispose(); expect(() => scope.getState()).toThrow('owner changed');
  });
  it('rejects deleted/foreign/duplicate pins and invalid recovered state', async () => {
    const t = fixture();
    const wrong = pins(); wrong[0].baseline.value!.userId = 'other'; expect(() => t.begin('foreign', wrong)).toThrow('another owner');
    const deleted = pins(); deleted[0].baseline.metadata!.deleted = true; expect(() => t.begin('deleted', deleted)).toThrow('live series');
    expect(() => t.begin('duplicate', [pins()[0], pins()[0]])).toThrow('Invalid membership');
    const scope = t.begin(); await scope.settled();
    const record = scope.getState().record;
    expect(() => validateMembershipScope({ ...record, requestIds: ['invented'] })).toThrow('Invalid membership');
    expect(() => validateMembershipScope({ ...record, generation: -1 })).toThrow('Invalid membership');
    expect(() => validateMembershipScope({ ...record, pins: [{ ...record.pins[0], predecessor: { id: 'p', owner: 'other', resource: record.pins[0].baseline.resource, value: record.pins[0].baseline.value!, predecessorId: null } }] })).toThrow('predecessor');
  });
});

describe('membership stage storage', () => {
  it('fences competing restored tabs before any capture and isolates owners', async () => {
    const t = fixture(), original = t.begin(); await original.update(move);
    const record = (await t.scopes.read('owner', 'scope'))!;
    const first = MembershipScope.restore(record, t.port), second = MembershipScope.restore(record, t.port);
    const results = await Promise.allSettled([first.save(), second.save()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(t.save).toHaveBeenCalledTimes(1); expect(await t.scopes.read('other', 'scope')).toBeUndefined(); expect(await t.scopes.list('other')).toEqual([]);
  });
  it('keeps frozen pins/actions and validates predecessor references in the same transaction', async () => {
    const t = fixture(), scope = t.begin(); await scope.update(move);
    const record = (await t.scopes.read('owner', 'scope'))!;
    await expect(t.scopes.persist({ ...record, pins: [pins()[1]] }, record.revision)).rejects.toThrow('Frozen membership');
    const missing = clone(record); missing.pins[0].predecessor = { id: 'missing', owner: 'owner', resource: missing.pins[0].baseline.resource, value: missing.pins[0].baseline.value!, predecessorId: null };
    missing.scopeId = 'missing-ref'; await expect(t.scopes.persist(missing, null)).rejects.toThrow('reference changed');
    expect(await t.scopes.read('owner', 'missing-ref')).toBeUndefined();
    await scope.save(); const submitted = (await t.scopes.read('owner', 'scope'))!;
    await expect(t.scopes.persist({ ...submitted, phase: 'editing' }, submitted.revision)).rejects.toThrow();
    const transaction = createEngineStorageTransaction();
    const references = await transaction('readonly', (store, read, done) => read(store.getAll(engineOwnerRange('reference', 'owner')), done));
    expect(JSON.stringify(references)).toContain(submitted.requestIds[0]);
  });
  it('retains pending/refused captures, then compacts only after every participant settles', async () => {
    const t = fixture(), scope = t.begin(); await scope.update(move); await scope.save();
    await t.scopes.compact('owner', 'scope'); expect(await t.scopes.list('owner')).toHaveLength(1);
    for (const request of await t.commits.list('owner')) await t.commits.compareAndSet(request, { ...request, state: 'cancelled' });
    await t.scopes.compact('owner', 'scope'); expect(await t.scopes.list('owner')).toEqual([]);
    // The queue's independent projection references still protect these payloads.
    expect(await t.commits.list('owner')).toHaveLength(2);
    await expect(t.scopes.persist(scope.getState().record, scope.getState().record.revision)).rejects.toThrow('another session');
  });
  it('reports read failures and holds durability until transaction completion', async () => {
    const t = fixture(); t.disk.holdCommit = true; let settled = false;
    const scope = t.begin(); const writing = scope.settled().then(() => { settled = true; });
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(settled).toBe(false); expect(scope.getState().durable).toBe(false);
    t.disk.holdCommit = false; t.disk.finishCommit!(); await writing; expect(scope.getState().durable).toBe(true);
    t.disk.readFailure = true; await expect(t.scopes.list('owner')).rejects.toThrow('read failed');
  });
});

// This seam owns provenance; callers cannot turn a displayed optimistic row into a snapshot.
describe('membership opening capture', () => {
  const state = (snapshots: ResourceSnapshot[]) => ({ snapshots, complete: true, freshness: 'cache' as const, checking: false, version: 1, error: null });
  it('requires a complete list, keeps submitted ancestry separate, and rejects forks/refusals', async () => {
    const t = fixture();
    expect(() => captureMembershipPins('owner', { ...state([]), complete: false }, [])).toThrow('complete');
    expect(captureMembershipPins('owner', state([snapshot('a')]), [])).toEqual([{ baseline: snapshot('a'), predecessor: null }]);
    const session = new DataSession(snapshot('a')); session.edit({ ...snapshot('a').value!, title: 'Queued title' });
    const request = (await t.queue.save('first', session.checkpoint()))!;
    const captured = captureMembershipPins('owner', state([snapshot('a')]), [request]);
    expect(captured[0].predecessor).toMatchObject({ id: request.id, value: { title: 'Queued title' } });
    expect(captured[0].baseline.value!.title).toBe('a');
    expect(() => captureMembershipPins('owner', state([snapshot('a')]), [request, { ...request, id: 'fork', editorId: 'fork' }])).toThrow('Resolve');
    expect(() => captureMembershipPins('owner', state([snapshot('a')]), [{ ...request, state: 'refused' }])).toThrow('Resolve');
    const deleted = { ...snapshot('gone'), value: null, metadata: { ...snapshot('gone').metadata!, deleted: true } };
    expect(captureMembershipPins('owner', state([deleted]), [])).toEqual([]);
    const newer = { ...snapshot('a'), value: { ...snapshot('a').value!, title: 'Accepted' }, metadata: { ...snapshot('a').metadata!, revision: 2 } };
    expect(captureMembershipPins('owner', state([snapshot('a')]), [{ ...request, state: 'acknowledged', result: { kind: 'acknowledged', operationId: request.id, snapshot: newer } }])[0].baseline).toEqual(newer);
  });
});

describe('DataEngine membership ownership', () => {
  function engineFixture() {
    const t = fixture();
    const cache = new Map(pins().map(pin => [pin.baseline.resource.id, pin.baseline]));
    const snapshots = { read: async (_owner: string, resource: { id: string }) => clone(cache.get(resource.id)),
      put: async (_owner: string, value: ResourceSnapshot) => { cache.set(value.resource.id, clone(value)); },
      list: async () => clone([...cache.values()]) };
    const transport = { read: async (_owner: string, resource: { id: string }) => snapshot(resource.id), send: t.send };
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const collections = new CollectionReader({ observer, snapshots,
      transport: { list: jest.fn(), changes: jest.fn() } as never,
      cursors: { read: async () => ({ version: 1, initialized: true, revision: 1 }), put: jest.fn() } });
    let id = 0;
    const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } });
    const engine = new DataEngine({ runtime, observer, transport, snapshots, collections, checkpoints: createIndexedDbCheckpoints(),
      commits: t.commits, membershipScopes: t.scopes, operationId: () => `engine-${++id}` });
    engine.setOnline(false); engine.setOwner('owner');
    return { ...t, engine, cache, collections };
  }
  it('creates and restores local input even when the optional series catalog cannot be read', async () => {
    const t = engineFixture(); const read = jest.spyOn(t.collections, 'read').mockRejectedValue(new Error('catalog offline'));
    const scope = await t.engine.beginMemberCreation('sermons', { title: '', verse: '', date: 'now', thoughts: [] });
    expect(read).not.toHaveBeenCalled();
    await scope.updateCreation({ ...scope.getState().record.creation!.value, title: 'Local title', verse: 'Romans 1' });
    const original = scope.getState().record;
    await expect(t.engine.openCreationSeries(original.scopeId)).rejects.toThrow('catalog offline');
    t.engine.setOwner(null); t.engine.setOwner('owner');
    expect(await t.engine.listMembershipRecovery()).toEqual([original]);
    const recovered = await t.engine.recoverMembership(original.scopeId);
    expect(recovered.getState().record.creation?.resource).toEqual(original.creation?.resource);
    expect(await recovered.save()).toHaveLength(1); expect(read).toHaveBeenCalledTimes(1);
    expect(t.send).not.toHaveBeenCalled(); t.engine.dispose();
  });
  it('publishes a closed stage and gives only one recovery dialog exclusive ownership', async () => {
    const t = engineFixture(), notified = jest.fn();
    const stop = t.engine.subscribeMembership(notified);
    const scope = await t.engine.beginMembership(); await scope.update(move);
    const id = scope.getState().record.scopeId;
    expect(await t.engine.listMembershipRecovery({ closedOnly: true })).toEqual([]);
    await expect(t.engine.recoverMembership(id, { exclusive: true })).rejects.toThrow('already open');
    t.engine.releaseMembership(id);
    await expect(t.engine.recoverMembership(id, { exclusive: true })).rejects.toThrow('already open');
    for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
    expect(notified).toHaveBeenCalled();
    expect(await t.engine.listMembershipRecovery({ closedOnly: true })).toHaveLength(1);
    const first = t.engine.recoverMembership(id, { exclusive: true });
    await expect(t.engine.recoverMembership(id, { exclusive: true })).rejects.toThrow('already open');
    const recovered = await first; expect(recovered.getState().record.action).toEqual(move);
    expect(await t.engine.listMembershipRecovery({ closedOnly: true })).toEqual([]);
    expect(t.send).not.toHaveBeenCalled(); stop(); t.engine.dispose();
  });

  it('opens and recovers through the engine without exposing a feature-owned queue', async () => {
    const t = engineFixture(), scope = await t.engine.beginMembership();
    t.cache.set('a', { ...snapshot('a', true), value: { ...snapshot('a', true).value!, title: 'Remote title after opening' } });
    await scope.update(move);
    expect(t.send).not.toHaveBeenCalled();
    const recovery = await t.engine.listMembershipRecovery(); expect(recovery).toHaveLength(1);
    const ids = await scope.save(); expect(ids).toHaveLength(2);
    expect((await t.commits.list('owner')).every(request => request.baseline.value!.title !== 'Remote title after opening')).toBe(true);
    expect(await t.engine.recoverMembership(recovery[0].scopeId)).toBe(scope);
    t.engine.setOwner('other'); expect(() => scope.getState()).toThrow('owner changed');
    expect(await t.engine.listMembershipRecovery()).toEqual([]);
    await expect(t.engine.recoverMembership(recovery[0].scopeId)).rejects.toThrow('no longer exists');
    t.engine.dispose();
  });
  it('discards a proven failed action through its owner and preserves later participant text', async () => {
    const t = engineFixture(), scope = await t.engine.beginMembership(); await scope.update(move); await scope.save();
    const scopeId = scope.getState().record.scopeId;
    expect(await t.engine.membershipDelivery(scopeId)).toMatchObject({ phase: 'queued', canDiscard: false });
    await expect(t.engine.discardMembership(scopeId)).rejects.toThrow('Resolve pending');
    for (const request of await t.commits.list('owner')) await t.commits.compareAndSet(request, {
      ...request, state: 'refused', command: null, result: { kind: 'refused', operationId: request.id, code: 'target-deleted' },
    });
    const editor = await t.engine.openEditor(snapshot('a').resource, 'participant');
    expect(await t.engine.membershipDelivery(scopeId)).toMatchObject({ phase: 'refused', canDiscard: true, code: 'target-deleted' });
    await editor.edit({ ...editor.getState().checkpoint.draft, title: 'Later title' });
    const compact = jest.spyOn(t.scopes, 'compact').mockRejectedValueOnce(new Error('compaction failed'));
    await expect(t.engine.discardMembership(scopeId)).rejects.toThrow('compaction failed');
    compact.mockRestore();
    await t.engine.discardMembership(scopeId);
    expect(editor.getState()).toMatchObject({ result: null, actionResolutionRequired: false, checkpoint: { pending: {}, draft: { items: [member], title: 'Later title' } } });
    expect(await t.engine.listMembershipRecovery()).toEqual([]);
    expect(await t.engine.membershipDelivery(scopeId)).toMatchObject({ phase: 'cancelled', canDiscard: false });
    t.engine.setOwner('other'); await expect(t.engine.discardMembership(scopeId)).rejects.toThrow('pending Save');
    t.engine.dispose();
  });
  it.each(['saving', 'submitted'])('retries %s persistence without inventing new Save identities', async phase => {
    const t = engineFixture(), scope = await t.engine.beginMembership(); await scope.update(move);
    const scopeId = scope.getState().record.scopeId, actual = t.scopes.persist;
    const persist = jest.spyOn(t.scopes, 'persist').mockImplementation(async (record, revision) => {
      if (record.phase === phase) throw new Error('disk failure');
      return actual(record, revision);
    });
    await expect(scope.save()).rejects.toThrow('disk failure');
    const before = await t.commits.list('owner'); persist.mockRestore();
    await t.engine.retryMembership(scopeId);
    expect(scope.getState()).toMatchObject({ durable: true, record: { phase: 'submitted' } });
    const after = await t.commits.list('owner'); expect(after).toHaveLength(2);
    if (before.length) expect(after.map(request => request.id)).toEqual(before.map(request => request.id));
    expect(t.send).not.toHaveBeenCalled(); t.engine.dispose();
  });
  it('keeps completed outcome evidence after compaction and never recaptures on retry', async () => {
    const t = engineFixture(), scope = await t.engine.beginMembership(), scopeId = scope.getState().record.scopeId;
    expect(await t.engine.membershipDelivery(scopeId)).toMatchObject({ phase: 'editing' });
    await scope.save(); expect(await t.engine.listMembershipRecovery()).toEqual([]);
    expect(await t.scopes.read('owner', scopeId)).toBeUndefined();
    expect(await t.engine.membershipDelivery(scopeId)).toMatchObject({ phase: 'acknowledged' });
    await t.engine.retryMembership(scopeId); expect(await t.commits.list('owner')).toEqual([]);
    expect(await t.engine.membershipDelivery('missing')).toMatchObject({ phase: 'unavailable' });
    t.engine.setOwner('other'); expect(await t.engine.membershipDelivery(scopeId)).toMatchObject({ phase: 'unavailable' });
    t.engine.dispose();
  });
  it('finishes invoked Save after navigation and preserves unsent selections on ordinary release', async () => {
    const t = engineFixture(), scope = await t.engine.beginMembership(); await scope.update(move);
    const scopeId = scope.getState().record.scopeId;
    const saving = scope.save(); t.engine.releaseMembership(scopeId);
    expect(await saving).toHaveLength(2);
    for (let index = 0; index < 80; index++) await Promise.resolve();
    expect((await t.scopes.read('owner', scopeId))!.phase).toBe('submitted');
    expect(await t.commits.list('owner')).toHaveLength(2);
    const recovered = await t.engine.recoverMembership(scopeId); expect(recovered).not.toBe(scope);
    expect(await recovered.save()).toHaveLength(2);
    t.engine.releaseMembership('missing'); t.engine.dispose();
  });
  it('releases pristine scopes without retaining payloads and retains unfinished choices', async () => {
    const t = engineFixture(), pristine = await t.engine.beginMembership();
    const firstId = pristine.getState().record.scopeId; t.engine.releaseMembership(firstId);
    for (let index = 0; index < 80; index++) await Promise.resolve();
    expect(await t.scopes.read('owner', firstId)).toBeUndefined();
    const staged = await t.engine.beginMembership(); await staged.update(move);
    const stagedId = staged.getState().record.scopeId; t.engine.releaseMembership(stagedId);
    for (let index = 0; index < 80; index++) await Promise.resolve();
    expect((await t.scopes.read('owner', stagedId))!.action).toEqual(move);
    expect(await t.commits.list('owner')).toEqual([]); t.engine.dispose();
  });
  it('reopens an unsent stage after engine disposal and exposes no completed or cancelled stages', async () => {
    const t = engineFixture(), scope = await t.engine.beginMembership(); await scope.update(move);
    const id = scope.getState().record.scopeId;
    t.engine.setOwner(null); t.engine.setOwner('owner');
    const recovered = await t.engine.recoverMembership(id);
    expect(recovered.getState().record.action).toEqual(move); expect(t.send).not.toHaveBeenCalled();
    await recovered.cancel(); expect(await t.engine.listMembershipRecovery()).toEqual([]);
    await expect(t.engine.recoverMembership('missing')).rejects.toThrow('no longer exists');
    t.engine.dispose();
  });
});


it('retains captured identity across ACK projection before the saving stage records request IDs', async () => {
  const t = fixture(), scope = t.begin(); await scope.update(move);
  t.persist.mockImplementation(async (record, revision) => {
    if (record.phase === 'submitted') throw new Error('crash before completion');
    return t.scopes.persist(record, revision);
  });
  await expect(scope.save()).rejects.toThrow('crash before completion');
  const first = await t.commits.list('owner');
  for (const request of first) await t.commits.compareAndSet(request, { ...request, state: 'acknowledged' });
  const transaction = createEngineStorageTransaction();
  await transaction<void>('readwrite', (store, read, done) => {
    first.forEach(request => store.delete(commitProjectionKey('owner', request.id)));
    collectCommitRows(store, read, 'owner', () => done(undefined));
  });
  expect(await t.commits.list('owner')).toHaveLength(2);
  t.persist.mockImplementation((record, revision) => t.scopes.persist(record, revision));
  const recovered = MembershipScope.restore((await t.scopes.read('owner', 'scope'))!, t.port);
  expect(await recovered.save()).toEqual(first.map(request => request.id));
  await t.scopes.compact('owner', 'scope');
  expect(await t.commits.list('owner')).toEqual([]);
});

it('keeps an already-satisfied target in the atomic move so its deletion can refuse source removal', async () => {
  const t = fixture(), captured = pins(); captured[1].baseline = snapshot('b', true);
  const scope = t.begin('duplicate-existing', captured); await scope.update(move); await scope.save();
  const requests = await t.commits.list('owner'); expect(requests).toHaveLength(2);
  expect(requests[1].value).toEqual(requests[1].baseline.value);
  expect(requests[0].atomic!.participants).toEqual(requests.map(request => request.id));
});
