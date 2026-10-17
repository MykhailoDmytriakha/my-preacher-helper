import { CommitQueue, createMemoryCommitStore } from '../commits';
import { EditorController } from '../controller';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { submittedWorkCheckpoint } from '../submittedWork';

import type { CommitEvent, CommitRequest } from '../commits';
import type { ResourceSnapshot } from '../types';

const snapshot: ResourceSnapshot = { resource: { collection: 'councils', id: 'branch-council' },
  value: { userId: 'owner', title: 'Original words', status: 'preparing', topics: [] },
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };

it.each([['a', 'b'], ['b', 'a']])('keeps already-known sibling branches separate in event order %s then %s', async (first, second) => {
  let sequence = 0;
  const runtime = new DataEngineRuntime({ journal: { list: async () => [], put: async () => undefined, remove: async () => undefined },
    transport: { read: async () => snapshot, send: jest.fn() } });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store: createMemoryCommitStore(), runtime, operationId: () => 'op-' + ++sequence,
    readConfirmed: async () => snapshot, canDeliver: () => false });
  queue.setOwner('owner');
  const initial = new DataSession(snapshot);initial.edit({ ...snapshot.value, status: 'held' });
  const parent = (await queue.save('parent', initial.checkpoint()))!;
  const submitted = submittedWorkCheckpoint('owner', snapshot.resource, [parent])!;
  let notify: (event: CommitEvent) => void = () => undefined;
  jest.spyOn(queue, 'subscribe').mockImplementation(listener => { notify = listener; return () => undefined; });
  const reader = await EditorController.open({ owner: 'owner', editorId: 'reader', snapshot,
    store: { read: async () => undefined, put: async () => undefined }, runtime, commits: queue,
    submittedCheckpoint: submitted, operationId: () => 'unused', isCurrentOwner: () => true });
  const branches = new Map<string, CommitRequest>();
  for (const id of ['a', 'b']) {
    const session = DataSession.restore(submitted);session.edit({ ...session.getState().draft, title: 'Branch ' + id });
    branches.set(id, (await queue.save('branch-' + id, session.checkpoint(), { predecessorId: parent.id }))!);
  }
  notify({ request: branches.get(first)! });notify({ request: branches.get(second)! });await reader.settled();
  expect(reader.getState().checkpoint.draft).toMatchObject({ title: 'Original words', status: 'held' });
  expect(Object.keys(reader.getState().checkpoint.pending)).toEqual([parent.id]);
  reader.dispose();queue.setOwner(null);runtime.setOwner(null);
});

it('does not infer a unique tip from tied pending generations', () => {
  const initial = new DataSession(snapshot);initial.edit({ ...snapshot.value, status: 'held' });
  initial.registerCommit('parent', 1, initial.getState().draft);
  initial.registerCommit('unknown-peer', 1, initial.getState().draft);
  const request = { id: 'child', owner: 'owner', editorId: 'child-editor', editGeneration: 2,
    baseline: snapshot, value: { ...snapshot.value, status: 'preparing' }, predecessor: 'parent', revision: 1,
    initialized: false, working: snapshot, intended: snapshot.value, command: null, submitted: null,
    sequence: 0, state: 'queued' as const, result: null, unfinalized: [] };
  const before = initial.checkpoint();
  expect(initial.adoptSubmittedSuccessor(request)).toBe(false);
  expect(initial.checkpoint()).toEqual(before);
});
