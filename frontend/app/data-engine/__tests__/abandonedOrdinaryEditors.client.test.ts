import { waitFor } from '@testing-library/react';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { collectAbandonedOrdinaryEditors } from '../abandonedOrdinaryEditors.client';
import { checkpointKey } from '../checkpointStorage.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { retirableEditorIdentity } from '../editorIdentity';
import { createOrdinaryEditorLeases } from '../ordinaryEditorLeases.client';
import { activeOrdinaryEditorKey, commitGenerationKey } from '../retention.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const owner = 'owner';
const resource = { collection: 'studyNotes', id: 'note' };
const opening = (id: string) => retirableEditorIdentity(id, resource, 'study-note', 'fresh');
const active = (editorId: string, account = owner) => JSON.stringify(activeOrdinaryEditorKey(account, editorId));
const generation = (editorId: string, account = owner) => JSON.stringify(commitGenerationKey({ owner: account, editorId }));
const original = { resource, value: { userId: owner, content: 'Opening words' }, metadata: null };
const request = (editorId: string, editGeneration = 1): CommitRequest => ({
  id: 'operation-' + editGeneration, owner, editorId, editGeneration, baseline: original,
  value: { ...original.value, content: 'Pending words' }, predecessor: null, revision: 0,
  initialized: true, working: original, intended: { ...original.value, content: 'Pending words' },
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
});

function locksByDocument() {
  const held = new Map<string, object>();
  const manager = { request: jest.fn(async (name: string, options: LockOptions, call: (lock: Lock | null) => unknown) => {
    expect(options.ifAvailable).toBe(true);
    if (held.has(name)) return call(null);
    const writing = {};
    held.set(name, writing);
    try { return await call({ name, mode: 'exclusive' }); }
    finally { if (held.get(name) === writing) held.delete(name); }
  }) };
  const heldName = (id: string) => [...held.keys()].find(name => name.endsWith(':' + id));
  return {
    leases: createOrdinaryEditorLeases(manager as unknown as Pick<LockManager, 'request'>)!,
    isHeld: (id: string) => Boolean(heldName(id)),
    crash: (id: string) => held.delete(heldName(id)!),
  };
}

let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });
const leaseId = (editorId: string) => (storage.rows.get(active(editorId)) as { lease: string }).lease;

it('reclaims only a clean writer whose actual lease is released', async () => {
  const lock = locksByDocument();
  const commits = createIndexedDbCommitStore(undefined, lock.leases);
  const ids = ['dead', 'live', 'legacy', 'other'].map(opening);
  const [dead, live, legacy, other] = ids;
  await commits.activateOrdinaryEditor!(owner, dead);
  await commits.activateOrdinaryEditor!(owner, live);
  storage.rows.set(active(legacy), true);
  storage.rows.set(active(other, 'elsewhere'), { lease: 'other-owner' });
  for (const id of [dead, live, legacy]) storage.rows.set(generation(id), { through: 1 });
  storage.rows.set(generation(other, 'elsewhere'), { through: 1 });
  expect(lock.isHeld(leaseId(dead))).toBe(true);
  expect(lock.crash(leaseId(dead))).toBe(true);

  await collectAbandonedOrdinaryEditors(owner, lock.leases);

  expect(storage.rows.has(active(dead))).toBe(false);
  expect(storage.rows.has(generation(dead))).toBe(false);
  expect(lock.isHeld(leaseId(live))).toBe(true);
  expect(storage.rows.has(generation(live))).toBe(true);
  expect(storage.rows.get(active(legacy))).toBe(true);
  expect(storage.rows.has(generation(legacy))).toBe(true);
  expect(storage.rows.has(active(other, 'elsewhere'))).toBe(true);
  expect(storage.rows.has(generation(other, 'elsewhere'))).toBe(true);
  await expect(commits.create(request(dead))).rejects.toMatchObject({ code: 'commit-editor-closed' });
  await expect(commits.create(request(live, 2))).resolves.toMatchObject({ editorId: live });
  await commits.retireOrdinaryEditor!(owner, live);
});

it('leaves a recoverable raw checkpoint, a queued request and their original replay guards', async () => {
  const lock = locksByDocument();
  const commits = createIndexedDbCommitStore(undefined, lock.leases);
  const withCheckpoint = opening('draft');
  const withRequest = opening('queue');
  await commits.activateOrdinaryEditor!(owner, withCheckpoint);
  await commits.activateOrdinaryEditor!(owner, withRequest);
  for (const id of [withCheckpoint, withRequest]) storage.rows.set(generation(id), { through: 1 });
  const checkpoint = JSON.stringify(checkpointKey(owner, withCheckpoint));
  const draft = { durable: 'words that must remain reachable' };
  storage.rows.set(checkpoint, draft);
  const pending = await commits.create(request(withRequest, 2));
  lock.crash(leaseId(withCheckpoint));
  lock.crash(leaseId(withRequest));

  await collectAbandonedOrdinaryEditors(owner, lock.leases);

  for (const id of [withCheckpoint, withRequest]) {
    expect(storage.rows.has(active(id))).toBe(true);
    expect(storage.rows.get(generation(id))).toEqual({ through: 1 });
  }
  expect(storage.rows.get(checkpoint)).toEqual(draft);
  expect(await commits.list(owner)).toMatchObject([pending]);
});

it('retains a live lease through a failed closing transaction and releases it after retry', async () => {
  const lock = locksByDocument();
  const commits = createIndexedDbCommitStore(undefined, lock.leases);
  const id = opening('retry-closing');
  await commits.activateOrdinaryEditor!(owner, id);
  const lease = leaseId(id);
  storage.rows.set(generation(id), { through: 1 });
  storage.writeFailureFor = (key, value) => JSON.stringify(key) === active(id) && value === undefined;

  await expect(commits.retireOrdinaryEditor!(owner, id)).rejects.toThrow();
  expect(lock.isHeld(lease)).toBe(true);
  await collectAbandonedOrdinaryEditors(owner, lock.leases);
  expect(storage.rows.get(generation(id))).toEqual({ through: 1 });

  storage.writeFailureFor = undefined;
  await commits.retireOrdinaryEditor!(owner, id);
  expect(lock.isHeld(lease)).toBe(false);
  expect(storage.rows.has(active(id))).toBe(false);
  expect(storage.rows.has(generation(id))).toBe(false);
});

it('keeps the writing lease until a live tab can retry its failed closing save', async () => {
  const lock = locksByDocument();
  const h = documentEngineHarness({
    ...original, metadata: { protocol: 1, generation: 'note-generation', revision: 1, deleted: false },
  }, { editorLeases: lock.leases });
  storage = h.storage;
  const tab = h.createBrowser();
  const id = opening('tab-with-close-retry');
  tab.engine.setOwner(owner);
  tab.engine.setOnline(true);
  try {
    const editor = await tab.engine.openEditor(resource, id);
    await editor.commit(value => ({ ...value!, content: 'Earlier confirmed words' }));
    await tab.engine.retry(resource);
    await waitFor(() => expect(h.server.value?.content).toBe('Earlier confirmed words'));
    await waitFor(() => expect(storage.rows.has(generation(id))).toBe(true));
    const lease = leaseId(id);
    tab.engine.setOnline(false);
    const latest = 'Words entered just before the tab left its editor';
    storage.writeFailureFor = key => Array.isArray(key) && key[2] === id && ['checkpoint', 'request'].includes(key[0]);
    await expect(editor.edit({ ...h.server.value!, content: latest })).rejects.toThrow();
    editor.close({ flush: true });
    await settleEngine(); await settleEngine();
    expect(await h.commits.list(owner)).toEqual([]);
    expect(h.server.value?.content).toBe('Earlier confirmed words');
    expect(lock.isHeld(lease)).toBe(true);
    const collector = jest.fn(lock.leases.runIfFree);
    await collectAbandonedOrdinaryEditors(owner, { runIfFree: collector });
    expect(collector).toHaveBeenCalledWith(lease, expect.any(Function));
    expect(storage.rows.has(active(id))).toBe(true);

    storage.writeFailureFor = undefined;
    tab.engine.setOnline(true);
    await tab.engine.retry(resource);
    await waitFor(() => expect(h.server.value?.content).toBe(latest));
    await waitFor(() => expect(storage.rows.has(active(id))).toBe(false));
    expect(lock.isHeld(lease)).toBe(false);
  } finally { storage.writeFailureFor = undefined; tab.dispose(); }
});

it('preserves a row changed after discovery and falls back when browser locking fails', async () => {
  const unavailable = { request: jest.fn(async () => { throw new Error('browser cannot acquire'); }) };
  const leases = createOrdinaryEditorLeases(unavailable as unknown as Pick<LockManager, 'request'>)!;
  const commits = createIndexedDbCommitStore(undefined, leases);
  const id = opening('unknown');
  await commits.activateOrdinaryEditor!(owner, id);
  expect(storage.rows.get(active(id))).toBe(true);
  storage.rows.set(active(id), { lease: 'first' });
  storage.rows.set(generation(id), { through: 1 });
  await collectAbandonedOrdinaryEditors(owner, leases);
  expect(storage.rows.get(active(id))).toEqual({ lease: 'first' });
  await collectAbandonedOrdinaryEditors(owner, { runIfFree: async (_lease, work) => {
    storage.rows.set(active(id), { lease: 'different' });
    await work();
  } });
  expect(storage.rows.get(active(id))).toEqual({ lease: 'different' });
  expect(storage.rows.get(generation(id))).toEqual({ through: 1 });
});
