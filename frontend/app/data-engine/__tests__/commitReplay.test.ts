import { CommitQueue, createMemoryCommitStore } from '../commits';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import type { CommitEvent } from '../commits';
import type { ResourceSnapshot } from '../types';

const snapshot: ResourceSnapshot = { resource: { collection: 'groups', id: 'replay' }, value: { userId: 'owner', title: 'Original', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
async function setup() {
  const store = createMemoryCommitStore(), read = jest.fn(async () => snapshot), send = jest.fn();
  const runtime = new DataEngineRuntime({ journal: { list: async () => [], put: async () => undefined, remove: async () => undefined }, transport: { read, send } });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store, runtime, operationId: () => 'capture', readConfirmed: read, canDeliver: () => false });
  queue.setOwner('owner');
  const session = new DataSession(snapshot); session.edit({ ...snapshot.value, title: 'Captured' });
  const request = (await queue.save('source', session.checkpoint()))!;
  const events: CommitEvent[] = []; const stop = queue.subscribe(event => events.push(event));
  return { store, queue, request, events, read, send, close: () => { stop(); queue.setOwner(null); runtime.setOwner(null); } };
}

it('does not replay a delayed queued list over a newer preparation event', async () => {
  const s = await setup(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const list = s.store.list.bind(s.store);
  const spy = jest.spyOn(s.store, 'list').mockImplementationOnce(async owner => { const rows = await list(owner); await gate; return rows; });
  try {
    const refreshing = s.queue.refreshStored();
    await s.queue.drain(false);
    const published = [...s.events];
    expect(published.at(-1)?.request).toMatchObject({ id: s.request.id, state: 'prepared' });
    expect(published.at(-1)!.request.revision).toBeGreaterThan(s.request.revision);
    const reads = s.read.mock.calls.length;
    release(); await refreshing;
    expect(s.events).toEqual(published);
    expect(s.read).toHaveBeenCalledTimes(reads); expect(s.send).not.toHaveBeenCalled();
  } finally { release(); spy.mockRestore(); s.close(); }
});

it('reoffers the same current capture after an earlier admission was blocked', async () => {
  const s = await setup();
  try {
    await s.queue.refreshStored(); await s.queue.refreshStored();
    expect(s.events.map(event => event.request.id)).toEqual([s.request.id, s.request.id]);
    expect(s.read).not.toHaveBeenCalled(); expect(s.send).not.toHaveBeenCalled();
  } finally { s.close(); }
});

it('discards a delayed local read after its owner changes', async () => {
  const s = await setup(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const list = s.store.list.bind(s.store);
  const spy = jest.spyOn(s.store, 'list').mockImplementationOnce(async owner => { const rows = await list(owner); await gate; return rows; });
  try {
    const refreshing = s.queue.refreshStored(); s.queue.setOwner('other'); release();
    expect(await refreshing).toEqual([]); expect(s.events).toEqual([]);
  } finally { release(); spy.mockRestore(); s.close(); }
});
