import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { collectCommitRows, commitProjectionKey } from '../retention.client';
import { DataSession } from '../session';
import { createEngineStorageTransaction, validateCommitReferences } from '../storage.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const snapshot = { resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'base' }, metadata: null };
const request = (id = 'request', editorId = 'editor', editGeneration = 1): CommitRequest => ({ id, owner: 'owner', editorId, editGeneration,
  baseline: snapshot, value: { ...snapshot.value, content: id }, predecessor: null, revision: 0, initialized: true, working: snapshot,
  intended: { ...snapshot.value, content: id }, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });
const record = (request: CommitRequest, completed = false): EditorRecord => {
  const session = new DataSession(snapshot); session.edit(request.value); session.registerCommit(request.id, request.editGeneration, request.value);
  if (completed) session.accept({ kind: 'acknowledged', operationId: request.id, snapshot: { ...snapshot, value: request.value } });
  return { owner: 'owner', editorId: request.editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [], completedCommits: completed ? [request.id] : [] };
};
const acknowledge = (request: CommitRequest): CommitRequest => ({ ...request, state: 'acknowledged', result: { kind: 'acknowledged', operationId: request.id, snapshot: { ...snapshot, value: request.value } } });
let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

it('bounds full payloads over a thousand acknowledged autosaves and factory reloads, retaining small dedupe markers', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  for (let i = 0; i < 1000; i += 1) {
    const created = await commits.create(request(`request-${i}`, `factory-${i}`));
    await commits.compareAndSet(created, acknowledge(created));
    await checkpoints.put(record(created, true));
  }
  expect(await commits.list('owner')).toEqual([]); expect(await checkpoints.listRecoverable('owner')).toEqual([]);
  const keys = [...storage.rows.keys()].map(key => JSON.parse(key));
  expect(keys.filter(key => ['request', 'checkpoint', 'reference'].includes(key[0]))).toEqual([]);
  expect(keys.filter(key => key[0] === 'generation')).toHaveLength(1000);
  expect(keys.filter(key => key[0] === 'identity')).toHaveLength(0);
  await expect(commits.create(request('different-id', 'factory-0'))).rejects.toMatchObject({ code: 'commit-generation-complete' });
}, 15000);

it('keeps one generation watermark for thousands of saves in one editor', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  for (let i = 1; i <= 1000; i += 1) {
    const created = await commits.create(request(`save-${i}`, 'editor', i));
    await commits.compareAndSet(created, acknowledge(created)); await checkpoints.put(record(created, true));
  }
  expect([...storage.rows]).toEqual([['["generation","owner","editor"]', { through: 1000 }]]);
}, 15000);

it('retains an ACK closed before projection, a pending checkpoint, and a staged manual predecessor', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints(), transaction = createEngineStorageTransaction();
  const created = await commits.create(request()); const accepted = await commits.compareAndSet(created, acknowledge(created));
  expect(await commits.list('owner')).toHaveLength(1); // No controller has durably projected this ACK.
  await checkpoints.put(record(created));
  await transaction<void>('readwrite', (store, read, done) => {
    validateCommitReferences(store, read, 'owner', [created.id], () => {
      store.put({ commitReferences: [created.id] }, ['manual', 'owner', 'scope']);
      collectCommitRows(store, read, 'owner', () => done(undefined));
    });
  });
  await checkpoints.put(record(created, true)); expect(await commits.list('owner')).toEqual([accepted]);
  await transaction<void>('readwrite', (store, read, done) => {
    store.delete(['manual', 'owner', 'scope']); collectCommitRows(store, read, 'owner', () => done(undefined));
  });
  expect(await commits.list('owner')).toEqual([]);
});

it('retains an uninitialized dependent until it owns its own rebased saved intent', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const a = await commits.create(request('A')); await commits.compareAndSet(a, acknowledge(a));
  const b = await commits.create({ ...request('B', 'editor', 2), predecessor: 'A', initialized: false });
  await checkpoints.put(record(a, true)); expect((await commits.list('owner')).map(item => item.id)).toEqual(['A', 'B']);
  await commits.compareAndSet(b, { ...b, initialized: true });
  expect((await commits.list('owner')).map(item => item.id)).toEqual(['B']);
  await expect(commits.create({ ...request('C', 'later', 1), predecessor: 'A', initialized: false })).rejects.toMatchObject({ code: 'commit-reference-changed' });
});

it('rejects a stale recovery reference atomically and rereads the source after projection raced the fork', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const a = await commits.create(request('A')); await checkpoints.put(record(a));
  const source = record(a);
  const read = jest.spyOn(checkpoints, 'read').mockImplementationOnce(async () => {
    await commits.compareAndSet(a, acknowledge(a));
    const updated = record(a, true); updated.checkpoint.draft!.content = 'later typing'; updated.checkpoint.dirty = true; updated.checkpoint.editGeneration += 1;
    await checkpoints.put(updated); return source;
  });
  const forked = await forkCheckpoint(checkpoints, 'owner', recoveryCheckpointId('owner', 'editor'), 'fork', snapshot.resource);
  expect(read).toHaveBeenCalledTimes(2);
  expect(forked.checkpoint).toMatchObject({ draft: { content: 'later typing' }, pending: {} });
  expect((await checkpoints.read('owner', 'fork'))?.checkpoint.draft?.content).toBe('later typing');
  await expect(checkpoints.create({ ...source, editorId: 'stale' })).rejects.toMatchObject({ code: 'commit-reference-changed' });
  expect(await checkpoints.read('owner', 'stale')).toBeUndefined();
});

it('does not release protection when the checkpoint transaction aborts', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const a = await commits.create(request()); await commits.compareAndSet(a, acknowledge(a));
  storage.writeFailure = true;
  const value = record(a, true); value.checkpoint.dirty = true;
  await expect(checkpoints.put(value)).rejects.toThrow('disk full'); storage.writeFailure = false;
  expect(storage.rows.has(JSON.stringify(commitProjectionKey('owner', a.id)))).toBe(true);
  expect(await commits.list('owner')).toHaveLength(1);
});
