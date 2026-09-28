import { createStore } from 'idb-keyval';

import { buildDiagnosticReport, diagnosticEvents } from '@/utils/appDiagnostics';
import {
  STORAGE_ANSWER_SETTLE_MS, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS, answerWithin, getDeviceStorageHealth, isStorageSilent,
  resetDeviceStorageForTests, trackStorage, untilStorageSilent, watchedStore,
} from '@/utils/deviceStorage';

jest.mock('idb-keyval', () => ({ createStore: jest.fn(() => jest.fn(async () => 'answered')), get: jest.fn(), set: jest.fn(), del: jest.fn(), entries: jest.fn(), update: jest.fn() }));

const never = <T,>() => new Promise<T>(() => undefined);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };

describe('device storage that stops answering', () => {
  const SILENT = STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetDeviceStorageForTests();
    localStorage.clear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('calls a database silent only once a call has waited past the threshold and a wake grace', () => {
    void trackStorage('engine-state', never());
    jest.advanceTimersByTime(STORAGE_SILENCE_MS);
    expect(isStorageSilent()).toBe(false);

    jest.advanceTimersByTime(STORAGE_WAKE_GRACE_MS);

    expect(isStorageSilent()).toBe(true);
    expect(getDeviceStorageHealth().silent).toEqual([{ database: 'engine-state', since: expect.any(Number) }]);
  });

  it('does not blame storage for the time a hidden page was frozen', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    void trackStorage('engine-state', never());
    jest.advanceTimersByTime(SILENT * 10);
    expect(isStorageSilent()).toBe(false);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    jest.advanceTimersByTime(SILENT);
    expect(isStorageSilent()).toBe(true);
  });

  it('keeps a database silent while fresh calls hang behind the stuck one too', async () => {
    void trackStorage('engine-state', never());
    jest.advanceTimersByTime(SILENT);
    void trackStorage('engine-state', never());

    jest.advanceTimersByTime(STORAGE_ANSWER_SETTLE_MS * 4);

    expect(isStorageSilent()).toBe(true);
  });

  it('answers again once a fresh call comes back in time, even if one lost call never settles', async () => {
    void trackStorage('engine-state', never());
    jest.advanceTimersByTime(SILENT);
    const fresh = deferred<void>();
    void trackStorage('engine-state', fresh.promise);
    jest.advanceTimersByTime(100);

    fresh.resolve();
    await fresh.promise;
    jest.advanceTimersByTime(STORAGE_ANSWER_SETTLE_MS);

    expect(isStorageSilent()).toBe(false);
  });

  it('does not take a call that failed fast as proof the store answers again', async () => {
    void trackStorage('engine-state', never());
    jest.advanceTimersByTime(SILENT);

    await trackStorage('engine-state', Promise.reject(new Error('transaction could not start'))).catch(() => undefined);
    jest.advanceTimersByTime(STORAGE_ANSWER_SETTLE_MS * 2);

    expect(isStorageSilent()).toBe(true);
  });

  it('is not held silent by a steady stream of slow but healthy calls', async () => {
    const stuck = deferred<void>();
    void trackStorage('engine-state', stuck.promise);
    jest.advanceTimersByTime(SILENT);
    stuck.resolve(); await stuck.promise;
    for (let call = 0; call < 3; call += 1) {
      const slow = deferred<void>();
      void trackStorage('engine-state', slow.promise);
      jest.advanceTimersByTime(2000);
      slow.resolve(); await slow.promise;
    }
    jest.advanceTimersByTime(STORAGE_ANSWER_SETTLE_MS);

    expect(isStorageSilent()).toBe(false);
  });

  it('answers again once the hanging call settles and nothing is overdue for a moment, and the report says how long', async () => {
    const stuck = deferred<void>();
    void trackStorage('engine-state', stuck.promise);
    jest.advanceTimersByTime(SILENT + 5000);

    stuck.resolve();
    await stuck.promise;
    await Promise.resolve();
    expect(isStorageSilent()).toBe(true);
    jest.advanceTimersByTime(STORAGE_ANSWER_SETTLE_MS);

    expect(isStorageSilent()).toBe(false);
    const names = diagnosticEvents().map(event => [event.name, event.data.source]);
    expect(names).toEqual(expect.arrayContaining([['storage-silent', 'engine-state'], ['storage-answered', 'engine-state']]));
    expect(diagnosticEvents().filter(event => event.name === 'storage-answered').at(-1)?.data.elapsedMs).toBeGreaterThanOrEqual(SILENT + 5000);
  });

  it('does not flap back to silent when a slow queue keeps crossing the threshold', async () => {
    const first = deferred<void>();
    void trackStorage('engine-state', first.promise);
    jest.advanceTimersByTime(SILENT);
    const events = () => diagnosticEvents().filter(event => event.name.startsWith('storage-')).length;
    const before = events();

    first.resolve(); await first.promise; await Promise.resolve();
    const second = deferred<void>();
    void trackStorage('engine-state', second.promise);
    jest.advanceTimersByTime(SILENT);

    expect(isStorageSilent()).toBe(true);
    expect(events()).toBe(before);
  });

  it('does not count a silent cache database as silent engine storage', () => {
    void trackStorage('query-cache', never());
    jest.advanceTimersByTime(SILENT);

    expect(isStorageSilent()).toBe(false);
    expect(isStorageSilent(['query-cache'])).toBe(true);
  });

  it('puts the silent database and for how long into the report the owner sends', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    void trackStorage('engine-state', never());
    jest.advanceTimersByTime(SILENT + 2000);

    expect(buildDiagnosticReport().storage).toEqual({ silent: [{ database: 'engine-state', silentForMs: SILENT + 2000 }] });
  });

  it('stops waiting for a read after the threshold without failing the read itself', async () => {
    const read = deferred<string>();
    const raced = answerWithin(read.promise);

    await jest.advanceTimersByTimeAsync(STORAGE_SILENCE_MS);

    await expect(raced).resolves.toEqual({ answered: false });
    read.resolve('late');
    await expect(read.promise).resolves.toBe('late');
  });

  it('abandons an opening that has itself waited while the storage it needs is silent, and says why', async () => {
    const abandon = jest.fn();
    const waiting = untilStorageSilent(never<string>(), abandon, 'storage is silent').then(() => 'opened', (error: unknown) => error);
    void trackStorage('engine-journal', never());

    await jest.advanceTimersByTimeAsync(SILENT);

    expect(await waiting).toMatchObject({ code: 'storage-silent', message: 'storage is silent' });
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('gives a fresh operation its own full wait even when storage is already flagged silent', async () => {
    void trackStorage('engine-state', never());
    await jest.advanceTimersByTimeAsync(SILENT);
    const opening = deferred<string>();
    const waiting = untilStorageSilent(opening.promise, jest.fn());

    await jest.advanceTimersByTimeAsync(STORAGE_SILENCE_MS - 1);
    opening.resolve('opened');

    await expect(waiting).resolves.toBe('opened');
  });

  it('does not refuse an action because a database it does not use is silent', async () => {
    const abandon = jest.fn();
    const opening = deferred<string>();
    const waiting = untilStorageSilent(opening.promise, abandon);
    void trackStorage('engine-cursors', never());

    await jest.advanceTimersByTimeAsync(SILENT * 2);
    opening.resolve('opened');

    await expect(waiting).resolves.toBe('opened');
    expect(abandon).not.toHaveBeenCalled();
  });

  it('lets an opening finish normally while storage answers', async () => {
    const abandon = jest.fn();
    await expect(untilStorageSilent(Promise.resolve('opened'), abandon)).resolves.toBe('opened');
    expect(abandon).not.toHaveBeenCalled();
  });

  it('watches every call through a watched store, opening the database once', async () => {
    const store = watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state');

    await expect(store('readonly', () => 'value')).resolves.toBe('answered');
    await store('readwrite', () => 'value');

    expect(createStore).toHaveBeenCalledTimes(1);
    expect(createStore).toHaveBeenCalledWith('preacher-data-engine-state-v1', 'records');
  });
});

describe('every database the app waits on is watched', () => {
  it.each([
    ['../../data-engine/storage.client', 'createEngineStorageTransaction', 'preacher-data-engine-state-v1', 'engine-state'],
    ['../../data-engine/snapshots.client', 'createIndexedDbSnapshots', 'preacher-data-engine-snapshots-v1', 'engine-snapshots'],
    ['../../data-engine/collectionCursors.client', 'createIndexedDbCollectionCursors', 'preacher-data-engine-cursors-v1', 'engine-cursors'],
    ['../../data-engine/journal.client', 'createIndexedDbJournal', 'preacher-data-engine-v1', 'engine-journal'],
  ])('%s (%s) opens %s as %s', async (path, factory, database, label) => {
    const source = jest.requireActual<typeof import('fs')>('fs').readFileSync(require.resolve(path), 'utf8');
    expect(source).toContain(`watchedStore('${database}'`);
    expect(source).toContain(`'${label}')`);
    expect(source).not.toMatch(/\bcreateStore\(/);
    expect(typeof (await import(path))[factory]).toBe('function');
  });

  it('keeps the query cache on the database it always used, watched', () => {
    const source = jest.requireActual<typeof import('fs')>('fs').readFileSync(require.resolve('../queryPersister'), 'utf8');
    expect(source).toContain("watchedStore('keyval-store', 'keyval', 'query-cache')");
  });
});
