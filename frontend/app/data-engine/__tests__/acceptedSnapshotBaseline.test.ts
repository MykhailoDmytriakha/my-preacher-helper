import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngine } from '../engine';
import { eachFailure } from '../failures';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { createEngineStorageTransaction } from '../storage.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = { resource, value: { userId: 'owner', title: 'Opening title', content: 'Opening words', tags: [], scriptureRefs: [], isDraft: false,
  createdAt: '2026-10-18', updatedAt: '2026-10-18' }, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };

it.each(['next opening', 'application restart'].flatMap(mode => ['closed before acceptance', 'open through acceptance'].map(lifetime => [mode, lifetime])))
  ('continues its accepted edit after snapshot-cache failure and %s with the editor %s', async (mode, lifetime) => {
  const h = documentEngineHarness(snapshot);
  const diskError = new Error('Snapshot cache write failed');
  let failCache = true;
  const onError = jest.fn();
  const options = { onError, beforeSnapshotWrite: async () => { if (failCache) throw diskError; } };
  let browser = h.createBrowser(options);
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const first = await browser.engine.openEditor(resource, browser.editorId(resource));
    await first.commit(value => ({ ...value, content: 'Accepted first words' }));
    if (lifetime === 'closed before acceptance') first.close({ flush: false });
    browser.engine.setOnline(true);
    await browser.engine.retry().catch(error => { expect(eachFailure(error).map(failure => failure.error)).toContain(diskError); });
    await settleEngine();
    expect(h.server.value?.content).toBe('Accepted first words');
    expect(onError).toHaveBeenCalled();
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect((await h.commits.list('owner'))[0]).toMatchObject({ state: 'acknowledged', result: { snapshot: h.server } });
    if (lifetime === 'open through acceptance') {
      expect(first.getState().checkpoint.dirty).toBe(false);
      first.close({ flush: false });
    }
    browser.engine.setOnline(false);
    if (mode === 'application restart') {
      browser.dispose(); browser = h.createBrowser(options);
      browser.engine.setOnline(false); browser.engine.setOwner('owner');
    }
    const next = await browser.engine.openEditor(resource, browser.editorId(resource));
    expect(next.getState().checkpoint.confirmed).toEqual(h.server);
    expect(next.getState().checkpoint.draft?.content).toBe('Accepted first words');
    await next.commit(value => ({ ...value, content: `${value!.content}; later words` }));
    next.close({ flush: false });
    failCache = false; browser.engine.setOnline(true);
    await browser.engine.retry(); await settleEngine();
    expect(h.server.value?.content).toBe('Accepted first words; later words');
    expect(h.transport.send).toHaveBeenCalledTimes(2);
    expect((await h.commits.list('owner')).every(request => request.state === 'acknowledged')).toBe(true);
    expect([...h.storage.rows.keys()].some(key => JSON.parse(key)[2] === 'accepted-cache')).toBe(false);
  } finally { browser.dispose(); }
});


it('retains an accepted snapshot after a completed checkpoint and an older projection cleanup', async () => {
  installStorageHarness();
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const created = await commits.create({ id: 'accepted', owner: 'owner', editorId: 'old-editor', editGeneration: 1,
    baseline: snapshot, value: { ...snapshot.value, content: 'Accepted words' }, predecessor: null, revision: 0, initialized: true,
    working: snapshot, intended: { ...snapshot.value, content: 'Accepted words' }, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });
  const acceptedSnapshot = { ...snapshot, value: created.value, metadata: { ...snapshot.metadata, revision: 2 } };
  await commits.compareAndSet(created, { ...created, state: 'acknowledged', result: { kind: 'acknowledged', operationId: created.id, snapshot: acceptedSnapshot } });
  const session = new DataSession(snapshot); session.edit(created.value); session.registerCommit(created.id, 1, created.value);
  session.accept({ kind: 'acknowledged', operationId: created.id, snapshot: acceptedSnapshot });
  await checkpoints.put({ owner: 'owner', editorId: created.editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [], completedCommits: [created.id] });
  // An older bundle only knows this original projection key. It must not erase cache ownership.
  await createEngineStorageTransaction()<void>('readwrite', (store, _read, done) => { store.delete(['reference', 'owner', 'projection', created.id]); done(undefined); });
  expect((await commits.list('owner')).map(request => request.result)).toEqual([{ kind: 'acknowledged', operationId: created.id, snapshot: acceptedSnapshot }]);
  await commits.releaseProjection!('owner', [created.id]);
  expect(await commits.list('owner')).toEqual([]);
});


it('repairs and releases a retained accepted copy after restart without resending it', async () => {
  const h = documentEngineHarness(snapshot);
  let failing = true;
  const options = { beforeSnapshotWrite: async () => { if (failing) throw new Error('Cache unavailable'); } };
  let browser = h.createBrowser(options); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(value => ({ ...value, content: 'Accepted once' })); editor.close({ flush: false });
    browser.engine.setOnline(true); await browser.engine.retry().catch(() => undefined); await settleEngine();
    expect(h.server.value?.content).toBe('Accepted once'); expect(h.transport.send).toHaveBeenCalledTimes(1);
    browser.dispose(); browser = h.createBrowser(options); browser.engine.setOnline(false); browser.engine.setOwner('owner');
    expect((await browser.engine.read(resource)).value?.content).toBe('Accepted once');
    failing = false; await browser.engine.retry(); await settleEngine();
    expect((await h.commits.list('owner')).every(request => request.state === 'acknowledged')).toBe(true);
    expect([...h.storage.rows.keys()].some(key => JSON.parse(key)[2] === 'accepted-cache')).toBe(false);
    expect((await browser.engine.peekCached(resource))?.value?.content).toBe('Accepted once');
    browser.dispose(); browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
    expect((await browser.engine.read(resource)).value?.content).toBe('Accepted once');
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { browser.dispose(); }
});

it.each(['create', 'delete'] as const)('reopens an accepted %s after cache failure and restart', async kind => {
  const h = documentEngineHarness(kind === 'create' ? { resource, value: null, metadata: null } : snapshot);
  const options = { beforeSnapshotWrite: async () => { throw new Error('Cache unavailable'); } };
  let browser = h.createBrowser(options); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = await (kind === 'create' ? browser.engine.createEditor(resource, browser.editorId(resource)) : browser.engine.openEditor(resource, browser.editorId(resource)));
    await editor.commit(() => kind === 'create' ? snapshot.value : null); editor.close({ flush: false });
    browser.engine.setOnline(true); await browser.engine.retry().catch(() => undefined); await settleEngine();
    expect(h.server.metadata?.deleted).toBe(kind === 'delete'); expect(h.transport.send).toHaveBeenCalledTimes(1);
    browser.dispose(); browser = h.createBrowser(options); browser.engine.setOnline(false); browser.engine.setOwner('owner');
    const reopened = await browser.engine.openEditor(resource, browser.editorId(resource));
    expect(reopened.getState().checkpoint.confirmed).toEqual(h.server);
    expect(reopened.getState().checkpoint.draft).toEqual(kind === 'delete' ? null : h.server.value);
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { browser.dispose(); }
});


it('keeps an atomic group until all accepted participant snapshots are durable, then releases it', async () => {
  installStorageHarness();
  const commits = createIndexedDbCommitStore();
  const atomic = { id: 'pair-a', participants: ['pair-a', 'pair-b'] };
  const makeRequest = (id: string): CommitRequest => ({ id, owner: 'owner', editorId: id, editGeneration: 1, atomic,
    baseline: { ...snapshot, resource: { ...resource, id } }, value: { ...snapshot.value, content: id }, predecessor: null, revision: 0, initialized: true,
    working: snapshot, intended: { ...snapshot.value, content: id }, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });
  const captured = await commits.createBatch!([makeRequest('pair-a'), makeRequest('pair-b')]);
  const accepted = await commits.compareAndSetBatch!(captured.map(previous => ({ previous, next: { ...previous, state: 'acknowledged',
    result: { kind: 'acknowledged', operationId: previous.id, snapshot: { ...previous.baseline, value: previous.value, metadata: { ...snapshot.metadata, revision: 2 } } } } })));
  const cache = new Map<string, ResourceSnapshot>();
  let failSecond = true;
  const transport = { read: jest.fn(async () => { throw new Error('No remote read expected'); }), send: jest.fn(async () => { throw new Error('No delivery expected'); }) };
  const create = () => {
    const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } });
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const engine = new DataEngine({ runtime, observer, transport, commits, checkpoints: createIndexedDbCheckpoints(), operationId: () => 'unused',
      snapshots: { read: async (_owner, ref) => cache.get(ref.id), put: async (_owner, value) => {
        if (value.resource.id === 'pair-b' && failSecond) throw new Error('Second cache failed');
        cache.set(value.resource.id, value);
      } } });
    engine.setOnline(false); engine.setOwner('owner'); return engine;
  };
  let engine = create();
  try {
    await expect(engine.retry()).rejects.toMatchObject({ message: 'Second cache failed', failures: [{ about: { ...resource, id: 'pair-b' } }] });
    expect(cache.has('pair-a')).toBe(true); expect(cache.has('pair-b')).toBe(false);
    expect(await commits.list('owner')).toEqual(accepted);
    engine.dispose(); engine = create();
    expect((await engine.read({ ...resource, id: 'pair-b' })).value?.content).toBe('pair-b');
    failSecond = false; await engine.retry();
    expect(await commits.list('owner')).toEqual([]);
    expect(cache.get('pair-b')?.value?.content).toBe('pair-b');
    expect(transport.send).not.toHaveBeenCalled(); expect(transport.read).not.toHaveBeenCalled();
  } finally { engine.dispose(); }
});


it('reopens accepted user settings using their canonical document-id ownership policy', async () => {
  const userResource = { collection: 'users', id: 'owner' };
  const initial = { resource: userResource, value: { language: 'en' }, metadata: { ...snapshot.metadata, generation: 'users-generation' } };
  const h = documentEngineHarness(initial);
  const options = { beforeSnapshotWrite: async () => { throw new Error('Cache unavailable'); } };
  let browser = h.createBrowser(options); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = await browser.engine.openEditor(userResource, browser.editorId(userResource));
    await editor.commit(value => ({ ...value, language: 'ru' })); editor.close({ flush: false });
    browser.engine.setOnline(true); await browser.engine.retry().catch(() => undefined); await settleEngine();
    expect(h.server.value?.language).toBe('ru'); expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect((await h.commits.list('owner'))[0].state).toBe('acknowledged');
    browser.dispose(); browser = h.createBrowser(options); browser.engine.setOnline(false); browser.engine.setOwner('owner');
    expect(await browser.engine.read(userResource)).toEqual(h.server);
    const reopened = await browser.engine.openEditor(userResource, browser.editorId(userResource));
    expect(reopened.getState().checkpoint.draft?.language).toBe('ru');
  } finally { browser.dispose(); }
});
