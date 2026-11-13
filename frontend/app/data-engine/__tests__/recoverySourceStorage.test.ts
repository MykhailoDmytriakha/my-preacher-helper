import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { checkpointKey } from '../checkpointStorage.client';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const resource: ResourceRef = { collection: 'studyNotes', id: 'note' };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const checkpointKeyString = (uid: string, editorId: string) => JSON.stringify(checkpointKey(uid, editorId));
const initial = (uid = owner, ref = resource, revision = 1, content = 'confirmed words'): ResourceSnapshot => ({
  resource: ref,
  value: { userId: uid, title: 'Storage probe', content, scriptureRefs: [], tags: [], isDraft: false,
    createdAt: '2026-11-01', updatedAt: '2026-11-01' },
  metadata: { protocol: 1, generation: 'storage-probe-generation', revision, deleted: false },
});
function editorRecord(editorId: string, uid = owner, ref = resource): EditorRecord {
  const session = new DataSession(initial(uid, ref));
  session.edit({ ...initial(uid, ref).value!, content: `private words ${editorId}` });
  return { owner: uid, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
}
function acceptRemote(record: EditorRecord): EditorRecord {
  const session = DataSession.restore(record.checkpoint);
  const remote = initial(record.owner, record.checkpoint.confirmed.resource, 2, `server words for ${record.editorId}`);
  session.observe(remote, { source: 'server' });
  session.acceptRemote();
  return { ...record, checkpoint: session.checkpoint() };
}

let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

it('pins a valid legacy row by CAS and changes only its stored version', async () => {
  const store = createIndexedDbCheckpoints();
  const legacy = editorRecord('legacy');
  storage.rows.set(checkpointKeyString(owner, 'legacy'), clone(legacy));

  const version = await store.pinRecovery!(legacy);

  expect(version).toEqual(expect.any(String));
  const pinned = await store.read(owner, 'legacy');
  expect(pinned?.recoveryVersion).toBe(version);
  const payload = clone(pinned!); delete payload.recoveryVersion;
  expect(payload).toEqual(legacy);
});

it('rejects a stale source pin after a newer durable checkpoint write', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('source'));
  const stale = (await store.read(owner, 'source'))!;
  const newer = clone(stale); newer.checkpoint.draft!.content = 'newer durable words';
  await store.put(newer);

  expect(await store.pinRecovery!(stale)).toBeNull();
  expect((await store.read(owner, 'source'))?.checkpoint.draft?.content).toBe('newer durable words');
});

it('rotates storage identity on repeated writes and a baseline projection with unchanged draft words', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('source'));
  const first = (await store.read(owner, 'source'))!;
  await store.put(first);
  const repeated = (await store.read(owner, 'source'))!;
  expect(repeated.checkpoint.draft).toEqual(first.checkpoint.draft);
  expect(repeated.recoveryVersion).not.toBe(first.recoveryVersion);

  const projected = clone(repeated);
  projected.checkpoint.confirmed = initial(owner, resource, 2, 'confirmed words');
  projected.checkpoint.remoteCandidate = initial(owner, resource, 3, 'newer server words');
  await store.put(projected);
  const afterProjection = (await store.read(owner, 'source'))!;
  expect(afterProjection.checkpoint.draft).toEqual(repeated.checkpoint.draft);
  expect(afterProjection.recoveryVersion).not.toBe(repeated.recoveryVersion);
});

it('retires only the pinned origin after a typed fork becomes clean', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('source'));
  await store.put(editorRecord('unrelated'));
  const fork = await forkCheckpoint(store, owner, recoveryCheckpointId(owner, 'source'), 'fork', resource);
  expect(fork.recoveryOrigins).toEqual([{ id: recoveryCheckpointId(owner, 'source'), version: expect.any(String) }]);

  await store.put(acceptRemote((await store.read(owner, 'fork'))!));

  expect(await store.read(owner, 'source')).toBeUndefined();
  expect(await store.read(owner, 'fork')).toBeUndefined();
  expect((await store.read(owner, 'unrelated'))?.checkpoint.draft?.content).toBe('private words unrelated');
});

it('preserves a source edited after the fork pinned its earlier version', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('source'));
  const fork = await forkCheckpoint(store, owner, recoveryCheckpointId(owner, 'source'), 'fork', resource);
  const source = (await store.read(owner, 'source'))!;
  const changed = clone(source); changed.checkpoint.draft!.content = 'words added after fork';
  await store.put(changed);

  await store.put(acceptRemote((await store.read(owner, 'fork'))!));

  expect((await store.read(owner, 'source'))?.checkpoint.draft?.content).toBe('words added after fork');
  expect((await store.read(owner, 'source'))?.recoveryVersion).not.toBe(fork.recoveryOrigins?.[0]?.version);
});

it('does not retire foreign-owner or wrong-resource source identities', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('foreign', 'other'));
  await store.put(editorRecord('wrong-resource', owner, { ...resource, id: 'another-note' }));
  const foreign = (await store.read('other', 'foreign'))!;
  const wrongResource = (await store.read(owner, 'wrong-resource'))!;
  const target = acceptRemote(editorRecord('target'));
  target.recoveryOrigins = [
    { id: recoveryCheckpointId('other', 'foreign'), version: foreign.recoveryVersion! },
    { id: recoveryCheckpointId(owner, 'wrong-resource'), version: wrongResource.recoveryVersion! },
  ];

  await store.put(target);

  expect(await store.read('other', 'foreign')).toBeDefined();
  expect(await store.read(owner, 'wrong-resource')).toBeDefined();
});

it('retains a source when origin evidence contains conflicting versions for one ID', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('source'));
  const source = (await store.read(owner, 'source'))!;
  const target = acceptRemote(editorRecord('target'));
  target.recoveryOrigins = [
    { id: recoveryCheckpointId(owner, 'source'), version: source.recoveryVersion! },
    { id: recoveryCheckpointId(owner, 'source'), version: 'different-captured-version' },
  ];

  await store.put(target);

  expect((await store.read(owner, 'source'))?.checkpoint.draft?.content).toBe('private words source');
});

it.each(['pending', 'prepared', 'unfinalized'] as const)('does not settle origins while target has %s work', async kind => {
  const store = createIndexedDbCheckpoints();
  const sourceId = `source-${kind}`, targetId = `target-${kind}`;
  await store.put(editorRecord(sourceId));
  await forkCheckpoint(store, owner, recoveryCheckpointId(owner, sourceId), targetId, resource);
  const target = (await store.read(owner, targetId))!;
  target.checkpoint.dirty = false;
  if (kind === 'pending') {
    const requestId = 'queued-probe';
    target.checkpoint.pending[requestId] = { generation: 2, value: clone(target.checkpoint.draft!) };
    const key = ['request', owner, targetId, 2];
    storage.rows.set(JSON.stringify(['identity', owner, requestId]), key);
    storage.rows.set(JSON.stringify(key), { id: requestId, owner, editorId: targetId, editGeneration: 2,
      state: 'queued', unfinalized: [], baseline: { resource }, value: clone(target.checkpoint.draft!) });
  } else if (kind === 'prepared') {
    const session = DataSession.restore({ ...target.checkpoint, dirty: true });
    target.prepared = session.prepare('prepared-probe', owner)!;
    expect(target.prepared).not.toBeNull();
    target.checkpoint = session.checkpoint();
    target.checkpoint.dirty = false;
  } else {
    target.unfinalized = ['finalize-probe'];
  }

  await store.put(target);

  expect((await store.read(owner, sourceId))?.checkpoint.draft?.content).toBe(`private words ${sourceId}`);
  expect((await store.read(owner, targetId))?.recoveryOrigins).toHaveLength(1);
});

it('rolls back source deletion and target cleanup when the native transaction fails', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(editorRecord('source'));
  await forkCheckpoint(store, owner, recoveryCheckpointId(owner, 'source'), 'fork', resource);
  const target = acceptRemote((await store.read(owner, 'fork'))!);
  storage.writeFailureFor = key => JSON.stringify(key) === checkpointKeyString(owner, 'source');

  await expect(store.put(target)).rejects.toThrow('disk full');
  storage.writeFailureFor = undefined;

  expect((await store.read(owner, 'source'))?.checkpoint.draft?.content).toBe('private words source');
  expect((await store.read(owner, 'fork'))?.recoveryOrigins).toHaveLength(1);
});
