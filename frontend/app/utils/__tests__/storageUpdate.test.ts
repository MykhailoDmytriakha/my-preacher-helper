import { createStore, type UseStore } from 'idb-keyval';
import { createIndexedDbCollectionCursors } from '@/data-engine/collectionCursors.client';
import { createIndexedDbJournal } from '@/data-engine/journal.client';
import { createIndexedDbSnapshots } from '@/data-engine/snapshots.client';
import { isStorageSilent, resetDeviceStorageForTests, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS } from '@/utils/deviceStorage';
import { saveRecordingDraftText } from '@/utils/recordingDraftStore';

jest.mock('idb-keyval', () => ({ ...jest.requireActual('idb-keyval'), createStore: jest.fn() }));
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn() }));
const rows = new Map<string, unknown>();
let fault: 'abort-read' | 'abort-write' | 'put-error' | 'get-error' | 'none' | 'hold' = 'none';
const controls: { finish?: () => void; aborted: number; puts: number } = { aborted: 0, puts: 0 };
const address = (db: string, key: IDBValidKey) => JSON.stringify([db, key]);
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

// Execute the installed update against native-shaped events; the browser proves the native order.
const database = (name: string): UseStore => async (_mode, callback) => {
  const pending = new Map(rows), events = new EventTarget(); let aborted = false;
  const tx = Object.assign(events, {
    error: null as Error | null, oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null, onerror: null as (() => void) | null,
    abort() { aborted = true; controls.aborted += 1; tx.error = new DOMException('Read aborted', 'AbortError');
      events.dispatchEvent(new Event('abort')); tx.onabort?.(); },
  });
  const complete = () => { if (aborted) return; rows.clear(); pending.forEach((value, key) => rows.set(key, value));
    events.dispatchEvent(new Event('complete')); tx.oncomplete?.(); };
  const store = {
    transaction: tx,
    get(key: IDBValidKey) {
      if (fault === 'get-error') throw new DOMException('Store closed', 'InvalidStateError');
      const request = { result: rows.get(address(name, key)), error: null as Error | null,
        onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      void Promise.resolve().then(() => {
        if (fault === 'abort-read') { request.error = new DOMException('Read aborted', 'AbortError'); request.onerror?.(); tx.abort(); return; }
        request.onsuccess?.call(request);
        if (fault === 'hold') controls.finish = complete; else void Promise.resolve().then(complete);
      });
      return request;
    },
    put(value: unknown, key: IDBValidKey) {
      if (fault === 'put-error') throw new DOMException('Disk full', 'QuotaExceededError');
      controls.puts += 1; pending.set(address(name, key), value);
      if (fault === 'abort-write') void Promise.resolve().then(() => tx.abort());
    },
  } as unknown as IDBObjectStore;
  return callback(store);
};
const snapshot = { resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'original' },
  metadata: { protocol: 1 as const, generation: 'g', revision: 1, deleted: false } };
const journal = { command: { protocol: 1 as const, operationId: 'op', owner: 'owner', resource: { collection: 'studies', id: 'one' },
  generation: null, dependsOn: [], kind: 'create' as const, value: { text: 'mine' } }, state: 'queued' as const, attempts: 0, createdAt: 1 };
const scenarios = [
  { name: 'confirmed snapshot', write: () => createIndexedDbSnapshots().put('owner', { ...snapshot, metadata: { ...snapshot.metadata, revision: 2 } }) },
  { name: 'collection cursor', write: () => createIndexedDbCollectionCursors().put('owner', 'studyNotes', undefined, { version: 0, initialized: false }) },
  { name: 'command journal', write: () => createIndexedDbJournal().put(journal) },
  { name: 'recording transcript', write: () => saveRecordingDraftText('take', 'owner', 'new words') },
];
beforeEach(() => {
  jest.useFakeTimers(); resetDeviceStorageForTests(); rows.clear(); controls.finish = undefined; controls.aborted = 0; controls.puts = 0;
  fault = 'none'; jest.mocked(createStore).mockImplementation(name => database(name));
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  rows.set(address('preacher-data-engine-snapshots-v1', JSON.stringify(['owner', 'studyNotes', 'note'])), snapshot);
  rows.set(address('recording-drafts', 'take'), { id: 'take', ownerId: 'owner', blob: new Blob(['source']), transcript: 'original words' });
});
afterEach(() => { jest.clearAllTimers(); resetDeviceStorageForTests(); jest.useRealTimers(); });

it.each(scenarios)('rejects $name when its first read aborts, preserving the old copy', async ({ write }) => {
  const before = new Map(rows); fault = 'abort-read'; let outcome = 'pending';
  void write().then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; }); await flush();
  expect(controls.aborted).toBe(1); expect(outcome).toBe('rejected');
  expect(rows).toEqual(before); expect(controls.puts).toBe(0);
  jest.advanceTimersByTime(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 1); expect(isStorageSilent()).toBe(false);
});
it('still waits for durable completion and protects an actually unfinished write', async () => {
  fault = 'hold'; let outcome = 'pending';
  const saving = scenarios[0].write().then(() => { outcome = 'resolved'; });
  await flush(); expect(controls.puts).toBe(1); expect(outcome).toBe('pending');
  expect(rows.get(address('preacher-data-engine-snapshots-v1', JSON.stringify(['owner', 'studyNotes', 'note'])))).toEqual(snapshot);
  jest.advanceTimersByTime(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 1);
  expect(isStorageSilent()).toBe(true); expect(outcome).toBe('pending');
  controls.finish!(); await saving; expect(outcome).toBe('resolved');
});

it.each(scenarios)('rejects $name after put if the transaction then aborts, without publishing it', async ({ write }) => {
  const before = new Map(rows); fault = 'abort-write'; let failure: unknown;
  const saving = write().catch(error => { failure = error; });
  await flush(); await saving;
  expect(controls.puts).toBe(1); expect(controls.aborted).toBe(1);
  expect(failure).toMatchObject({ name: 'AbortError' }); expect(rows).toEqual(before);
});
it.each(['put-error', 'get-error'] as const)('propagates an original synchronous %s without claiming completion', async value => {
  const before = new Map(rows); fault = value;
  await expect(scenarios[0].write()).rejects.toMatchObject({ name: value === 'put-error' ? 'QuotaExceededError' : 'InvalidStateError' });
  expect(rows).toEqual(before);
  jest.advanceTimersByTime(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 1); expect(isStorageSilent()).toBe(false);
});
