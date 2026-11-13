import type { UseStore } from 'idb-keyval';

export const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
export type StorageCounts = { transactions: number; getAll: number; rowsReturned: number };
// String bounds serve the snapshot store's one-collection key range (snapshots.client.ts), as in storageHarness.
type Range = { lower: unknown[] | string; upper: unknown[] | string; lowerOpen?: boolean; upperOpen?: boolean };

/** Transactional map, based on the engine's storageHarness; each device owns this instance. */
export class DeviceStorage {
  readonly databases = new Map<string, Map<string, unknown>>();
  counts: StorageCounts = { transactions: 0, getAll: 0, rowsReturned: 0 };
  activity = 0;
  pending = 0;
  private tail: Promise<unknown> = Promise.resolve();

  resetCounts() { this.counts = { transactions: 0, getAll: 0, rowsReturned: 0 }; }
  store(name: string): UseStore {
    if (!this.databases.has(name)) this.databases.set(name, new Map());
    return (mode, action) => {
      this.pending++;
      const beginning = this.tail.catch(() => undefined).then(() => {
        this.counts.transactions++; this.activity++;
        const draft = new Map(this.databases.get(name));
        let requests = 0, finished = false;
        let release!: () => void;
        const done = new Promise<void>(resolve => { release = resolve; });
        const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null,
          onerror: null, error: null, addEventListener: () => undefined, removeEventListener: () => undefined, abort: () => { if (finished) throw new Error('Already committed'); finished = true; this.pending--; release(); tx.onabort?.(); } };
        const complete = () => {
          if (finished || requests) return;
          finished = true;
          if (mode === 'readwrite') this.databases.set(name, draft);
          this.pending--; release(); tx.oncomplete?.();
        };
        const read = (value: unknown) => {
          requests++;
          const request = { result: clone(value), error: null, onsuccess: null as (() => void) | null, onerror: null };
          void Promise.resolve().then(() => { request.onsuccess?.(); requests--; void Promise.resolve().then(complete); });
          return request;
        };
        const rangeRows = (range?: Range) => [...draft].filter(([key]) => {
          if (!range) return true;
          const { lower, upper } = range;
          if (typeof lower === 'string' && typeof upper === 'string') {
            const text: unknown = JSON.parse(key);
            return typeof text === 'string' && (range.lowerOpen ? text > lower : text >= lower) && (range.upperOpen ? text < upper : text <= upper);
          }
          if (typeof lower === 'string' || typeof upper === 'string') throw new Error('Mixed range bounds');
          const parsed = JSON.parse(key) as unknown[];
          const first = lower.at(-1), last = upper.at(-1);
          if (lower.length === upper.length && typeof first === 'string' && typeof last === 'string' && first !== last) {
            const value = parsed[lower.length - 1];
            return lower.slice(0, -1).every((part, index) => parsed[index] === part)
              && typeof value === 'string' && value >= first && value <= last;
          }
          return lower.every((part, index) => parsed[index] === part);
        });
        const store = {
          transaction: tx,
          get: (key: unknown) => read(draft.get(JSON.stringify(key))),
          put: (value: unknown, key: unknown) => { draft.set(JSON.stringify(key), clone(value)); },
          delete: (key: unknown) => { draft.delete(JSON.stringify(key)); },
          getAll: (range?: Range) => { const rows = rangeRows(range).map(([, value]) => value); this.counts.getAll++; this.counts.rowsReturned += rows.length; return read(rows); },
          getAllKeys: (range?: Range) => read(rangeRows(range).map(([key]) => JSON.parse(key))),
        } as unknown as IDBObjectStore;
        const result = action(store);
        void Promise.resolve().then(complete);
        return { result, done };
      });
      this.tail = beginning.then(({ done }) => done);
      return beginning.then(({ result }) => result);
    };
  }
}
