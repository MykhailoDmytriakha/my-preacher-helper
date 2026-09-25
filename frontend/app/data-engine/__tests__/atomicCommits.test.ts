import { createEngineStorageTransaction, engineOwnerRange } from '../storage.client';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { collectionDocumentViews } from '../collectionView';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { planDataCommand } from '../serverRelations';
import { submittedWorkCheckpoint } from '../submittedWork';
import { reconcileRecoveryRecord } from '../recovery.client';
import { installStorageHarness } from './storageHarness';
import type { CommandResult, EngineTransport, JournalEntry, ResourceSnapshot } from '../types';
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const member = { id: 'member', type: 'group', refId: 'group', position: 1 };
const series = (id: string, occupied = false): ResourceSnapshot => ({ resource: { collection: 'series', id },
  value: { userId: 'owner', title: id, theme: id, bookOrTopic: '', status: 'draft', items: occupied ? [member] : [], sermonIds: [], seriesKind: occupied ? 'group' : 'sermon', createdAt: 'now', updatedAt: 'now' },
  metadata: { protocol: 1, generation: `g-${id}`, revision: 1, deleted: false } });
const capture = (snapshot: ResourceSnapshot, items: unknown[]) => {
  const session = new DataSession(snapshot); session.edit({ ...snapshot.value, items } as never); return session.checkpoint();
};
function setup() {
  const storage = installStorageHarness(), requests = createIndexedDbCommitStore();
  const rows = new Map(['a', 'b', 'c'].map(id => [id, series(id, id === 'a')]));
  const group: ResourceSnapshot = { resource: { collection: 'groups', id: 'group' }, value: { userId: 'owner', title: 'group', status: 'draft', templates: [], flow: [] }, metadata: null };
  const entries = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  let sequence = 0, loseAck = false;
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, resource) => copy(rows.get(resource.id) ?? { resource, value: null, metadata: null })),
    send: jest.fn(async command => {
      if (receipts.has(command.operationId)) return copy(receipts.get(command.operationId)!);
      const plan = await planDataCommand(command, rows.get(command.resource.id) ?? { resource: command.resource, value: null, metadata: null }, {
        get: async resource => copy(resource.collection === 'groups' ? { ...group, resource } : rows.get(resource.id)!),
        list: async collection => collection === 'series' ? copy([...rows.values()].filter(row => row.resource.collection === 'series')) : [],
      });
      for (const snapshot of plan.writes) rows.set(snapshot.resource.id, copy(snapshot));
      const result = plan.result.kind === 'acknowledged' ? { ...plan.result,
        relatedSnapshots: plan.writes.filter(snapshot => snapshot.resource.id !== command.resource.id) } : plan.result;
      receipts.set(command.operationId, copy(result));
      if (loseAck) { loseAck = false; throw new Error('connection lost after commit'); }
      return result;
    }),
  };
  const makeRuntime = () => new DataEngineRuntime({ transport, journal: {
      list: async owner => copy([...entries.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { entries.set(entry.command.operationId, copy(entry)); },
      remove: async (_owner, id) => { entries.delete(id); },
    } });
  const make = () => {
    const runtime = makeRuntime();
    const queue = new CommitQueue({ store: requests, runtime, readConfirmed: resource => transport.read('owner', resource), operationId: () => `operation-${++sequence}` });
    runtime.setOwner('owner'); queue.setOwner('owner'); return { queue, runtime };
  };
  const moving = () => [{ editorId: 'from', captured: capture(series('a', true), []) }, { editorId: 'to', captured: capture(series('b'), [member]) }];
  const makeEngine = () => {
    const cached = new Map(['a', 'b', 'c'].map(id => [id, series(id, id === 'a')]));
    const runtime = makeRuntime();
    const engine = new DataEngine({ runtime, transport, commits: requests, checkpoints: createIndexedDbCheckpoints(),
      observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
      snapshots: { read: async (_owner, resource) => copy(cached.get(resource.id)), put: async (_owner, snapshot) => { cached.set(snapshot.resource.id, copy(snapshot)); } },
      operationId: () => `operation-${++sequence}` });
    engine.setOnline(false); engine.setOwner('owner'); return engine;
  };
  return { storage, requests, rows, entries, receipts, transport, make, makeEngine, moving, loseAck: () => { loseAck = true; } };
}
it('keeps both pending sides across restart and sends exactly one immutable command', async () => {
  const s = setup(); let { queue } = s.make();
  const saved = await queue.saveAtomic(s.moving());
  await queue.drain(false); expect(s.transport.send).not.toHaveBeenCalled();
  const pending = collectionDocumentViews('owner', 'series', [series('a', true), series('b')], await queue.list());
  expect(pending.map(view => [view.resource.id, view.pending, view.value?.items])).toEqual([['a', true, []], ['b', true, [member]]]);
  ({ queue } = s.make()); await queue.drain(true);
  expect(s.transport.send).toHaveBeenCalledTimes(1);
  expect((await queue.list()).map(row => row.state)).toEqual(['acknowledged', 'acknowledged']);
  expect(s.rows.get('a')?.value?.items).toEqual([]); expect(s.rows.get('b')?.value?.items).toEqual([member]); expect(s.entries.size).toBe(0);
  expect((await queue.list()).map(row => row.result)).toMatchObject(saved.map(row => ({ operationId: row.id, snapshot: { resource: row.baseline.resource } })));
});

const creatingMember = () => {
  const creation = new DataSession({ resource: { collection: 'sermons', id: 'new' }, value: null, metadata: null });
  creation.edit({ userId: 'owner', title: 'New sermon', verse: 'Romans 1', date: 'now', thoughts: [] });
  const linked = new DataSession(series('b'));
  linked.edit({ ...series('b').value, items: [{ id: 'sermon-new', type: 'sermon', refId: 'new', position: 1 }], sermonIds: ['new'] });
  return [{ editorId: 'new-sermon', captured: creation.checkpoint(), predecessorId: null },
    { editorId: 'series-link', captured: linked.checkpoint(), predecessorId: null }];
};
it('captures new member and membership together offline, hides them from old readers, and delivers after restart', async () => {
  const s = setup(); let { queue } = s.make();
  s.storage.writeFailure = true; await expect(queue.saveAtomic(creatingMember())).rejects.toThrow('disk full');
  expect(await queue.list()).toEqual([]); s.storage.writeFailure = false;
  const saved = await queue.saveAtomic(creatingMember());
  expect(await queue.saveAtomic(creatingMember())).toEqual(saved);
  const transaction = createEngineStorageTransaction();
  const legacy = await transaction('readonly', (store, read, done) => {
    read(store.getAll(engineOwnerRange('request', 'owner')), ordinary => {
      read(store.getAll(engineOwnerRange('atomic-request', 'owner')), atomic => done([...ordinary, ...atomic]));
    });
  });
  expect(legacy).toEqual([]); await queue.drain(false); expect(s.transport.send).not.toHaveBeenCalled();
  expect(collectionDocumentViews('owner', 'sermons', [], await queue.list())[0]).toMatchObject({ pending: true, value: { title: 'New sermon' } });
  ({ queue } = s.make()); await queue.drain(true);
  expect(s.transport.send).toHaveBeenCalledTimes(1);
  expect(jest.mocked(s.transport.send).mock.calls[0][0]).toMatchObject({ kind: 'relation', relation: 'series-member-create' });
  expect((await queue.list()).map(row => row.state)).toEqual(['acknowledged', 'acknowledged']);
  expect(s.rows.get('new')?.value?.title).toBe('New sermon'); expect(s.rows.get('b')?.value?.sermonIds).toEqual(['new']);
});

it('replays lost creation acknowledgement with one identity and refuses partial cancellation', async () => {
  const s = setup(); let { queue } = s.make(); const saved = await queue.saveAtomic(creatingMember()); s.loseAck();
  await queue.drain(true); expect((await queue.list()).every(row => row.state === 'prepared')).toBe(true);
  await expect(queue.cancelAction(saved.map(row => row.id))).rejects.toThrow('Resolve pending');
  ({ queue } = s.make()); await queue.drain(true);
  expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.operationId)).toEqual([saved[0].id, saved[0].id]);
  expect(s.rows.get('new')?.metadata?.revision).toBe(1); expect(s.rows.get('b')?.value?.items).toHaveLength(1);
  expect((await queue.list()).every(row => row.state === 'acknowledged')).toBe(true);
});

it('refuses and discards the whole creation when the pinned destination is deleted', async () => {
  const s = setup(); const { queue } = s.make(); const saved = await queue.saveAtomic(creatingMember());
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true); expect((await queue.list()).every(row => row.state === 'refused')).toBe(true);
  expect(s.rows.has('new')).toBe(false);
  await queue.cancelAction(saved.map(row => row.id)); expect((await queue.list()).every(row => row.state === 'cancelled')).toBe(true);
});
it('replays unknown delivery after restart with the same identity and preserves merged secondary fields', async () => {
  const s = setup(); let { queue } = s.make();
  await queue.saveAtomic(s.moving()); s.rows.get('b')!.value!.title = 'remote sibling'; s.loseAck();
  await queue.drain(true); expect((await queue.list()).every(row => row.state === 'prepared')).toBe(true);
  await expect(queue.cancelAction((await queue.list()).filter(row => row.editorId === 'from').map(row => row.id))).rejects.toThrow('Resolve pending');
  ({ queue } = s.make()); await queue.drain(true);
  expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.operationId)).toEqual(['operation-1', 'operation-1']);
  expect((await queue.list())[1].result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'remote sibling', items: [member] } } });
});
it('holds the ACK journal when atomic result persistence fails and projects neither participant early', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving()); await queue.drain(false);
  const cas = s.requests.compareAndSetBatch!.bind(s.requests);
  const failing = jest.spyOn(s.requests, 'compareAndSetBatch').mockImplementation(async changes => {
    if (changes.some(change => change.next.state === 'acknowledged')) throw new Error('disk full'); return cas(changes);
  });
  await expect(queue.drain(true)).rejects.toThrow('disk full');
  expect((await queue.list()).map(row => row.state)).toEqual(['prepared', 'prepared']);
  expect([...s.entries.values()].map(entry => entry.state)).toEqual(['acknowledged']);
  failing.mockRestore(); await queue.drain(true);
  expect(s.transport.send).toHaveBeenCalledTimes(1); expect(s.entries.size).toBe(0);
});
it('waits for a captured predecessor on either side and preserves later edits to each participant', async () => {
  const s = setup(); const { queue } = s.make();
  const draft = new DataSession(series('b')); draft.edit({ ...series('b').value, title: 'first title' });
  const predecessor = await queue.save('to', draft.checkpoint()); draft.edit({ ...draft.checkpoint().draft, items: [member] });
  const saved = await queue.saveAtomic([s.moving()[0], { editorId: 'to', captured: draft.checkpoint(), predecessorId: predecessor!.id }]);
  const handoff = submittedWorkCheckpoint('owner', series('a').resource, await queue.list())!;
  const later = DataSession.restore(handoff); later.edit({ ...handoff.draft, title: 'later source title' });
  await queue.save('new-source-screen', later.checkpoint(), { predecessorId: saved[0].id }); await queue.drain(true);
  expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['update', 'relation', 'update']);
  expect(s.rows.get('a')?.value).toMatchObject({ title: 'later source title', items: [] });
  expect(s.rows.get('b')?.value).toMatchObject({ title: 'first title', items: [member] });
});
it('refuses a competing assignment as a whole and explicit cancellation retires both participants', async () => {
  const s = setup(); const { queue } = s.make();
  await queue.saveAtomic(s.moving()); s.rows.get('a')!.value!.items = []; s.rows.get('c')!.value!.items = [member]; await queue.drain(true);
  expect((await queue.list()).every(row => row.state === 'refused')).toBe(true); expect(s.rows.get('b')?.value?.items).toEqual([]);
  await queue.cancelAction((await queue.list()).filter(row => row.editorId === 'to').map(row => row.id)); expect((await queue.list()).every(row => row.state === 'cancelled')).toBe(true);
});
it('atomically captures once for repeated Save and never publishes or sends a failed local capture', async () => {
  const s = setup(); const { queue } = s.make(); const listener = jest.fn(); queue.subscribe(listener); s.storage.writeFailure = true;
  await expect(queue.saveAtomic(s.moving())).rejects.toThrow('disk full');
  expect(await queue.list()).toEqual([]); expect(listener).not.toHaveBeenCalled(); expect(s.transport.send).not.toHaveBeenCalled();
  s.storage.writeFailure = false; const saved = await queue.saveAtomic(s.moving());
  expect(await queue.saveAtomic(s.moving())).toEqual(saved); expect(await queue.list()).toHaveLength(2);
});

it('deduplicates simultaneous capture from two tabs without inventing a second action', async () => {
  const s = setup(); const a = s.make(), b = s.make();
  const results = await Promise.all([a.queue.saveAtomic(s.moving()), b.queue.saveAtomic(s.moving())]);
  expect(results[0]).toEqual(results[1]); expect(await a.queue.list()).toHaveLength(2);
  await Promise.all([a.queue.drain(true), b.queue.drain(true)]);
  expect(new Set(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.operationId)).size).toBe(1);
  expect((await a.queue.list()).every(record => record.state === 'acknowledged')).toBe(true);
});

it('keeps a failed predecessor visible from both participants without delivering a partial move', async () => {
  const s = setup(); const { queue } = s.make();
  const draft = new DataSession(series('b')); draft.edit({ ...series('b').value, title: 'mine' });
  const predecessor = await queue.save('to', draft.checkpoint()); draft.edit({ ...draft.checkpoint().draft, items: [member] });
  await queue.saveAtomic([s.moving()[0], { editorId: 'to', captured: draft.checkpoint(), predecessorId: predecessor!.id }]);
  s.rows.get('b')!.value!.title = 'theirs'; await queue.drain(true);
  expect((await queue.list()).filter(record => record.atomic).map(record => record.state)).toEqual(['refused', 'refused']);
  expect(s.transport.send).toHaveBeenCalledTimes(1); expect(s.rows.get('a')?.value?.items).toEqual([member]);
});

it('requires proof for a converged secondary participant instead of silently accepting its optimistic value', async () => {
  const s = setup(); const { queue } = s.make();
  await queue.saveAtomic(s.moving()); s.rows.set('a', series('a')); s.rows.set('b', series('b', true));
  await queue.drain(true);
  expect((await queue.list()).map(row => row.state)).toEqual(['acknowledged', 'acknowledged']);
  expect(s.rows.get('b')?.metadata).toMatchObject({ revision: 2, operationId: 'operation-1' });
});

it('does not publish late participant results after an account switch', async () => {
  const s = setup(); const { queue, runtime } = s.make(); await queue.saveAtomic(s.moving());
  const sending = s.transport.send; let finish!: (result: CommandResult) => void;
  jest.mocked(s.transport.send).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const run = queue.drain(true);
  for (let i = 0; i < 200 && !finish; i++) await Promise.resolve();
  expect(finish).toBeDefined(); const listener = jest.fn(); queue.subscribe(listener);
  queue.setOwner('other'); runtime.setOwner('other');
  finish({ kind: 'refused', operationId: 'operation-1', code: 'permission-denied' });
  await expect(run).rejects.toThrow('Account changed');
  expect(await queue.list()).toEqual([]); expect(listener).not.toHaveBeenCalled(); expect(sending).toHaveBeenCalledTimes(1);
});

it('keeps both participants pending when an old server omits secondary evidence', async () => {
  const s = setup(); const { queue } = s.make();
  const send = jest.mocked(s.transport.send).getMockImplementation()!;
  jest.mocked(s.transport.send).mockImplementation(async command => {
    const result = await send(command);
    if (result.kind !== 'acknowledged') return result;
    return { ...result, affected: [], relatedSnapshots: [] };
  });
  await queue.saveAtomic(s.moving()); await expect(queue.drain(true)).rejects.toThrow('missing participant proof');
  expect((await queue.list()).every(row => row.state === 'prepared')).toBe(true);
  expect(s.entries.size).toBe(1);
});

it('reads omitted secondary copies and refuses stale proof without retiring the immutable journal', async () => {
  const s = setup(); const { queue } = s.make(); const send = jest.mocked(s.transport.send).getMockImplementation()!;
  jest.mocked(s.transport.send).mockImplementation(async command => {
    const result = await send(command); return result.kind === 'acknowledged' ? { ...result, relatedSnapshots: undefined } : result;
  });
  jest.mocked(s.transport.read).mockResolvedValueOnce(series('b'));
  await queue.saveAtomic(s.moving()); await expect(queue.drain(true)).rejects.toThrow('does not prove');
  expect(s.entries.size).toBe(1); await queue.drain(true);
  expect((await queue.list()).every(row => row.state === 'acknowledged')).toBe(true); expect(s.transport.send).toHaveBeenCalledTimes(1);
});

it('delivers successive offline moves through exact participant dependencies, then keeps later typing', async () => {
  const s = setup(); const { queue } = s.make(); const first = await queue.saveAtomic(s.moving());
  const b = DataSession.restore(submittedWorkCheckpoint('owner', series('b').resource, await queue.list())!);
  b.edit({ ...b.checkpoint().draft, items: [] });
  await queue.saveAtomic([{ editorId: 'to', captured: b.checkpoint(), predecessorId: first[1].id },
    { editorId: 'third', captured: capture(series('c'), [member]) }]);
  await queue.drain(false); expect(s.transport.send).not.toHaveBeenCalled();
  await queue.drain(true);
  expect(s.transport.send).toHaveBeenCalledTimes(2);
  expect(['a', 'b', 'c'].map(id => s.rows.get(id)?.value?.items)).toEqual([[], [], [member]]);
  expect((await queue.list()).every(row => row.state === 'acknowledged')).toBe(true);
});

it('preserves typing made after the move when both participant acknowledgements arrive', async () => {
  const s = setup(); const { queue } = s.make(); const saved = await queue.saveAtomic(s.moving());
  const sessions = saved.map(record => {
    const session = DataSession.restore(submittedWorkCheckpoint('owner', record.baseline.resource, saved)!);
    session.edit({ ...session.checkpoint().draft, title: 'unsent later typing' }); return session;
  });
  await queue.drain(true);
  for (const [index, record] of (await queue.list()).entries()) {
    sessions[index].applyCommit(record);
    expect(sessions[index].checkpoint()).toMatchObject({ draft: { title: 'unsent later typing' }, dirty: true, pending: {}, conflicts: [] });
  }
  expect(s.rows.get('a')?.value?.title).toBe('a'); expect(s.rows.get('b')?.value?.title).toBe('b');
});

it('refuses a deleted destination without removing the source or reviving the target', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving());
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true);
  expect((await queue.list()).every(record => record.state === 'refused')).toBe(true);
  expect(s.rows.get('a')?.value?.items).toEqual([member]); expect(s.rows.get('b')?.value).toBeNull();
});

it('rejects unrelated ordinary fields in an atomic membership action without sending them', async () => {
  const s = setup(); const { queue } = s.make(); const moving = s.moving(); moving[0].captured.draft!.title = 'sneaked title';
  await queue.saveAtomic(moving); await queue.drain(true);
  expect(s.transport.send).not.toHaveBeenCalled(); expect((await queue.list()).map(record => record.result)).toMatchObject([
    { kind: 'refused', code: 'atomic-membership-only' }, { kind: 'refused', code: 'atomic-membership-only' },
  ]);
});

it('cannot replace captured intent or mix one existing participant with a new action', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving());
  const changed = s.moving(); changed[0].captured.draft!.items = [member];
  await expect(queue.saveAtomic(changed)).rejects.toThrow('cannot change');
  await expect(queue.saveAtomic([s.moving()[0], { ...s.moving()[1], editorId: 'new' }])).rejects.toThrow('cannot change');
  await expect(queue.saveAtomic([s.moving()[0], s.moving()[0]])).rejects.toThrow('Invalid atomic');
  expect(await queue.list()).toHaveLength(2);
});


it('resumes both sides through real DataEngine editors and refreshes stale cache when the ACK omits copies', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving());
  const send = jest.mocked(s.transport.send).getMockImplementation()!;
  jest.mocked(s.transport.send).mockImplementation(async command => {
    const result = await send(command); return result.kind === 'acknowledged' ? { ...result, relatedSnapshots: undefined } : result;
  });
  const engine = s.makeEngine();
  try {
    const a = await engine.openEditor(series('a').resource, 'reopened-a');
    const b = await engine.openEditor(series('b').resource, 'reopened-b');
    expect(a.getState().checkpoint.draft?.items).toEqual([]);
    expect(b.getState().checkpoint.draft?.items).toEqual([member]);
    await b.edit({ ...b.getState().checkpoint.draft, title: 'later unsent' });
    engine.setOnline(true); await engine.retry();
    for (let i = 0; i < 150; i++) await Promise.resolve();
    expect(a.getState().checkpoint).toMatchObject({ pending: {}, dirty: false, confirmed: { value: { items: [] } } });
    expect(b.getState().checkpoint).toMatchObject({ pending: {}, draft: { title: 'later unsent' }, confirmed: { value: { title: 'b', items: [member] } } });
    expect(s.transport.read).toHaveBeenCalledWith('owner', series('b').resource);
    expect(s.entries.size).toBe(0);
  } finally { engine.dispose(); }
});

it('projects a source conflict only to its own editor and retains both failed drafts for a joint decision', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving());
  s.rows.get('a')!.value!.items = [{ ...member, title: 'changed by another device' }];
  await queue.drain(true);
  const records = await queue.list();
  expect(records[0]).toMatchObject({ state: 'conflict', result: { kind: 'conflict', snapshot: { resource: series('a').resource } } });
  expect(records[1]).toMatchObject({ state: 'refused', result: { kind: 'refused', code: 'atomic-operation-conflict' } });
  const result = records[0].result;
  expect(result?.kind === 'conflict' && result.conflicts.every(conflict => conflict.path[0] === 'items')).toBe(true);
  await queue.cancelAction((await queue.list()).filter(row => row.editorId === 'from').map(row => row.id)); expect((await queue.list()).every(record => record.state === 'cancelled')).toBe(true);
});

it('does not partially cancel an atomic pair when persistence fails during the explicit decision', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving());
  s.rows.get('a')!.value!.items = []; s.rows.get('c')!.value!.items = [member]; await queue.drain(true);
  s.storage.writeFailure = true; await expect(queue.cancelAction((await queue.list()).filter(row => row.editorId === 'from').map(row => row.id))).rejects.toThrow('disk full'); s.storage.writeFailure = false;
  expect((await queue.list()).every(record => record.state === 'refused')).toBe(true);
  await queue.cancelAction((await queue.list()).filter(row => row.editorId === 'to').map(row => row.id)); expect((await queue.list()).every(record => record.state === 'cancelled')).toBe(true);
});

it('waits for a queued destination creation instead of treating its local value as a confirmed generation', async () => {
  const s = setup(); const { queue } = s.make();
  const absent = { resource: series('b').resource, value: null, metadata: null }; s.rows.set('b', absent);
  const creating = new DataSession(absent); creating.edit(series('b').value);
  const predecessor = await queue.save('new-series', creating.checkpoint()); creating.edit({ ...creating.checkpoint().draft, items: [member] });
  await queue.saveAtomic([s.moving()[0], { editorId: 'new-series', captured: creating.checkpoint(), predecessorId: predecessor!.id }]);
  await queue.drain(true);
  expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'relation']);
  expect(s.rows.get('b')?.value?.items).toEqual([member]);
  expect((await queue.list()).every(record => record.state === 'acknowledged')).toBe(true);
});


it('moves several source series into one destination with one atomic command and no intermediate assignment', async () => {
  const s = setup(); const { queue } = s.make();
  const second = { ...member, id: 'second', refId: 'second-group' };
  const third = { ...series('c'), value: { ...series('c').value, items: [second] } };
  s.rows.set('c', third);
  await queue.saveAtomic([s.moving()[0], { editorId: 'target', captured: capture(series('b'), [member, { ...second, position: 2 }]) },
    { editorId: 'other-source', captured: capture(third, []) }]);
  await queue.drain(false); expect(s.transport.send).not.toHaveBeenCalled();
  await queue.drain(true);
  expect(s.transport.send).toHaveBeenCalledTimes(1);
  expect(['a', 'b', 'c'].map(id => s.rows.get(id)?.value?.items)).toEqual([[], [member, { ...second, position: 2 }], []]);
  expect((await queue.list()).every(record => record.state === 'acknowledged')).toBe(true);
});

it('refuses an oversized participant group before storing or sending any part', async () => {
  const s = setup(); const { queue } = s.make();
  const captures = Array.from({ length: 101 }, (_, index) => ({ editorId: `editor-${index}`, captured: capture(series(`series-${index}`), [member]) }));
  await expect(queue.saveAtomic(captures)).rejects.toThrow('Invalid atomic');
  expect(await queue.list()).toEqual([]); expect(s.transport.send).not.toHaveBeenCalled();
});


it('hides atomic captures from an older tab that only understands ordinary request rows', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving());
  const transaction = createEngineStorageTransaction();
  const oldRows = await transaction('readonly', (store, read, done) => read(store.getAll(engineOwnerRange('request', 'owner')), done));
  expect(oldRows).toEqual([]);
  expect(await queue.list()).toHaveLength(2);
  const ordinary = new DataSession(series('c')); ordinary.edit({ ...series('c').value, title: 'ordinary remains compatible' });
  await queue.save('ordinary', ordinary.checkpoint());
  const compatible = await transaction('readonly', (store, read, done) => read(store.getAll(engineOwnerRange('request', 'owner')), done));
  expect(compatible).toHaveLength(1);
});

it('stores one immutable wire payload for a participant group and exposes delivery from either editor', async () => {
  const s = setup(); const { queue } = s.make(); await queue.saveAtomic(s.moving()); await queue.drain(false);
  const prepared = await queue.list();
  expect(prepared.filter(record => record.command)).toHaveLength(1);
  const engine = s.makeEngine();
  try {
    const a = await engine.openEditor(series('a').resource, 'delivery-a');
    const b = await engine.openEditor(series('b').resource, 'delivery-b');
    await engine.retry();
    expect(a.getDelivery()).toHaveLength(1); expect(b.getDelivery()).toHaveLength(1);
    expect(a.getDelivery()[0].command.operationId).toBe(b.getDelivery()[0].command.operationId);
    expect(b.getState().checkpoint.pending[prepared[1].id].operations).toContain(prepared[0].id);
  } finally { engine.dispose(); }
});


it('prevents a participant editor from replacing a refused move with one ordinary save', async () => {
  const s = setup(), { queue } = s.make(); await queue.saveAtomic(s.moving());
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true);
  const engine = s.makeEngine();
  const editor = await engine.openEditor(series('a').resource, 'participant-resolver');
  expect(editor.getState().checkpoint.draft!.items).toEqual([]);
  expect(editor.getState().actionResolutionRequired).toBe(true);
  await expect(editor.keepLocal()).rejects.toMatchObject({ code: 'atomic-action-resolution-required' });
  await expect(editor.acceptRemote()).rejects.toMatchObject({ code: 'atomic-action-resolution-required' });
  expect((await s.requests.list('owner')).every(request => request.state === 'refused')).toBe(true);
  expect(s.rows.get('a')!.value!.items).toEqual([member]);
  engine.dispose();
});


it('whole-action discard removes both pending projections but preserves later unsent typing', async () => {
  const s = setup(), { queue } = s.make(); const captured = await queue.saveAtomic(s.moving());
  const sessions = captured.map(request => DataSession.restore(submittedWorkCheckpoint('owner', request.baseline.resource, captured)!));
  sessions[0].edit({ ...sessions[0].checkpoint().draft, title: 'Later unsent title' });
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true);
  for (const [index, request] of (await queue.list()).entries()) sessions[index].applyCommit(request);
  await queue.cancelAction(captured.map(request => request.id));
  for (const [index, request] of (await queue.list()).entries()) sessions[index].applyCommit(request);
  expect(sessions[0].checkpoint()).toMatchObject({ draft: { items: [member], title: 'Later unsent title' }, dirty: true, pending: {} });
  expect(sessions[1].checkpoint()).toMatchObject({ draft: { items: [] }, dirty: false, pending: {} });
  const before = sessions[0].checkpoint(); sessions[0].applyCommit((await queue.list())[0]);
  expect(sessions[0].checkpoint()).toEqual(before);
  expect(s.rows.get('a')!.value!.items).toEqual([member]);
});

it('retains metadata saved after a refused move when the whole dependent chain is discarded', async () => {
  const s = setup(), { queue } = s.make(); const first = await queue.saveAtomic(s.moving());
  const checkpoint = submittedWorkCheckpoint('owner', series('a').resource, first)!;
  const session = DataSession.restore(checkpoint); session.edit({ ...session.checkpoint().draft, title: 'My later saved title' });
  const later = (await queue.save('later-editor', session.checkpoint(), { predecessorId: first[0].id }))!;
  session.applyCommit(later);
  const closed = { owner: 'owner', editorId: 'later-editor', prepared: null, checkpoint: session.checkpoint(), unfinalized: [], completedCommits: [] };
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true);
  await queue.cancelAction(first.map(request => request.id));
  for (const request of await queue.list()) if (request.baseline.resource.id === 'a') session.applyCommit(request);
  expect(session.checkpoint()).toMatchObject({ draft: { items: [member], title: 'My later saved title' }, pending: {}, dirty: true });
  expect((await queue.list()).every(request => request.state === 'cancelled')).toBe(true);
  expect(reconcileRecoveryRecord(closed, await queue.list()).checkpoint).toMatchObject({ draft: { items: [member], title: 'My later saved title' }, pending: {}, dirty: true });
});

it('rolls back the complete discard when a dependent request changes during cancellation', async () => {
  const s = setup(), { queue } = s.make(); const first = await queue.saveAtomic(s.moving());
  const session = DataSession.restore(submittedWorkCheckpoint('owner', series('a').resource, first)!);
  session.edit({ ...session.checkpoint().draft, title: 'Dependent title' });
  const later = (await queue.save('later', session.checkpoint(), { predecessorId: first[0].id }))!;
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true);
  const actualBatch = s.requests.compareAndSetBatch!;
  const batch = jest.spyOn(s.requests, 'compareAndSetBatch').mockImplementationOnce(async changes => {
    const dependent = changes.find(change => change.previous.id === later.id)!;
    await actualBatch([{ previous: dependent.previous, next: dependent.previous }]);
    return actualBatch(changes);
  });
  await expect(queue.cancelAction(first.map(request => request.id))).rejects.toMatchObject({ code: 'commit-changed' });
  expect((await queue.list()).some(request => request.state === 'cancelled')).toBe(false);
  batch.mockRestore(); await queue.cancelAction(first.map(request => request.id));
  expect((await queue.list()).every(request => request.state === 'cancelled')).toBe(true);
});

it('does not silently resolve an unrelated text conflict while retiring several participants in a chain', async () => {
  const s = setup(), { queue } = s.make(); const first = await queue.saveAtomic(s.moving());
  const session = DataSession.restore(submittedWorkCheckpoint('owner', series('a').resource, first)!);
  session.edit({ ...session.checkpoint().draft, title: 'My saved title' });
  const later = (await queue.save('later', session.checkpoint(), { predecessorId: first[0].id }))!; session.applyCommit(later);
  s.rows.set('b', { ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  await queue.drain(true);
  session.observe({ ...series('a', true), value: { ...series('a', true).value!, title: 'Other device title' }, metadata: { ...series('a').metadata!, revision: 2 } }, { source: 'server' });
  await queue.cancelAction(first.map(request => request.id));
  for (const request of await queue.list()) if (request.baseline.resource.id === 'a') session.applyCommit(request);
  expect(session.checkpoint()).toMatchObject({ draft: { title: 'My saved title', items: [member] }, remoteCandidate: { value: { title: 'Other device title' } } });
  expect(session.checkpoint().conflicts.some(conflict => conflict.path[0] === 'title')).toBe(true);
});
