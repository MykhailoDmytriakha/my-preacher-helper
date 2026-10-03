import { createStore, type UseStore } from 'idb-keyval';

/**
 * DEVICE STORAGE THAT STOPS ANSWERING (BUG-20260927-engine-open-hangs-on-silent-device-storage).
 *
 * IndexedDB can go silent: a transaction neither completes nor fails, and every later transaction
 * on the same store queues behind it — across reloads — until the browser lets go. WebKit 26.6
 * leaves such a transaction behind when the page that started it is frozen or torn down mid-flight
 * (WebKit PRs 73930 and 74082); on the owner's iPad that lasted half an hour, and the council he
 * had prepared stayed a skeleton at the meeting it was prepared for.
 *
 * This module is the one place that knows it. Every call into the app's databases goes through a
 * watched store; a call still waiting after STORAGE_SILENCE_MS marks its database silent, and the
 * database answers again only once no call that old is still waiting. It never cancels or fails a
 * call: a write that was accepted may still commit, and pretending otherwise would lie about where
 * the person's work is. A reader that gates what the person sees races its read instead
 * (`answerWithin`), and writes are refused up front while the store is silent.
 */

export const STORAGE_SILENCE_MS = 3000;
/** After waking from a freeze, timers and storage answers arrive together; give the answers a moment. */
export const STORAGE_WAKE_GRACE_MS = 250;
/** A database is declared answering this long after a fresh call answered in time — no flapping. */
export const STORAGE_ANSWER_SETTLE_MS = 1500;

const RECORDS = 'engine-state', SNAPSHOTS = 'engine-snapshots', CURSORS = 'engine-cursors', JOURNAL = 'engine-journal';
/** The engine's own databases, by the labels their stores are watched under. */
export const ENGINE_STORAGE = [RECORDS, SNAPSHOTS, CURSORS, JOURNAL] as const;
/**
 * What opening an editor waits on: its records, the confirmed copy, and the command journal — a
 * save interrupted by a freeze is resubmitted through the journal before the editor is handed over.
 */
export const OPENING_STORAGE = [RECORDS, SNAPSHOTS, JOURNAL] as const;
/** What an action on a document touches: records, the confirmed copy and the command journal. */
export const EDITOR_STORAGE = [RECORDS, SNAPSHOTS, JOURNAL] as const;
/** What a list reads before it asks the server. */
export const LIST_STORAGE = [CURSORS, SNAPSHOTS] as const;

export interface SilentStorage {
  database: string;
  /** When the oldest waiting call started. */
  since: number;
}
export interface DeviceStorageHealth {
  silent: SilentStorage[];
}

const waiting = new Map<string, Map<number, number>>();
const silentSince = new Map<string, number>();
/** When silence was declared: only a call started after it can prove the store answers again. */
const declaredAt = new Map<string, number>();
const answering = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let nextCall = 0;
let health: DeviceStorageHealth = { silent: [] };

function publish(): void {
  health = { silent: [...silentSince].map(([database, since]) => ({ database, since })) };
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* A listener never changes what storage did. */ }
  }
}

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
function markSilent(database: string, since: number): void {
  // Another call going overdue cancels a pending "answered": the store is still not keeping up.
  const pending = answering.get(database);
  if (pending !== undefined) { clearTimeout(pending); answering.delete(database); verifying.delete(database); }
  if (silentSince.has(database)) return;
  silentSince.set(database, since);
  declaredAt.set(database, Date.now());
  publish();
  scheduleRelease(database);
}

const waitingLonger = (database: string, ms: number, now = Date.now()) =>
  [...(waiting.get(database)?.values() ?? [])].some(started => now - started >= ms);

/**
 * THE STORE ANSWERS AGAIN in one of two ways, never by the mere absence of old calls:
 * - a call started after the silence was declared comes back within the threshold — so one call
 *   lost for good (its page's transaction torn away) cannot keep the store "silent" all session,
 *   and a steady stream of slow-but-healthy calls is not mistaken for silence;
 * - or, when a stalled queue is released and its late calls come back together, nothing is left
 *   waiting long a moment later (`verify`). A store whose every call still takes longer than the
 *   threshold fails both and stays silent.
 */
const verifying = new Set<string>();
function markAnsweringLater(database: string, verify: boolean): void {
  if (!silentSince.has(database)) return;
  if (answering.has(database)) {
    if (verify || !verifying.has(database)) return;
    clearTimeout(answering.get(database)); // a proof in time replaces a pending check
  }
  if (verify) verifying.add(database); else verifying.delete(database);
  answering.set(database, setTimeout(() => {
    answering.delete(database);
    const checked = verifying.delete(database);
    if (checked && waitingLonger(database, STORAGE_ANSWER_SETTLE_MS)) return;
    silentSince.delete(database);
    declaredAt.delete(database);
    released.delete(database);
    publish();
  }, STORAGE_ANSWER_SETTLE_MS));
}

/**
 * Watch one call into a database; the call itself is returned untouched.
 *
 * Silence is declared only while the page is visible — a frozen page's calls wait on the freeze,
 * not on the store — and only after a short grace once the threshold passes, because on waking
 * the overdue timer and the answer that was already on its way arrive together.
 */
export function trackStorage<T>(database: string, operation: Promise<T>): Promise<T> {
  const id = ++nextCall;
  const startedAt = Date.now();
  let calls = waiting.get(database);
  if (!calls) waiting.set(database, calls = new Map());
  calls.set(id, startedAt);
  let timer: ReturnType<typeof setTimeout>;
  const arm = (delay: number) => {
    timer = setTimeout(() => {
      if (!calls!.has(id)) return;
      if (!pageVisible()) { arm(STORAGE_SILENCE_MS); return; }
      timer = setTimeout(() => { if (calls!.has(id) && pageVisible()) markSilent(database, startedAt); }, STORAGE_WAKE_GRACE_MS);
    }, delay);
  };
  arm(STORAGE_SILENCE_MS);
  const settle = (answered: boolean) => {
    clearTimeout(timer);
    calls!.delete(id);
    // A call that failed fast (a transaction that could not even start) proves nothing about the store.
    if (!answered) return;
    const declared = declaredAt.get(database);
    if (declared === undefined) return;
    if (startedAt >= declared && Date.now() - startedAt < STORAGE_SILENCE_MS) markAnsweringLater(database, false);
    else if (!waitingLonger(database, STORAGE_SILENCE_MS)) markAnsweringLater(database, true);
  };
  operation.then(() => settle(true), () => settle(false));
  return operation;
}

/*
 * A DATABASE HELD BY A PAGE SAFARI FROZE IS RELEASED BY ASKING FOR A VERSION CHANGE.
 *
 * Measured on WebKit (Safari 26.5 on macOS, iPadOS 26.1): a page frozen into the back-forward cache
 * in the middle of a transaction — one that continues from a request callback, as every
 * read-then-write does — keeps that transaction, and other pages' transactions on the store wait
 * until Safari evicts the frozen page: 60 s on the Mac, minutes on iPadOS, 45 minutes on the owner's
 * iPad. Safari freezes such pages whatever the page says (`no-store`, `unload`, Web Locks all
 * ignored). What it honours is a version change: a frozen page cannot answer one, so Safari evicts
 * it at once — even while the change itself stays blocked — and its transaction goes with it.
 *
 * So when an engine database has stayed silent RELEASE_AFTER_MS past being declared silent, a
 * throwaway worker asks for its next version and is terminated a moment later. The request never
 * completes: it stays blocked behind this page's own connections, an upgrade that starts anyway is
 * aborted, and terminating the worker drops it, so the version never moves and nothing is left
 * queued (both measured). Nothing of this page is closed, aborted or replayed; only the frozen page
 * is evicted, by Safari, as it would have been when it expired. The wait first leaves the person a
 * moment to go back to that page, which then restores intact; after it, that page reloads instead.
 *
 * WebKit only. Chrome evicts a frozen page that blocks a transaction by itself (measured: no silence
 * at all), and there a terminated worker's blocked request stays queued and stalls every later open
 * (measured on Chrome 154) — the cure would become the disease.
 */
export const RELEASE_AFTER_MS = 3000;
const RELEASE_WORKER_LIFETIME_MS = 1500;
export interface StorageRelease { source: string; result: 'asked' | 'blocked' | 'unblocked' | 'failed' }
const releaseListeners = new Set<(event: StorageRelease) => void>();
const engineDatabases = new Map<string, string>();
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Databases already released during their current silence: one ask per silence. */
const released = new Set<string>();
/** Workers still asking; a page that leaves ends them, so a request never outlives its page. */
const liveReleases = new Set<() => void>();
let watchingDeparture = false;
function endReleasesOnDeparture(): void {
  if (watchingDeparture || typeof window === 'undefined') return;
  watchingDeparture = true;
  window.addEventListener('pagehide', () => { for (const end of [...liveReleases]) end(); });
}

/** Safari and every iOS browser (all WebKit); not Chrome, Edge, Opera or Firefox. */
function isWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  return /AppleWebKit\//.test(agent) && !/(Chrome|Chromium|Edg|OPR)\//.test(agent);
}

/** The worker's whole job, as source: read the version, ask for the next one, never let it complete. */
const RELEASE_WORKER_SOURCE = `onmessage = (event) => {
  const name = event.data.name;
  const probe = indexedDB.open(name);
  probe.onupgradeneeded = () => probe.transaction.abort(); // a database that is gone is not created empty
  probe.onerror = (error) => { if (error && error.preventDefault) error.preventDefault(); postMessage('failed'); };
  probe.onsuccess = () => {
    const version = probe.result.version;
    probe.result.close();
    const ask = indexedDB.open(name, version + 1);
    ask.onblocked = () => postMessage('blocked');
    ask.onupgradeneeded = () => { ask.transaction.abort(); postMessage('unblocked'); };
    ask.onsuccess = () => { ask.result.close(); postMessage('unblocked'); };
    ask.onerror = (error) => { if (error && error.preventDefault) error.preventDefault(); };
  };
};`;

function announceRelease(event: StorageRelease): void {
  for (const listener of [...releaseListeners]) {
    try { listener(event); } catch { /* A listener never changes what storage did. */ }
  }
}

export function subscribeStorageRelease(listener: (event: StorageRelease) => void): () => void {
  releaseListeners.add(listener);
  return () => { releaseListeners.delete(listener); };
}

function scheduleRelease(label: string): void {
  const name = engineDatabases.get(label);
  if (!name || releaseTimers.has(label) || released.has(label) || !isWebKit()) return;
  releaseTimers.set(label, setTimeout(() => {
    releaseTimers.delete(label);
    if (!silentSince.has(label)) return;
    // Answered meanwhile (the declaration lags the answer by a settle period): nothing to release.
    if (!waitingLonger(label, STORAGE_SILENCE_MS)) return;
    // Hidden now: ask once the page is seen again, not never.
    if (!pageVisible()) { scheduleRelease(label); return; }
    released.add(label);
    askForRelease(label, name);
  }, RELEASE_AFTER_MS));
}

function askForRelease(label: string, name: string): void {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  let source: string | undefined;
  let worker: Worker | undefined;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    liveReleases.delete(end);
    worker?.terminate();
    if (source) URL.revokeObjectURL(source);
  };
  endReleasesOnDeparture();
  liveReleases.add(end);
  try {
    source = URL.createObjectURL(new Blob([RELEASE_WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(source);
  } catch {
    end();
    announceRelease({ source: label, result: 'failed' });
    return;
  }
  // Safari evicts the frozen page while delivering the version change, before it answers "blocked":
  // the first answer is the moment to end the request, so it cannot outlive this page's attention.
  worker.onmessage = event => {
    const result = event.data;
    if (result === 'blocked' || result === 'unblocked' || result === 'failed') announceRelease({ source: label, result });
    end();
  };
  worker.onerror = () => { announceRelease({ source: label, result: 'failed' }); end(); };
  worker.postMessage({ name });
  announceRelease({ source: label, result: 'asked' });
  setTimeout(end, RELEASE_WORKER_LIFETIME_MS);
}

/** The same store `idb-keyval` would create, with every call watched under `label`. */
export function watchedStore(databaseName: string, storeName: string, label: string): UseStore {
  if ((ENGINE_STORAGE as readonly string[]).includes(label)) engineDatabases.set(label, databaseName);
  let store: UseStore | undefined;
  return (mode, callback) => trackStorage(label, (store ??= createStore(databaseName, storeName))(mode, callback));
}

export function getDeviceStorageHealth(): DeviceStorageHealth {
  return health;
}

export function subscribeDeviceStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isStorageSilent(databases: readonly string[] = ENGINE_STORAGE): boolean {
  return databases.some(database => silentSince.has(database));
}

/** What the person is told when a change cannot be kept because storage does not answer. */
export function storageSilentError(message = 'Device storage is not answering'): Error {
  return Object.assign(new Error(message), { code: 'storage-silent' });
}

/**
 * Race a READ against storage silence. The read keeps running and is never failed; the caller
 * only stops waiting for it. Never use this for a write — its outcome must stay knowable.
 */
export function answerWithin<T>(operation: Promise<T>, ms = STORAGE_SILENCE_MS): Promise<{ answered: true; value: T } | { answered: false }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ answered: false }), ms);
    operation.then(value => { clearTimeout(timer); resolve({ answered: true, value }); }, error => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Wait for an operation that has not yet changed anything — opening an editor, listing drafts —
 * but not past the point where it has itself waited the silence threshold while the databases it
 * needs are silent. Then `abandon` is called (so the operation never lands later behind the
 * person's back) and the wait ends with a storage-silent error. Every operation gets its own full
 * threshold: a fresh call is never refused because an older one elsewhere is slow.
 */
export function untilStorageSilent<T>(operation: Promise<T>, abandon: () => void, message?: string,
  databases: readonly string[] = EDITOR_STORAGE): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false, stop: (() => void) | undefined;
    const finish = (settle: () => void) => { if (settled) return; settled = true; clearTimeout(timer); stop?.(); settle(); };
    const check = () => {
      if (!isStorageSilent(databases)) return;
      finish(() => { abandon(); reject(storageSilentError(message)); });
    };
    const timer = setTimeout(() => { if (settled) return; stop = subscribeDeviceStorage(check); check(); }, STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS);
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

/** Tests only: forget every watched call (subscribers stay: they belong to their modules). */
export function resetDeviceStorageForTests(): void {
  waiting.clear();
  silentSince.clear();
  declaredAt.clear();
  verifying.clear();
  answering.forEach(timer => clearTimeout(timer));
  answering.clear();
  releaseTimers.forEach(timer => clearTimeout(timer));
  releaseTimers.clear();
  released.clear();
  liveReleases.clear();
  publish();
}
