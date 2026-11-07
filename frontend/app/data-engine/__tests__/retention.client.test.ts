import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { collectCommitRows, commitProjectionKey, createCommitCollectionWindow } from '../retention.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { createEngineStorageTransaction, validateCommitReferences } from '../storage.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { ResourceSnapshot } from '../types';

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

it('finds a held backup by its reference without reading unrelated queued Saves', async () => {
  const commits = createIndexedDbCommitStore();
  const note = await commits.create({ ...request('backup'), retentionScope: 'draft-capture:v1:backup' });
  for (let index = 0; index < 25; index += 1) {
    await commits.create(request('ordinary-' + index, 'editor-' + index));
  }
  let ordinaryReads = 0;
  storage.onFullRead = (kind, mode, count) => {
    if (kind === 'request' && mode === 'readonly') ordinaryReads += count;
  };
  expect((await commits.listCaptures!('owner', 'draft-capture:v1:')).map(row => row.id)).toEqual([note.id]);
  expect(ordinaryReads).toBe(0);
});

it('does not rematerialize a long pending queue for each accepted Save during delivery', async () => {
  const measure = async (pending: number) => {
    storage = installStorageHarness();
    const collection = createCommitCollectionWindow();
    const commits = createIndexedDbCommitStore(collection.collect);
    const answered = await commits.create(request('answered'));
    for (let index = 0; index < pending; index += 1) {
      await commits.create(request('pending-' + index, 'editor-' + index));
    }
    await commits.compareAndSet(answered, acknowledge(answered));
    const finish = collection.begin('owner');
    const finishOverlap = collection.begin('owner');
    let scanned = 0;
    storage.onFullRead = (kind, mode, count) => { if (kind === 'request' && mode === 'readwrite') scanned += count; };
    await commits.releaseProjection!('owner', [answered.id]);
    await finish();
    const perAnswer = scanned;
    await finishOverlap();
    expect(scanned - perAnswer).toBe(pending + 1);
    expect((await commits.list('owner')).map(item => item.state)).toEqual(Array(pending).fill('queued'));
    return perAnswer;
  };
  const small = await measure(2);
  const large = await measure(80);
  expect(large).toBeLessThanOrEqual(small);
  expect(small).toBe(0);
});

it('keeps a long delivery pass from making every subsequent queue read revisit all released answers', async () => {
  const collection = createCommitCollectionWindow();
  const commits = createIndexedDbCommitStore(collection.collect);
  const answered = [];
  for (let index = 0; index < 40; index += 1) {
    const saved = await commits.create(request('answered-' + index, 'editor-' + index));
    answered.push(await commits.compareAndSet(saved, acknowledge(saved)));
  }
  const finish = collection.begin('owner');
  for (const saved of answered) await commits.releaseProjection!('owner', [saved.id]);
  const leftDuringDelivery = (await commits.list('owner')).length;
  await finish();
  expect(await commits.list('owner')).toEqual([]);
  expect(leftDuringDelivery).toBeLessThan(answered.length);
});

it('collects released rows on a later pass and keeps an answered row whose snapshot was not cached', async () => {
  const collection = createCommitCollectionWindow();
  const commits = createIndexedDbCommitStore(collection.collect);
  const released = await commits.create(request('released', 'first'));
  const held = await commits.create(request('uncached', 'second'));
  await commits.compareAndSet(released, acknowledge(released));
  await commits.compareAndSet(held, acknowledge(held));
  const abandoned = collection.begin('owner');
  await commits.releaseProjection!('owner', [released.id]);
  expect((await commits.list('owner')).map(row => row.id)).toEqual(['released', 'uncached']);
  // A new provider must be able to collect an interrupted pass from the same device store.
  await createCommitCollectionWindow().begin('owner')();
  expect((await commits.list('owner')).map(row => row.id)).toEqual(['uncached']);
  await abandoned();
});

it('bounds full payloads over a thousand acknowledged autosaves and factory reloads, retaining small dedupe markers', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  for (let i = 0; i < 1000; i += 1) {
    const created = await commits.create(request(`request-${i}`, `factory-${i}`));
    await commits.compareAndSet(created, acknowledge(created));
    await checkpoints.put(record(created, true));
    await commits.releaseProjection!('owner', [created.id]); // The shared snapshot cache now owns this ACK.
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
    await commits.releaseProjection!('owner', [created.id]);
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
  await checkpoints.put(record(created, true)); await commits.releaseProjection!('owner', [created.id]); expect(await commits.list('owner')).toEqual([accepted]);
  await transaction<void>('readwrite', (store, read, done) => {
    store.delete(['manual', 'owner', 'scope']); collectCommitRows(store, read, 'owner', () => done(undefined));
  });
  expect(await commits.list('owner')).toEqual([]);
});

it('retains an uninitialized dependent until it owns its own rebased saved intent', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const a = await commits.create(request('A')); await commits.compareAndSet(a, acknowledge(a));
  const b = await commits.create({ ...request('B', 'editor', 2), predecessor: 'A', initialized: false });
  await checkpoints.put(record(a, true)); await commits.releaseProjection!('owner', [a.id]); expect((await commits.list('owner')).map(item => item.id)).toEqual(['A', 'B']);
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
    await checkpoints.put(updated); await commits.releaseProjection!('owner', [a.id]); return source;
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

it('projects every accepted participant found on return without reloading unrelated pending Saves for each answer', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const transport = { read: jest.fn(), send: jest.fn() };
  const cache = new Map<string, ResourceSnapshot>();
  const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } });
  const engine = new DataEngine({ runtime, observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    transport, commits, checkpoints, operationId: () => 'unused', snapshots: {
      read: async (_owner, resource) => cache.get(resource.id),
      put: async (_owner, accepted) => { cache.set(accepted.resource.id, accepted); },
    } });
  try {
    engine.setOnline(false);
    engine.setOwner('owner');
    await engine.retry();
    const atomic = { id: 'a', participants: ['a', 'b'] };
    const alternate = { ...snapshot, resource: { ...snapshot.resource, id: 'second-note' } };
    const captured = await commits.createBatch!([
      { ...request('a', 'first'), atomic },
      { ...request('b', 'second'), atomic, baseline: alternate, working: alternate },
    ]);
    await commits.compareAndSetBatch!(captured.map(previous => ({ previous, next: {
      ...previous, state: 'acknowledged', result: { kind: 'acknowledged', operationId: previous.id,
        snapshot: { ...previous.baseline, value: previous.value } },
    } })));
    for (let index = 0; index < 20; index += 1) await commits.create(request('pending-' + index, 'other-' + index));

    let readOnlyQueueRows = 0;
    storage.onFullRead = (kind, mode, count) => { if (kind === 'request' && mode === 'readonly') readOnlyQueueRows += count; };
    engine.setVisible(true);
    // The release transaction is queued by a background subscriber, after the exact snapshots have been cached.
    for (let turn = 0; turn < 300; turn += 1) await Promise.resolve();

    expect([...cache.values()].map(accepted => accepted.value?.content).sort()).toEqual(['a', 'b']);
    expect(storage.rows.has(JSON.stringify(commitProjectionKey('owner', 'a')))).toBe(false);
    expect(storage.rows.has(JSON.stringify(commitProjectionKey('owner', 'b')))).toBe(false);
    expect(transport.send).not.toHaveBeenCalled();
    expect(readOnlyQueueRows).toBe(20);
  } finally { engine.dispose(); }
});

it('retains both atomic participants until every projection and delivery reference is released', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const atomic = { id: 'a', participants: ['a', 'b'] };
  const captured = await commits.createBatch!([{ ...request('a', 'first'), atomic }, { ...request('b', 'second'), atomic }]);
  const accepted = await commits.compareAndSetBatch!(captured.map(previous => ({ previous, next: { ...acknowledge(previous), unfinalized: ['a'] } })));
  await checkpoints.put(record(captured[0], true));
  expect(await commits.list('owner')).toHaveLength(2);
  await checkpoints.put(record(captured[1], true));
  expect(await commits.list('owner')).toHaveLength(2);
  await commits.compareAndSetBatch!(accepted.map(previous => ({ previous, next: { ...previous, unfinalized: [] } })));
  await commits.releaseProjection!('owner', atomic.participants);
  expect(await commits.list('owner')).toEqual([]);
});

it('retains a whole atomic group while another editor still depends on one participant', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const atomic = { id: 'a', participants: ['a', 'b'] };
  const captured = await commits.createBatch!([{ ...request('a', 'first'), atomic }, { ...request('b', 'second'), atomic }]);
  await commits.compareAndSetBatch!(captured.map(previous => ({ previous, next: acknowledge(previous) })));
  const later = await commits.create({ ...request('later', 'third'), predecessor: 'b', initialized: false });
  await checkpoints.put(record(captured[0], true)); await checkpoints.put(record(captured[1], true));
  await commits.releaseProjection!('owner', atomic.participants);
  expect(await commits.list('owner')).toHaveLength(3);
  await commits.compareAndSet(later, { ...later, initialized: true });
  expect((await commits.list('owner')).map(item => item.id)).toEqual(['later']);
});


it('retains an acknowledged payload across factory restart until its exact backup capture releases it', async () => {
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const scope = 'draft-capture:v1:exact';
  const created = await commits.create({ ...request('backup-owned'), retentionScope: scope });
  const accepted = await commits.compareAndSet(created, acknowledge(created));
  await checkpoints.put(record(accepted, true));
  await commits.releaseProjection!('owner', [created.id]);
  const reopened = createIndexedDbCommitStore();
  expect((await reopened.listCaptures!('owner', 'draft-capture:v1:')).map(row => row.id)).toEqual([created.id]);
  await reopened.releaseCapture!('another-owner', scope, created.id);
  await reopened.releaseCapture!('owner', 'membership-scope', created.id);
  await reopened.releaseCapture!('owner', scope, 'another-request');
  expect(await reopened.list('owner')).toHaveLength(1);
  await reopened.releaseCapture!('owner', scope, created.id);
  expect(await reopened.list('owner')).toEqual([]);
  expect(await reopened.listCaptures!('owner', 'draft-capture:v1:')).toEqual([]);
  expect([...storage.rows.keys()].map(key => JSON.parse(key)).filter(key => key[0] === 'reference')).toEqual([]);
});

it.each(['queued', 'refused'] as const)('releasing a backup capture never discards %s canonical work', async state => {
  const commits = createIndexedDbCommitStore();
  const created = await commits.create({ ...request('pending-owned'), retentionScope: 'draft-capture:v1:pending', state });
  await commits.releaseCapture!('owner', created.retentionScope!, created.id);
  expect((await commits.list('owner'))[0].value?.content).toBe(created.value?.content);
  expect(await commits.listCaptures!('owner', 'draft-capture:v1:')).toEqual([]);
});

it('lists only held capture references, excluding membership and released scopes', async () => {
  const commits = createIndexedDbCommitStore();
  const note = await commits.create({ ...request('note', 'note-editor'), retentionScope: 'draft-capture:v1:note' });
  const membership = await commits.create({ ...request('membership', 'member-editor'), retentionScope: 'membership-scope' });
  expect((await commits.listCaptures!('owner', 'draft-capture:v1:')).map(row => row.id)).toEqual([note.id]);
  await commits.releaseCapture!('owner', note.retentionScope!, note.id);
  expect(await commits.listCaptures!('owner', 'draft-capture:v1:')).toEqual([]);
  expect((await commits.listCaptures!('owner', 'membership-')).map(row => row.id)).toEqual([membership.id]);
});
