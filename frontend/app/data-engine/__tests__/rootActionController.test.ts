import { CommitQueue, createMemoryCommitStore } from '../commits';
import { EditorController } from '../controller';
import { editorIdentity } from '../editorIdentity';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';

import type { CommitEvent } from '../commits';
import type { ResourceSnapshot } from '../types';

const snapshot: ResourceSnapshot = { resource: { collection: 'councils', id: 'root-controller' },
  value: { userId: 'owner', title: 'Original', status: 'preparing', topics: [] },
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
async function setup() {
  let sequence = 0;
  const store = createMemoryCommitStore();
  const runtime = new DataEngineRuntime({ journal: { list: async () => [], put: async () => undefined, remove: async () => undefined },
    transport: { read: async () => snapshot, send: jest.fn() } });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store, runtime, operationId: () => 'op-' + ++sequence,
    readConfirmed: async () => snapshot, canDeliver: () => false });
  queue.setOwner('owner');
  let notify: (event: CommitEvent) => void = () => undefined;
  jest.spyOn(queue, 'subscribe').mockImplementation(listener => { notify = listener; return () => undefined; });
  const reader = await EditorController.open({ owner: 'owner', editorId: 'reader', snapshot,
    store: { read: async () => undefined, put: async () => undefined }, runtime, commits: queue,
    operationId: () => 'unused', isCurrentOwner: () => true });
  const save = async (id: string) => {
    const session = new DataSession(snapshot); session.edit({ ...snapshot.value, title: id, status: 'held' });
    return (await queue.save(editorIdentity('tab', snapshot.resource, 'action', id), session.checkpoint(), { predecessorId: null }))!;
  };
  return { store, queue, reader, save, notify: (event: CommitEvent) => notify(event),
    close: () => { reader.dispose(); queue.setOwner(null); runtime.setOwner(null); } };
}

it.each([['a', 'b'], ['b', 'a']])('does not choose known root forks in event order %s then %s', async (first, second) => {
  const s = await setup();
  try {
    const roots = { a: await s.save('a'), b: await s.save('b') };
    s.notify({ request: roots[first as 'a' | 'b'] }); s.notify({ request: roots[second as 'a' | 'b'] }); await s.reader.settled();
    expect(s.reader.getState().checkpoint.draft).toEqual(snapshot.value);
    expect(s.reader.getState().checkpoint.pending).toEqual({});
  } finally { s.close(); }
});

it('keeps a later root separate after the first was projected', async () => {
  const s = await setup();
  try {
    const first = await s.save('first'); s.notify({ request: first }); await s.reader.settled();
    expect(s.reader.getState().checkpoint.draft?.title).toBe('first');
    const later = await s.save('later'); s.notify({ request: later }); await s.reader.settled();
    expect(s.reader.getState().checkpoint.draft?.title).toBe('first');
    expect(Object.keys(s.reader.getState().checkpoint.pending)).toEqual([first.id]);
    expect(s.reader.getState().checkpoint.confirmed).toEqual(snapshot);
  } finally { s.close(); }
});

it('does not project an old queued event after its durable request was cancelled', async () => {
  const s = await setup();
  try {
    const request = await s.save('cancelled');
    await s.store.compareAndSet(request, { ...request, state: 'cancelled' });
    s.notify({ request }); await s.reader.settled();
    expect(s.reader.getState().checkpoint.draft).toEqual(snapshot.value);
    expect(s.reader.getState().checkpoint.pending).toEqual({});
  } finally { s.close(); }
});

it('projects the matching current prepared update when the event was still queued', async () => {
  const s = await setup();
  try {
    const request = await s.save('prepared'); await s.queue.drain(false);
    expect((await s.queue.list())[0].state).toBe('prepared');
    s.notify({ request }); await s.reader.settled();
    expect(s.reader.getState().checkpoint.draft?.title).toBe('prepared');
    expect(Object.keys(s.reader.getState().checkpoint.pending)).toEqual([request.id]);
    expect(s.reader.getState().checkpoint.confirmed).toEqual(snapshot);
  } finally { s.close(); }
});

it('rejects an event whose captured words do not match the durable identity', async () => {
  const s = await setup();
  try {
    const request = await s.save('actual');
    s.notify({ request: { ...request, value: { ...snapshot.value, title: 'Different capture' } } });
    await expect(s.reader.settled()).rejects.toThrow('Saved generation cannot change its captured intent');
    expect(s.reader.getState().checkpoint.draft).toEqual(snapshot.value);
    expect(s.reader.getState().checkpoint.pending).toEqual({});
  } finally { s.close(); }
});
