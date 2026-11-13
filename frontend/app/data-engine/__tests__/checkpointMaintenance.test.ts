import { acknowledge, record, request, seedRequest, snapshot } from '@test-utils/checkpointFixtures';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { checkpointKey, writeCheckpointRecord } from '../checkpointStorage.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { collectCommitRows, commitProjectionKey, commitRowKey, commitSnapshotKey, createCommitCollectionWindow } from '../retention.client';
import { DataSession } from '../session';
import { createEngineStorageTransaction } from '../storage.client';
import { installStorageHarness } from './storageHarness';

import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });
const settle = async () => { for (let index = 0; index < 100; index += 1) await Promise.resolve(); };
const sweep = () => createCommitCollectionWindow().begin('owner')();
const hasRequest = (saved: ReturnType<typeof request>) => storage.rows.has(JSON.stringify(commitRowKey(saved)));

it('persists letters while a maintenance window is held, restarts, then collects in a fresh transaction', async () => {
  const saved = acknowledge(request('unrelated', 'old-editor')); seedRequest(storage, saved);
  const window = createCommitCollectionWindow(); const finish = window.begin('owner');
  const checkpoints = createIndexedDbCheckpoints(window.collect);
  for (const content of ['a', 'ab', 'all the unsent words']) await checkpoints.put(record(content));
  expect(hasRequest(saved)).toBe(true);
  const restarted = createIndexedDbCheckpoints();
  expect((await restarted.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('all the unsent words');
  storage.resetCounts(); await sweep();
  expect(storage.counts.transactions).toBe(1); expect(storage.counts.enumerations).toBe(9);
  expect(hasRequest(saved)).toBe(false);
  expect((await restarted.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('all the unsent words');
  await finish();
});

it('ends a delivery pass in the same complete store state as the former collecting put', async () => {
  const run = async (former: boolean) => {
    storage = installStorageHarness();
    seedRequest(storage, acknowledge(request('unrelated', 'old-editor')));
    const checkpoints = createIndexedDbCheckpoints();
    const target = record('exact unsent words');
    if (former) await createEngineStorageTransaction()<void>('readwrite', (store, read, done) => {
      writeCheckpointRecord(store, read, target, false, () => done(undefined), collectCommitRows);
    });
    else {
      await checkpoints.put(target);
      expect(hasRequest(request('unrelated', 'old-editor'))).toBe(true);
    }
    await sweep();
    expect((await checkpoints.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('exact unsent words');
    return [...storage.rows].map(([key, value]) => {
      const copy = { ...(value as object) }; delete (copy as { recoveryVersion?: string }).recoveryVersion;
      return [key, copy];
    }).sort(([left], [right]) => String(left).localeCompare(String(right)));
  };
  expect(await run(false)).toEqual(await run(true));
});

it.each(['pin-first', 'collector-first'] as const)('serializes two tabs safely when %s wins', async order => {
  const saved = acknowledge(request()); seedRequest(storage, saved);
  const tab = createIndexedDbCheckpoints(); const stale = record('recoverable words', 'other-tab', [saved]);
  if (order === 'pin-first') {
    const pin = tab.put(stale); const collecting = sweep(); await Promise.all([pin, collecting]);
    expect(hasRequest(saved)).toBe(true);
    expect((await tab.read('owner', 'other-tab'))?.checkpoint.pending[saved.id]).toBeDefined();
  } else {
    const collecting = sweep(); const pin = tab.put(stale);
    await expect(pin).rejects.toMatchObject({ code: 'commit-reference-changed' }); await collecting;
    expect(hasRequest(saved)).toBe(false); expect(await tab.read('owner', 'other-tab')).toBeUndefined();
    // Retry from current evidence without resurrecting the collected reference; keep every unsent word.
    await tab.put(record('recoverable words', 'other-tab'));
    expect((await tab.read('owner', 'other-tab'))?.checkpoint.draft?.content).toBe('recoverable words');
  }
});

it('does not report a late checkpoint completion as durable before its native outcome', async () => {
  const checkpoints = createIndexedDbCheckpoints(); let durable = false;
  storage.holdCompletionAfterCommit = (_rows, mode) => mode === 'readwrite';
  const writing = checkpoints.put(record('committed before callback')).then(() => { durable = true; });
  await settle();
  expect(durable).toBe(false);
  expect((await createIndexedDbCheckpoints().read('owner', 'editor'))?.checkpoint.draft?.content).toBe('committed before callback');
  storage.finishCompletion(); await writing; expect(durable).toBe(true);
});

it('rereads durable references after a collector is frozen mid-read and a tab queues a pin', async () => {
  const saved = acknowledge(request()); seedRequest(storage, saved);
  let resume!: () => void;
  const collecting = createEngineStorageTransaction()<void>('readwrite', (store, read, done) => {
    // Withhold one request result and the transaction commit, as a stopped tab would.
    storage.holdCommit = true;
    let held = false;
    collectCommitRows(store, (query, next) => read(query, value => {
      if (!held) { held = true; resume = () => next(value); } else next(value);
    }), 'owner', () => done(undefined));
  });
  await settle();
  let pinned = false;
  const checkpoints = createIndexedDbCheckpoints();
  const pin = checkpoints.put(record('queued words', 'other-tab', [saved])).then(() => { pinned = true; });
  // Attach rejection before releasing the held transaction.
  const rejected = expect(pin).rejects.toMatchObject({ code: 'commit-reference-changed' });
  await settle(); expect(pinned).toBe(false); expect(hasRequest(saved)).toBe(true);
  resume(); await settle(); storage.holdCommit = false; storage.finishCommit!();
  await collecting; await rejected;
  expect(hasRequest(saved)).toBe(false); expect(await checkpoints.read('owner', 'other-tab')).toBeUndefined();
  await checkpoints.put(record('queued words', 'other-tab'));
  expect((await checkpoints.read('owner', 'other-tab'))?.checkpoint.draft?.content).toBe('queued words');
});

it.each(['projection', 'origin'] as const)('rolls back target placement and all reference changes when %s deletion aborts', async failure => {
  const checkpoints = createIndexedDbCheckpoints();
  await checkpoints.put(record('source words', 'source'));
  await forkCheckpoint(checkpoints, 'owner', recoveryCheckpointId('owner', 'source'), 'fork', snapshot.resource);
  const saved = acknowledge(request('completed')); seedRequest(storage, saved);
  storage.rows.set(JSON.stringify(commitProjectionKey('owner', saved.id)), { commitReferences: [saved.id] });
  const before = new Map(storage.rows);
  const target = (await checkpoints.read('owner', 'fork'))!;
  target.checkpoint.dirty = failure === 'projection'; target.completedCommits = [saved.id];
  const failKey = failure === 'origin' ? checkpointKey('owner', 'source') : commitProjectionKey('owner', saved.id);
  storage.writeFailureFor = (key, value) => value === undefined && JSON.stringify(key) === JSON.stringify(failKey);
  await expect(checkpoints.put(target)).rejects.toThrow('disk full');
  storage.writeFailureFor = undefined;
  expect(storage.rows).toEqual(before);
  expect((await checkpoints.read('owner', 'source'))?.checkpoint.draft?.content).toBe('source words');
  expect((await checkpoints.read('owner', 'fork'))?.recoveryOrigins).toHaveLength(1);
});

it('preserves a later letter after an acknowledged Save and crash before maintenance', async () => {
  const commits = createIndexedDbCommitStore(); const checkpoints = createIndexedDbCheckpoints();
  const saved = await commits.create(request());
  const session = DataSession.restore(record('saved', 'editor', [saved]).checkpoint);
  session.edit({ ...snapshot.value, content: 'saved and then B' });
  await commits.compareAndSet(saved, acknowledge(saved));
  session.accept(acknowledge(saved).result!);
  await checkpoints.put({ ...record(), checkpoint: session.checkpoint(), completedCommits: [saved.id] });
  const restarted = createIndexedDbCheckpoints();
  expect((await restarted.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('saved and then B');
  expect(hasRequest(saved)).toBe(true);
  await createIndexedDbCommitStore().releaseProjection!('owner', [saved.id]);
  expect(hasRequest(saved)).toBe(false);
  expect((await restarted.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('saved and then B');
});

it('keeps hundreds of offline Saves and extra terminal payloads through reload without needing a timer', async () => {
  const checkpoints = createIndexedDbCheckpoints();
  const commits = createIndexedDbCommitStore();
  const pending: ReturnType<typeof request>[] = [];
  for (let index = 0; index < 300; index += 1) {
    const saved = await commits.createWithCheckpoint!(request(`offline-${index}`, 'editor', index + 1),
      captured => record(`offline words at Save ${index}`, 'editor', [...pending, captured]));
    pending.push(saved);
  }
  const terminal = acknowledge(request('old-terminal', 'closed-editor')); seedRequest(storage, terminal);
  await checkpoints.put(record('all 300 Saves and the final unsent sentence', 'editor', pending));
  const restarted = createIndexedDbCheckpoints();
  const recovered = (await restarted.read('owner', 'editor'))!;
  expect(recovered.checkpoint.draft?.content).toBe('all 300 Saves and the final unsent sentence');
  expect(Object.keys(recovered.checkpoint.pending)).toHaveLength(300); expect(hasRequest(terminal)).toBe(true);
  await sweep();
  expect(hasRequest(terminal)).toBe(false); pending.forEach(saved => expect(hasRequest(saved)).toBe(true));
  expect((await restarted.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('all 300 Saves and the final unsent sentence');
});

it('never lets another account maintenance collect the original owner words or payloads', async () => {
  const terminal = acknowledge(request('old-terminal')); seedRequest(storage, terminal);
  const checkpoints = createIndexedDbCheckpoints();
  await checkpoints.put(record('owner A private words'));
  await checkpoints.put({ ...record('owner B private words'), owner: 'other', checkpoint: {
    ...record('owner B private words').checkpoint, confirmed: { ...snapshot, value: { userId: 'other', content: 'base' } },
    draft: { userId: 'other', content: 'owner B private words' },
  } });
  await createCommitCollectionWindow().begin('other')();
  expect(hasRequest(terminal)).toBe(true);
  expect((await checkpoints.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('owner A private words');
  await sweep();
  expect((await checkpoints.read('other', 'editor'))?.checkpoint.draft?.content).toBe('owner B private words');
});

it('keeps real collectors for create, settleClosed and ordinary native Save capture', async () => {
  const collect = jest.fn(collectCommitRows); const checkpoints = createIndexedDbCheckpoints(collect);
  await checkpoints.put(record()); expect(collect).not.toHaveBeenCalled();
  await checkpoints.create(record('fork words', 'fork')); expect(collect).toHaveBeenCalledTimes(1);
  await checkpoints.settleClosed!('owner', []); expect(collect).toHaveBeenCalledTimes(2);
  const commits = createIndexedDbCommitStore(collect);
  await commits.createWithCheckpoint!(request(), saved => record('saved and typed', 'editor', [saved]));
  expect(collect).toHaveBeenCalledTimes(3);
  // An uncached accepted snapshot has its own hold, independent of the editor projection.
  const saved = (await commits.list('owner'))[0];
  await commits.compareAndSet(saved, acknowledge(saved));
  expect(storage.rows.has(JSON.stringify(commitSnapshotKey('owner', saved.id)))).toBe(true);
});


it.each(['start', 'retry'] as const)('collects deferred typing garbage through the existing engine %s pass', async pass => {
  const collection = createCommitCollectionWindow();
  const checkpoints = createIndexedDbCheckpoints(collection.collect);
  const commits = createIndexedDbCommitStore(collection.collect);
  const transport = { read: jest.fn(async () => snapshot), send: jest.fn() };
  const runtime = new DataEngineRuntime({ transport, journal: {
    list: async () => [], put: async () => undefined, remove: async () => undefined,
  } });
  const errors = jest.fn();
  const cache = new Map<string, ResourceSnapshot>();
  const engine = new DataEngine({ runtime, transport, commits, checkpoints, deferCommitCollection: collection.begin,
    observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    operationId: () => 'unused', onError: errors, snapshots: {
      read: async (_owner, ref) => cache.get(ref.id),
      put: async (_owner, accepted) => { cache.set(accepted.resource.id, accepted); },
    } });
  const terminal = acknowledge(request('released-before-pass', 'closed-editor'));
  try {
    engine.setOnline(false);
    if (pass === 'retry') { engine.setOwner('owner'); await engine.retry(); }
    seedRequest(storage, terminal);
    await checkpoints.put(record('words retained across the pass'));
    expect(hasRequest(terminal)).toBe(true);
    if (pass === 'start') {
      engine.setOwner('owner');
      for (let turn = 0; turn < 10; turn += 1) await settle();
    } else await engine.retry();
    expect(hasRequest(terminal)).toBe(false);
    expect((await checkpoints.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('words retained across the pass');
    expect(transport.send).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
  } finally { engine.dispose(); }
});
