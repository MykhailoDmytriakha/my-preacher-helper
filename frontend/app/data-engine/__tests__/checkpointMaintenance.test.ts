import { acknowledge, record, request, seedRequest, snapshot } from '@test-utils/checkpointFixtures';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { checkpointKey, writeCheckpointRecord } from '../checkpointStorage.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { manualChoiceRecoveryIdentity, protectSermonRecoveryEditor, recoveryEditorIdentity } from '../editorIdentity';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { COMMIT_ROW_KINDS, collectCommitRows, commitProjectionKey, commitRowKey, commitSnapshotKey, createCommitCollectionWindow } from '../retention.client';
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
  expect(storage.counts.transactions).toBe(1);
  // Checkpoints, manual records and references, plus three indexed key ranges for the
  // tracked generations and forms. Non-sermon Saves do not read protected ranges.
  expect(storage.counts.enumerations).toBe(COMMIT_ROW_KINDS.length + 6);
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

it('keeps an answered request referenced by a protected sketch copy through the generic collection sweep', async () => {
  const saved = acknowledge(request()); seedRequest(storage, saved);
  const editorId = protectSermonRecoveryEditor('sketch-recovery-fork', 'sermon-placed-sketch');
  const checkpoints = createIndexedDbCheckpoints();
  await checkpoints.put(record('private sketch', editorId, [saved]));
  await sweep();

  expect(hasRequest(saved)).toBe(true);
  expect((await checkpoints.read('owner', editorId))?.checkpoint.pending[saved.id]).toBeDefined();
  await checkpoints.put(record('remaining new words', editorId));
  await sweep();

  expect(hasRequest(saved)).toBe(false);
  expect((await checkpoints.read('owner', editorId))?.checkpoint.draft?.content).toBe('remaining new words');
});

const protectedChoices = ['sermon-note', 'sermon-header', 'sermon-church', 'sermon-preparation-check',
  'sermon-thought-placement', 'sermon-thought-removal', 'sermon-thought-lock', 'sermon-placed-sketch', 'sermon-amended-sketch',
  'sermon-scratch-removal', 'sermon-scratch-text'] as const;

function protectedCopy(kind: typeof protectedChoices[number]) {
  const confirmed: ResourceSnapshot = { ...snapshot, resource: { collection: 'sermons', id: 'sermon' },
    value: { userId: 'owner', title: 'Original words' },
    metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false } };
  const draft = { ...confirmed.value, title: 'Private words after recovery' };
  const session = new DataSession(confirmed);
  session.edit(draft);
  const editorId = recoveryEditorIdentity(manualChoiceRecoveryIdentity('earlier-refusal', 'chosen-copy', kind), 'fresh');
  const captured = { ...request('protected-save', editorId), baseline: confirmed, working: confirmed, intended: draft, value: draft };
  const saved = { ...acknowledge(captured), result: { kind: 'acknowledged' as const, operationId: captured.id,
    snapshot: { ...confirmed, value: draft } } };
  session.registerCommit(saved.id, saved.editGeneration, draft);
  const guard = kind === 'sermon-scratch-text' ? { guardedScratchText: {
    sermonId: confirmed.resource.id, generation: 'sermon-generation', observedRevision: 1, pending: [],
    target: { kind: 'scratch' as const, id: 'sketch', createdAt: '2026-11-27' }, text: 'Original words',
  } } : {};
  return { editorId, saved, checkpoint: { owner: 'owner', editorId, checkpoint: { ...session.checkpoint(), ...guard },
    prepared: null, unfinalized: [] } };
}

it.each(protectedChoices)('retains and releases an acknowledged Save for an existing %s checkpoint without a bridge', async kind => {
  const { editorId, saved, checkpoint } = protectedCopy(kind);
  const key = JSON.stringify(checkpointKey('owner', editorId));
  seedRequest(storage, saved);
  // This physical row was written before the current writer could create a reference for it.
  storage.rows.set(key, checkpoint);
  await sweep();

  expect(hasRequest(saved)).toBe(true);
  const checkpoints = createIndexedDbCheckpoints();
  const exact = (await checkpoints.read('owner', editorId))!;
  expect(exact.checkpoint.pending[saved.id]).toBeDefined();
  await checkpoints.discardRecovery!(exact, () => true);
  await sweep();

  expect(hasRequest(saved)).toBe(false);
  expect(await checkpoints.read('owner', editorId)).toBeUndefined();
});

it.each(protectedChoices)('writes a legacy-readable Save reference with every new %s checkpoint', async kind => {
  const { editorId, saved, checkpoint } = protectedCopy(kind);
  const reference = JSON.stringify(['reference', 'owner', 'placed-sketch-checkpoint', editorId]);
  seedRequest(storage, saved);
  const checkpoints = createIndexedDbCheckpoints();
  await checkpoints.put(checkpoint);

  expect(storage.rows.get(reference)).toEqual({ commitReferences: [saved.id] });
  const exact = (await checkpoints.read('owner', editorId))!;
  await checkpoints.discardRecovery!(exact, () => true);
  expect(storage.rows.has(reference)).toBe(false);
});

it('keeps an amended sketch and its pending append in versioned native storage', async () => {
  const editorId = protectSermonRecoveryEditor('amended-sketch-fork', 'sermon-amended-sketch');
  const confirmed: ResourceSnapshot = { ...snapshot, resource: { collection: 'sermons', id: 'sermon' },
    value: { userId: 'owner', title: 'Sermon', scratch: [] } };
  const draft = { ...confirmed.value, scratch: [{ id: 'new', createdAt: '2026-11-25T00:00:00.000Z', text: 'Corrected words' }] };
  const captured = { ...request('amended', editorId), amendedScratchAppend: true as const,
    baseline: confirmed, working: confirmed, intended: draft, value: draft };
  const session = new DataSession(confirmed);
  session.edit(draft);
  session.applyCommit(captured);
  const checkpoints = createIndexedDbCheckpoints(), commits = createIndexedDbCommitStore();
  await commits.create(captured);
  await checkpoints.put({ ...record('unused', editorId), checkpoint: session.checkpoint() });
  await sweep();

  expect(checkpointKey('owner', editorId)).toEqual(['sermon-amended-sketch-choice-checkpoint', 'owner', editorId]);
  expect(commitRowKey(captured)).toEqual(['sermon-amended-sketch-request', 'owner', editorId, captured.editGeneration]);
  expect(storage.rows.has(JSON.stringify(['checkpoint', 'owner', editorId]))).toBe(false);
  expect(storage.rows.has(JSON.stringify(['request', 'owner', editorId, captured.editGeneration]))).toBe(false);
  const [reopened] = await createIndexedDbCheckpoints().listManualChoiceCopies!('owner', confirmed.resource);
  expect(reopened.record.checkpoint.pending[captured.id]).toMatchObject({ amendedScratchAppend: 'captured', value: draft });
  expect(await createIndexedDbCommitStore().list('owner')).toMatchObject([{ id: captured.id, amendedScratchAppend: true }]);
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
