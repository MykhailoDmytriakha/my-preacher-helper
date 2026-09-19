import { onAuthStateChanged, type User } from 'firebase/auth';

import { newClientId } from '@/utils/clientId';

import { createBrowserDataEngine } from '../browser.client';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createMemoryCommitStore } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { createIndexedDbCollectionCursors } from '../collectionCursors.client';
import { collectionHeadRef } from '../feed';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { createIndexedDbJournal } from '../journal.client';
import { createIndexedDbSnapshots } from '../snapshots.client';
import { createFirestoreObservationSource } from '../source.client';
import { createHttpEngineTransport } from '../transport.client';
import { applyCommand } from '../protocol';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { CollectionCursor, CollectionState } from '../collections';
import type { CollectionTransport, EngineTransport, JournalEntry, JournalStore, ResourceSnapshot } from '../types';

jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: {} }));
jest.mock('@/utils/clientId', () => ({ newClientId: jest.fn() }));
jest.mock('../manualScopes.client', () => ({ createIndexedDbManualScopes: jest.fn() }));
jest.mock('../journal.client', () => ({ createIndexedDbJournal: jest.fn() }));
jest.mock('../checkpoint.client', () => ({ createIndexedDbCheckpoints: jest.fn() }));
jest.mock('../commits.client', () => ({ createIndexedDbCommitStore: jest.fn() }));
jest.mock('../collectionCursors.client', () => ({ createIndexedDbCollectionCursors: jest.fn() }));
jest.mock('../snapshots.client', () => ({ createIndexedDbSnapshots: jest.fn() }));
jest.mock('../source.client', () => ({ createFirestoreObservationSource: jest.fn() }));
jest.mock('../transport.client', () => ({ ...jest.requireActual('../transport.client'), createHttpEngineTransport: jest.fn() }));

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const resource = { collection: 'studyNotes', id: 'note' };
const snapshot: ResourceSnapshot = { resource, value: { userId: 'owner', content: 'base' }, metadata: { protocol: 1, generation: 'gen', revision: 1, deleted: false } };
const settle = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };
function setup() {
  jest.mocked(createIndexedDbManualScopes).mockReturnValue({ read: jest.fn(async () => undefined), list: jest.fn(async () => []), create: jest.fn(async () => undefined), put: jest.fn(async () => undefined), compact: jest.fn(async () => undefined) });
  jest.mocked(createIndexedDbCommitStore).mockReturnValue(createMemoryCommitStore());
  const records = new Map<string, JournalEntry>();
  const checkpoints = new Map<string, EditorRecord>();
  const collectionCursors = new Map<string, CollectionCursor>();
  const snapshotRows = new Map<string, ResourceSnapshot>([[JSON.stringify(['owner', resource.collection, resource.id]), copy(snapshot)]]);
  let serverSnapshot = copy(snapshot), headVersion = 0;
  const journal: JournalStore = {
    list: jest.fn(async owner => copy([...records.values()].filter(entry => entry.command.owner === owner))),
    put: jest.fn(async entry => { records.set(entry.command.operationId, copy(entry)); }),
    remove: jest.fn(async (_owner, id) => { records.delete(id); }),
  };
  const transport: EngineTransport & CollectionTransport = {
    list: jest.fn(async () => ({ snapshots: [copy(serverSnapshot)], nextCursor: null, version: headVersion })),
    changes: jest.fn(async (_owner, _collection, after) => ({ snapshots: after < headVersion ? [copy(serverSnapshot)] : [], cursor: headVersion, version: headVersion, hasMore: false })),
    read: jest.fn(async (owner, ref): Promise<ResourceSnapshot> => ref.collection === '_dataEngineHeads'
      ? { resource: ref, value: { userId: owner, collection: resource.collection, version: headVersion }, metadata: { protocol: 1, generation: ref.id, revision: headVersion + 1, deleted: false } }
      : copy(serverSnapshot)),
    send: jest.fn(async command => {
      serverSnapshot = { ...snapshot, value: { userId: 'owner', content: 'mine' }, metadata: { ...snapshot.metadata!, revision: 2 } };
      headVersion += 1;
      return { kind: 'acknowledged' as const, operationId: command.operationId, snapshot: copy(serverSnapshot) };
    }),
  };
  jest.mocked(createIndexedDbJournal).mockReturnValue(journal);
  jest.mocked(createHttpEngineTransport).mockReturnValue(transport);
  jest.mocked(createIndexedDbCheckpoints).mockReturnValue({
    read: jest.fn(async (_owner, id) => checkpoints.get(id)),
    put: jest.fn(async record => { checkpoints.set(record.editorId, copy(record)); }),
    listRecoverable: jest.fn(async (owner, ref) => [...checkpoints.values()].filter(record => record.owner === owner
      && (!ref || (record.checkpoint.confirmed.resource.collection === ref.collection && record.checkpoint.confirmed.resource.id === ref.id)))
      .map(record => ({ id: record.editorId, record: copy(record) }))),
    create: jest.fn(async record => {
      if (checkpoints.has(record.editorId)) throw new Error('Checkpoint already exists');
      checkpoints.set(record.editorId, copy(record));
    }),
  });
  jest.mocked(createIndexedDbCollectionCursors).mockReturnValue({
    read: jest.fn(async (owner, collection) => collectionCursors.get(JSON.stringify([owner, collection]))),
    put: jest.fn(async (owner, collection, expected, next) => {
      const key = JSON.stringify([owner, collection]);
      if (JSON.stringify(collectionCursors.get(key)) !== JSON.stringify(expected)) throw Object.assign(new Error('Cursor changed'), { code: 'cursor-changed' });
      const committed = { ...next, revision: (expected?.revision ?? 0) + 1 };
      collectionCursors.set(key, committed); return committed;
    }),
  });
  jest.mocked(createIndexedDbSnapshots).mockReturnValue({
    read: jest.fn(async (owner, ref) => snapshotRows.get(JSON.stringify([owner, ref.collection, ref.id]))),
    put: jest.fn(async (owner, snapshot) => { snapshotRows.set(JSON.stringify([owner, snapshot.resource.collection, snapshot.resource.id]), copy(snapshot)); }),
    list: jest.fn(async (owner, collection) => [...snapshotRows.entries()].filter(([key]) => {
      const [rowOwner, rowCollection] = JSON.parse(key); return rowOwner === owner && rowCollection === collection;
    }).map(([, value]) => copy(value))),
  });
  const stopSource = jest.fn();
  jest.mocked(createFirestoreObservationSource).mockReturnValue({ listen: jest.fn(() => stopSource) });
  const authCallbacks: { next: (user: User | null) => void; error: (error: Error) => void; stop: jest.Mock }[] = [];
  jest.mocked(onAuthStateChanged).mockImplementation((_auth, next, error) => {
    const stop = jest.fn(); authCallbacks.push({ next: next as (user: User | null) => void, error: error as (error: Error) => void, stop }); return stop;
  });
  return { journal, records, checkpoints, transport, authCallbacks, stopSource, collectionCursors, snapshotRows };
}
function setOnline(online: boolean) { Object.defineProperty(navigator, 'onLine', { configurable: true, value: online }); }
function setVisible(visible: boolean) { Object.defineProperty(document, 'visibilityState', { configurable: true, value: visible ? 'visible' : 'hidden' }); }
const user = (uid: string) => ({ uid } as User);

describe('Browser DataEngine lifecycle composition', () => {
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); setOnline(true); setVisible(true);
    let sequence = 0; jest.mocked(newClientId).mockImplementation(() => `identity-${++sequence}`);
  });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('allocates a fresh editor lifetime even when revisiting the same resource and slot', () => {
    const s = setup(); const first = createBrowserDataEngine(); const second = createBrowserDataEngine();
    expect(first.editorId(resource)).not.toBe(first.editorId({ ...resource }));
    expect(first.editorId(resource)).not.toBe(second.editorId(resource));
    expect(first.editorId(resource, 'other')).not.toBe(first.editorId(resource));
    expect(first.editorId({ ...resource, id: 'other' })).not.toBe(first.editorId(resource));
    expect(s.authCallbacks).toHaveLength(2);
    first.dispose(); second.dispose();
    expect(s.authCallbacks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('can save again after navigating away from an acknowledged and compacted editor', async () => {
    const s = setup(); installStorageHarness();
    jest.mocked(createIndexedDbCommitStore).mockReturnValue(jest.requireActual('../commits.client').createIndexedDbCommitStore());
    jest.mocked(createIndexedDbCheckpoints).mockReturnValue(jest.requireActual('../checkpoint.client').createIndexedDbCheckpoints());
    let server = copy(snapshot);
    jest.mocked(s.transport.read).mockImplementation(async () => copy(server));
    jest.mocked(s.transport.send).mockImplementation(async command => {
      const result = applyCommand(command, server);
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      return result;
    });
    const browser = createBrowserDataEngine(); s.authCallbacks[0].next(user('owner')); await settle();
    const first = await browser.engine.openEditor(resource, browser.editorId(resource));
    await first.commit(value => ({ ...value, content: 'first visit' }));
    await browser.engine.retry(); await settle();
    expect(first.getState().checkpoint.dirty).toBe(false);
    expect(await createIndexedDbCommitStore().list('owner')).toEqual([]);
    first.close({ flush: true });
    const second = await browser.engine.openEditor(resource, browser.editorId(resource));
    await second.commit(value => ({ ...value, content: 'second visit' }));
    await browser.engine.retry(); await settle();
    expect(server.value?.content).toBe('second visit');
    expect(second.getState()).toMatchObject({ durable: true, error: null, checkpoint: { dirty: false } });
    browser.dispose();
  });

  it('persists offline edits and resumes their journal delivery on an online event', async () => {
    const s = setup(); setOnline(false);
    const browser = createBrowserDataEngine(); s.authCallbacks[0].next(user('owner')); await settle();
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.edit({ userId: 'owner', content: 'mine' }); await editor.save(); await settle();
    expect(s.transport.send).not.toHaveBeenCalled();
    expect([...s.records.values()]).toEqual([expect.objectContaining({ state: 'queued' })]);
    setOnline(true); window.dispatchEvent(new Event('online')); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(editor.getState().checkpoint.draft?.content).toBe('mine');
    expect(editor.getState().checkpoint.dirty).toBe(false);
    expect(s.records.size).toBe(0);
    browser.dispose();
  });

  it('constructs collection reads with the shared cache and only one head interest per watched collection', async () => {
    const s = setup(); const browser = createBrowserDataEngine(); s.authCallbacks[0].next(user('owner')); await settle();
    const states: CollectionState[] = [];
    const first = browser.engine.watchCollection(resource.collection, state => states.push(state));
    const second = browser.engine.watchCollection(resource.collection, jest.fn());
    await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ complete: true, version: 0, freshness: 'server' });
    const source = jest.mocked(createFirestoreObservationSource).mock.results[0].value;
    expect(source.listen).toHaveBeenCalledTimes(1);
    expect(source.listen).toHaveBeenCalledWith('owner', collectionHeadRef('owner', resource.collection), expect.any(Function), expect.any(Function));
    expect(await browser.engine.refreshCollection(resource.collection)).toMatchObject({ complete: true, version: 0 });
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    first(); second(); browser.dispose();
  });

  it('refreshes an active collection head after its own ACK without scanning the whole collection again', async () => {
    const s = setup(); const browser = createBrowserDataEngine(); s.authCallbacks[0].next(user('owner')); await settle();
    const states: CollectionState[] = [];
    const stop = browser.engine.watchCollection(resource.collection, state => states.push(state)); await settle();
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.edit({ userId: 'owner', content: 'mine' }); await editor.save(); await settle();
    expect(s.transport.read).toHaveBeenCalledWith('owner', collectionHeadRef('owner', resource.collection));
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    expect(s.transport.changes).toHaveBeenCalledWith('owner', resource.collection, 0, { limit: 100 });
    expect(states.at(-1)).toMatchObject({ version: 1, complete: true, snapshots: [{ value: { content: 'mine' } }] });
    setOnline(false); window.dispatchEvent(new Event('offline'));
    const offline = await browser.engine.readCollection(resource.collection);
    expect(offline).toMatchObject({ complete: true, freshness: 'cache' });
    s.authCallbacks[0].next(null);
    expect(states.at(-1)).toMatchObject({ snapshots: [], complete: false });
    expect(() => browser.engine.readCollection(resource.collection)).toThrow('Authentication');
    stop(); browser.dispose();
  });

  it('retries unknown commands on the minute timer only while foreground and online', async () => {
    const s = setup(); const browser = createBrowserDataEngine(); s.authCallbacks[0].next(user('owner')); await settle();
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    jest.mocked(s.transport.send).mockRejectedValue(new Error('ACK lost'));
    await editor.edit({ userId: 'owner', content: 'mine' }); await editor.save(); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    setVisible(false); document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(60_000); await settle(); expect(s.transport.send).toHaveBeenCalledTimes(1);
    setVisible(true); document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    setOnline(false); window.dispatchEvent(new Event('offline'));
    jest.advanceTimersByTime(60_000); await settle(); expect(s.transport.send).toHaveBeenCalledTimes(2);
    setOnline(true); window.dispatchEvent(new Event('online')); await settle();
    expect(s.transport.send).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(60_000); await settle(); expect(s.transport.send).toHaveBeenCalledTimes(4);
    expect([...s.records.values()][0].state).toBe('unknown');
    browser.dispose();
  });

  it('fences logout and late auth callbacks and disposes all lifecycle listeners once', async () => {
    const s = setup(); const browser = createBrowserDataEngine(); const retry = jest.spyOn(browser.engine, 'retry');
    s.authCallbacks[0].next(user('owner')); await settle(); s.authCallbacks[0].next(null); await settle();
    expect(() => browser.engine.read(resource)).toThrow('Authentication');
    const beforeDispose = retry.mock.calls.length;
    browser.dispose(); browser.dispose();
    s.authCallbacks[0].next(user('owner')); s.authCallbacks[0].error(new Error('late'));
    window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('offline')); document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(120_000); await settle();
    expect(retry).toHaveBeenCalledTimes(beforeDispose); expect(s.authCallbacks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('deduplicates periodic retries and suppresses stale-owner errors', async () => {
    const s = setup(); const onError = jest.fn(); const browser = createBrowserDataEngine({ onError });
    s.authCallbacks[0].next(user('owner')); await settle();
    let reject!: (error: Error) => void;
    const retry = jest.spyOn(browser.engine, 'retry').mockImplementationOnce(() => new Promise((_resolve, decline) => { reject = decline; }));
    jest.advanceTimersByTime(120_000); await settle();
    expect(retry).toHaveBeenCalledTimes(1);
    s.authCallbacks[0].next(user('other')); await settle();
    reject(new Error('old owner storage error')); await settle();
    expect(onError).not.toHaveBeenCalled();
    browser.dispose();
  });

  it('reports failures without a supplied callback instead of silently swallowing them', () => {
    const s = setup(); const report = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const browser = createBrowserDataEngine(); s.authCallbacks[0].error(new Error('auth failed'));
    expect(report).toHaveBeenCalledWith('DataEngine background operation failed', expect.objectContaining({ message: 'auth failed' }));
    browser.dispose(); report.mockRestore();
  });

  it('reports auth and storage errors and cleans up a failed auth registration', async () => {
    const s = setup(); const onError = jest.fn(); const browser = createBrowserDataEngine({ onError });
    s.authCallbacks[0].error(new Error('auth failed')); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'auth failed' }));
    s.authCallbacks[0].next(user('owner')); await settle();
    jest.mocked(s.journal.list).mockRejectedValue(new Error('disk unavailable'));
    jest.advanceTimersByTime(60_000); await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk unavailable' }));
    browser.dispose();
    jest.mocked(onAuthStateChanged).mockImplementationOnce(() => { throw new Error('cannot subscribe'); });
    expect(() => createBrowserDataEngine()).toThrow('cannot subscribe');
    expect(jest.getTimerCount()).toBe(0);
  });
});
