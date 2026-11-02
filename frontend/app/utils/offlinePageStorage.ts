import { reconnectingStore } from '@/utils/deviceStorage';
import { TechnicalFailure } from '@/utils/failureCode';
import { createStorageTransaction } from '@/utils/storageTransaction';

import type { CancellableStorageTransaction, StorageRead } from '@/utils/storageTransaction';

const CATALOG = 'catalog';
const payloadKey = (address: string): IDBValidKey => ['payload', address];

export interface OfflinePageEntry {
  address: string;
  generation: number;
  seen: number;
  warm: boolean;
  failures: number;
  retryAt: number;
  claim?: { id: number; until: number };
}
interface Catalog {
  schema: 1;
  build: string;
  sequence: number;
  pages: OfflinePageEntry[];
  legacyImported: string[];
}
export interface OfflinePagePayload {
  body: ArrayBuffer;
  headers: [string, string][];
  status: number;
  statusText: string;
}
interface KeptPayload extends OfflinePagePayload { build: string; generation: number }
export interface OfflinePageTicket {
  address: string;
  build: string;
  generation: number;
  seen: number;
  claim: number;
  until: number;
  previousRefusals: number;
}
export type OfflinePageReservation = { outcome: 'kept' | 'cooling' | 'busy' | 'inactive' }
  | { outcome: 'fetch'; ticket: OfflinePageTicket };

function readCatalog(value: unknown, build: string): Catalog {
  if (value === undefined) return { schema: 1, build, sequence: 0, pages: [], legacyImported: [] };
  const state = value as Catalog;
  if (state?.schema !== 1 || typeof state.build !== 'string' || !Number.isSafeInteger(state.sequence)
    || !Array.isArray(state.pages) || !Array.isArray(state.legacyImported)
    || !state.legacyImported.every(address => typeof address === 'string')
    || !state.pages.every(page => typeof page?.address === 'string' && Number.isSafeInteger(page.generation)
      && Number.isSafeInteger(page.seen) && typeof page.warm === 'boolean'
      && Number.isSafeInteger(page.failures) && Number.isFinite(page.retryAt)
      && (!page.claim || (Number.isSafeInteger(page.claim.id) && Number.isFinite(page.claim.until))))) {
    throw new TechnicalFailure('Offline page catalog is unreadable');
  }
  return state;
}

/** Catalog, body, claim and eviction share one object-store transaction and its commit fence. */
export function createOfflinePageStorage({ build, maxEntries, acceptAddress, transaction, now = Date.now }: {
  build: string;
  maxEntries: number;
  acceptAddress: (address: string) => boolean;
  transaction?: CancellableStorageTransaction;
  now?: () => number;
}) {
  if (!build || !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new TechnicalFailure('Offline storage configuration is invalid');
  let database: ReturnType<typeof reconnectingStore> | undefined;
  const transact = transaction ?? createStorageTransaction(() => database ??= reconnectingStore('preacher-offline-pages-v1', 'pages'));

  function access<T>(mode: IDBTransactionMode,
    action: (state: Catalog, store: IDBObjectStore, read: StorageRead, done: (value: T) => void) => void,
    signal?: AbortSignal): Promise<T> {
    return transact<T>(mode, (store, read, done) => {
      read(store.get(CATALOG), value => action(readCatalog(value, build), store, read, done));
    }, signal);
  }
  function save(state: Catalog, store: IDBObjectStore): void {
    // The old implementation could hold maxEntries payloads plus maxEntries pending addresses.
    // Bound each kind separately: a failed new warm-up must not evict an already usable body.
    for (const warm of [true, false]) {
      let count = state.pages.filter(page => page.warm === warm).length;
      while (count > maxEntries) {
        const oldest = state.pages.filter(page => page.warm === warm).reduce((a, b) => a.seen <= b.seen ? a : b);
        const [removed] = state.pages.splice(state.pages.indexOf(oldest), 1);
        store.delete(payloadKey(removed.address));
        count -= 1;
      }
    }
    store.put(state, CATALOG);
  }
  function matching(state: Catalog, ticket: OfflinePageTicket): OfflinePageEntry | undefined {
    if (state.build !== build || ticket.build !== build) return undefined;
    return state.pages.find(page => page.address === ticket.address && page.generation === ticket.generation && page.claim?.id === ticket.claim);
  }

  function validPayload(payload: KeptPayload | undefined, generation: number): payload is KeptPayload {
    return Boolean(payload && payload.build === build && payload.generation === generation
      && payload.body instanceof ArrayBuffer && Number.isInteger(payload.status)
      && payload.status >= 200 && payload.status <= 299 && typeof payload.statusText === 'string'
      && Array.isArray(payload.headers) && payload.headers.every(header => Array.isArray(header)
        && header.length === 2 && header.every(value => typeof value === 'string')));
  }
  function importAddresses(state: Catalog, addresses: readonly string[]): void {
    const additions = [...new Set(addresses)].filter(address => acceptAddress(address) && !state.legacyImported.includes(address));
    let seen = Math.min(0, ...state.pages.map(page => page.seen)) - additions.length;
    const imported: OfflinePageEntry[] = [];
    for (const address of additions) {
      state.legacyImported.push(address);
      if (!state.pages.some(page => page.address === address)) {
        imported.push({ address, generation: ++state.sequence, seen: seen++, warm: false, failures: 0, retryAt: 0 });
      }
    }
    // Old history cannot become newer than a page the person just saw in this build. Existing
    // pending order also stays intact: a failed address has moved behind the others for retry.
    state.pages = [...imported, ...state.pages];
  }

  /** New code invalidates bodies, while known addresses remain available to a later warm-up. */
  function activate(legacyAddresses: readonly string[] = [], signal?: AbortSignal): Promise<void> {
    return access<void>('readwrite', (state, store, _read, done) => {
      if (state.build !== build) {
        state.build = build;
        for (const page of state.pages) {
          store.delete(payloadKey(page.address));
          page.generation = ++state.sequence;
          page.warm = false;
          page.claim = undefined;
        }
      }
      importAddresses(state, legacyAddresses);
      save(state, store);
      done(undefined);
    }, signal);
  }

  /** Legacy reconciliation can add addresses, but an old worker cannot activate its build again. */
  function importLegacy(addresses: readonly string[], signal?: AbortSignal): Promise<void> {
    return access<void>('readwrite', (state, store, _read, done) => {
      if (state.build === build) { importAddresses(state, addresses); save(state, store); }
      done(undefined);
    }, signal);
  }

  function reserve(address: string, { seen = true, leaseMs, deadline, generation, signal }: {
    seen?: boolean; leaseMs: number; deadline?: number; generation?: number; signal?: AbortSignal;
  }): Promise<OfflinePageReservation> {
    if (!acceptAddress(address)) return Promise.resolve({ outcome: 'inactive' });
    return access<OfflinePageReservation>('readwrite', (state, store, next, done) => {
      if (state.build !== build) { done({ outcome: 'inactive' }); return; }
      let page = state.pages.find(item => item.address === address);
      if (generation !== undefined && page?.generation !== generation) { done({ outcome: 'inactive' }); return; }
      if (!page) {
        const sequence = ++state.sequence;
        page = { address, generation: sequence, seen: sequence, warm: false, failures: 0, retryAt: 0 };
        state.pages.push(page);
      } else if (seen) {
        page.seen = ++state.sequence;
        state.pages = [...state.pages.filter(item => item !== page), page];
      }
      const reservedPage = page;
      const choose = () => {
        const started = now();
        let outcome: OfflinePageReservation;
        if (reservedPage.warm) outcome = { outcome: 'kept' };
        else if (reservedPage.retryAt > started) outcome = { outcome: 'cooling' };
        else if (reservedPage.claim && reservedPage.claim.until > started) outcome = { outcome: 'busy' };
        else {
          reservedPage.claim = { id: ++state.sequence, until: Math.min(started + leaseMs, deadline ?? Infinity) };
          outcome = { outcome: 'fetch', ticket: { address, build, generation: reservedPage.generation, seen: reservedPage.seen,
            claim: reservedPage.claim.id, until: reservedPage.claim.until, previousRefusals: reservedPage.failures } };
        }
        save(state, store);
        done(outcome);
      };
      if (reservedPage.warm) {
        next<KeptPayload | undefined>(store.get(payloadKey(address)), payload => {
          if (!validPayload(payload, reservedPage.generation)) reservedPage.warm = false;
          choose();
        });
      } else choose();
    }, signal);
  }

  function publish(ticket: OfflinePageTicket, payload: OfflinePagePayload, signal?: AbortSignal): Promise<boolean> {
    return access<boolean>('readwrite', (state, store, _read, done) => {
      const page = matching(state, ticket);
      if (!page || ticket.until <= now()) { done(false); return; }
      store.put({ ...payload, build, generation: page.generation } satisfies KeptPayload, payloadKey(page.address));
      page.warm = true;
      page.claim = undefined;
      page.retryAt = 0;
      page.failures = 0;
      save(state, store);
      done(true);
    }, signal);
  }

  function finish(ticket: OfflinePageTicket, { gone = false, retryAt = 0, refusal = false }: {
    gone?: boolean; retryAt?: number; refusal?: boolean;
  } = {}, signal?: AbortSignal): Promise<boolean> {
    return access<boolean>('readwrite', (state, store, _read, done) => {
      const page = matching(state, ticket);
      if (!page) { done(false); return; }
      if (gone && page.seen === ticket.seen) {
        state.pages = state.pages.filter(item => item !== page);
        store.delete(payloadKey(page.address));
      } else {
        page.claim = undefined;
        page.retryAt = retryAt;
        if (refusal) page.failures += 1;
        if (!gone) state.pages = [page, ...state.pages.filter(item => item !== page)];
      }
      save(state, store);
      done(true);
    }, signal);
  }

  /** A worker may die before settling its claim. Release it once, behind the other pending work. */
  function releaseExpiredClaims(signal?: AbortSignal): Promise<void> {
    return access<void>('readwrite', (state, store, _read, done) => {
      if (state.build === build) {
        const expired = state.pages.filter(page => page.claim && page.claim.until <= now());
        if (expired.length) {
          for (const page of expired) page.claim = undefined;
          state.pages = [...expired, ...state.pages.filter(page => !expired.includes(page))];
          save(state, store);
        }
      }
      done(undefined);
    }, signal);
  }

  function entries(signal?: AbortSignal): Promise<OfflinePageEntry[]> {
    return access('readonly', (state, _store, _read, done) => done(state.build === build ? state.pages : []), signal);
  }
  function read(address: string, signal?: AbortSignal): Promise<OfflinePagePayload | undefined> {
    return access('readonly', (state, store, next, done) => {
      const page = state.build === build ? state.pages.find(item => item.address === address && item.warm) : undefined;
      if (!page) { done(undefined); return; }
      next<KeptPayload | undefined>(store.get(payloadKey(address)), payload => {
        done(validPayload(payload, page.generation) ? payload : undefined);
      });
    }, signal);
  }
  return { activate, importLegacy, reserve, publish, finish, releaseExpiredClaims, entries, read };
}
export type OfflinePageStorage = ReturnType<typeof createOfflinePageStorage>;
