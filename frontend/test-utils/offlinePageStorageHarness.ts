import { createOfflinePageStorage } from '@/utils/offlinePageStorage';

import type { OfflinePageEntry, OfflinePagePayload, OfflinePageStorage } from '@/utils/offlinePageStorage';
import type { CancellableStorageTransaction, StorageAction } from '@/utils/storageTransaction';

const CATALOG_KEY = 'catalog';
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const clone = <T>(value: T): T => structuredClone(value);
function defaultAcceptAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://app.test' && /^\/sermons\/[a-zA-Z0-9-]+$/.test(url.pathname);
  } catch { return false; }
}

type ReadGate = { key?: IDBValidKey; reached: Deferred; release: Deferred };
type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** A serial, atomic, in-memory IndexedDB-shaped store for offline-page unit tests. */
export function createOfflinePageStorageHarness({
  maxEntries = 200, initialNow = Date.now(),
  acceptAddress = defaultAcceptAddress,
}: { maxEntries?: number; initialNow?: number; acceptAddress?: (value: string) => boolean } = {}) {
  const rows = new Map<string, unknown>();
  const legacyStores = new Map<string, Map<string, Response>>();
  const failedPayloadWrites = new Set<string>();
  const evictAfterPayloadWrites = new Set<string>();
  const evictOnPayloadReads = new Set<string>();
  let nextReadGate: ReadGate | undefined;
  let clockOffset = 0;
  const systemStart = Date.now();
  let serial = Promise.resolve();
  let buildNumber = 1;
  let activeBuild = `test-build-${buildNumber}`;

  const transaction: CancellableStorageTransaction = <T,>(
    _mode: IDBTransactionMode, action: StorageAction<T>, signal?: AbortSignal,
  ): Promise<T> => {
    const run = async (): Promise<T> => {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Storage transaction cancelled', 'AbortError');
      const pending = new Map([...rows].map(([key, value]) => [key, clone(value)]));
      let aborted = false;
      let rejectAbort!: (reason: unknown) => void;
      const abortedWork = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const cancel = () => {
        aborted = true;
        rejectAbort(signal?.reason ?? new DOMException('Storage transaction cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      const evictAfterCommit = new Set<string>();
      try {
        const store = {
          get(key: IDBValidKey) {
            if (Array.isArray(key) && key[0] === 'payload') {
              const address = String(key[1]);
              if (evictOnPayloadReads.delete(address)) pending.delete(keyOf(key));
            }
            const request = {
              result: clone(pending.get(keyOf(key))), error: null, __key: key,
              onsuccess: null as ((event: Event) => void) | null,
              onerror: null as ((event: Event) => void) | null,
            };
            return request as unknown as IDBRequest;
          },
          put(value: unknown, key: IDBValidKey) {
            if (Array.isArray(key) && key[0] === 'payload') {
              const address = String(key[1]);
              if (failedPayloadWrites.has(address)) throw new DOMException('Injected payload write failure', 'QuotaExceededError');
              if (evictAfterPayloadWrites.delete(address)) evictAfterCommit.add(keyOf(key));
            }
            pending.set(keyOf(key), clone(value));
          },
          delete(key: IDBValidKey) { pending.delete(keyOf(key)); },
        } as unknown as IDBObjectStore;

        let resolveAction!: (value: T) => void;
        let rejectAction!: (reason: unknown) => void;
        let settled = false;
        const actionResult = new Promise<T>((resolve, reject) => { resolveAction = resolve; rejectAction = reject; });
        const done = (value: T) => {
          if (settled) return;
          settled = true;
          resolveAction(value);
        };
        const reject = (error: unknown) => {
          if (settled) return;
          settled = true;
          rejectAction(error);
        };
        const read = <V>(request: IDBRequest<V>, success: (value: V) => void) => {
          request.onsuccess = () => {
            if (aborted) return;
            try { success(request.result); } catch (error) { reject(error); }
          };
          request.onerror = () => reject(request.error ?? new DOMException('Injected read failure', 'UnknownError'));
          const requestKey = (request as IDBRequest & { __key?: IDBValidKey }).__key;
          const gate = nextReadGate && (!nextReadGate.key || (requestKey !== undefined && keyOf(nextReadGate.key) === keyOf(requestKey)))
            ? nextReadGate : undefined;
          if (gate) nextReadGate = undefined;
          void (async () => {
            if (gate) { gate.reached.resolve(); await Promise.race([gate.release.promise, abortedWork]); }
            if (!aborted) request.onsuccess?.call(request, new Event('success'));
          })().catch(reject);
        };
        try { action(store, read, done); } catch (error) { reject(error); }
        const result = await Promise.race([actionResult, abortedWork]);
        if (signal?.aborted) throw signal.reason ?? new DOMException('Storage transaction cancelled', 'AbortError');
        rows.clear();
        pending.forEach((value, key) => rows.set(key, value));
        for (const key of evictAfterCommit) rows.delete(key);
        return result;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    };
    const result = serial.then(run, run);
    serial = result.then(() => undefined, () => undefined);
    return result;
  };

  const legacyCaches = {
    async open(name: string) {
      const cache = legacyStores.get(name) ?? new Map<string, Response>();
      legacyStores.set(name, cache);
      return {
        async match(key: RequestInfo | URL) {
          const url = typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
          return cache.get(url)?.clone();
        },
        async put(key: RequestInfo | URL, response: Response) {
          const url = typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
          cache.delete(url); cache.set(url, response.clone());
        },
        async keys() { return [...cache.keys()].map(url => new Request(url)); },
        async delete(key: RequestInfo | URL) {
          const url = typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
          return cache.delete(url);
        },
      } as unknown as Cache;
    },
    async delete(name: string) { return legacyStores.delete(name); },
  };

  const catalog = (): { schema: number; build: string; sequence: number; pages: OfflinePageEntry[]; legacyImported: string[] } | undefined => {
    const value = rows.get(keyOf(CATALOG_KEY));
    return value === undefined ? undefined : value as ReturnType<typeof catalog>;
  };
  const payload = (address: string): (OfflinePagePayload & { build: string; generation: number }) | undefined => {
    const value = rows.get(keyOf(['payload', address]));
    return value === undefined ? undefined : clone(value as OfflinePagePayload & { build: string; generation: number });
  };
  const entries = (): OfflinePageEntry[] => clone(catalog()?.pages ?? []);

  return {
    legacyCaches,
    storage(build = activeBuild, limit = maxEntries): OfflinePageStorage {
      return createOfflinePageStorage({
        build,
        maxEntries: limit,
        acceptAddress,
        transaction,
        now: () => initialNow + (Date.now() - systemStart) + clockOffset,
      });
    },
    advanceBuild() { activeBuild = `test-build-${++buildNumber}`; return activeBuild; },
    get build() { return activeBuild; },
    now: () => initialNow + (Date.now() - systemStart) + clockOffset,
    advanceTime(ms: number) { clockOffset += ms; },
    entries,
    stored() {
      const state = catalog();
      if (!state || state.build !== activeBuild) return [];
      return state.pages.filter(page => {
        if (!page.warm) return false;
        const body = payload(page.address);
        return body?.build === activeBuild && body.generation === page.generation;
      }).map(page => page.address);
    },
    waiting() {
      const state = catalog();
      if (!state || state.build !== activeBuild) return [];
      return state.pages.filter(page => !page.warm).sort((a, b) => a.seen - b.seen).map(page => page.address);
    },
    payload,
    catalogSnapshot() { return clone(rows.get(keyOf(CATALOG_KEY))); },
    corruptCatalog(value: unknown) { rows.set(keyOf(CATALOG_KEY), clone(value)); },
    restoreCatalog(value: unknown) { rows.set(keyOf(CATALOG_KEY), clone(value)); },
    failPayloadWrite(address: string) { failedPayloadWrites.add(address); },
    allowPayloadWrite(address: string) { failedPayloadWrites.delete(address); },
    evictPayloadAfterWrite(address: string) { evictAfterPayloadWrites.add(address); },
    evictPayloadOnNextRead(address: string) { evictOnPayloadReads.add(address); },
    holdNextRead(key?: IDBValidKey) {
      const reached = deferred(), releaseGate = deferred();
      if (nextReadGate) throw new Error('A read gate is already armed');
      nextReadGate = { key, reached, release: releaseGate };
      return { started: reached.promise, release: releaseGate.resolve };
    },
    seedLegacyWaiting(addresses: readonly string[]) {
      const cache = legacyStores.get('pages-rsc-offline-index') ?? new Map<string, Response>();
      cache.set('https://offline-index.invalid/addresses', new Response(JSON.stringify(addresses)));
      legacyStores.set('pages-rsc-offline-index', cache);
    },
    seedLegacyPayload(address: string, response: Response) {
      const cache = legacyStores.get('pages-rsc-offline') ?? new Map<string, Response>();
      cache.set(address, response.clone());
      legacyStores.set('pages-rsc-offline', cache);
    },
  };
}
