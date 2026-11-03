import { get } from 'idb-keyval';

import { newClientId } from '@/utils/clientId';
import { TechnicalFailure } from '@/utils/failureCode';
import { queryCacheStore } from '@/utils/queryPersister';
import { updateStoredValue } from '@/utils/storageUpdate';

import type { QueryClientStorage } from '@/utils/queryPersister';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

type SavedQuery = PersistedClient['clientState']['queries'][number];
type SavedRecord = { revision: number; query: SavedQuery | null };
type ReadCache = {
  schema: 1;
  epoch: string;
  buster: string | null;
  timestamp: number;
  sequence: number;
  records: Record<string, SavedRecord>;
};
type ObservedRecord = { revision: number; fingerprint: string | null };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Only these server DTOs still use React Query; authored documents use the Data Engine. */
export function isOwnedReadQuery(query: SavedQuery, owner: string): boolean {
  const key = query?.queryKey;
  const owned = Array.isArray(key) && ((key.length === 2 && key[0] === 'referral-stats' && key[1] === owner)
    || (key.length === 4 && key[0] === 'me' && key[1] === 'entitlement' && key[2] === 'v2' && key[3] === owner));
  const data = query?.state?.data;
  return owned && typeof query.queryHash === 'string' && data !== undefined
    && (!object(data) || ['userId', 'ownerId'].every(field => !(field in data) || data[field] === owner));
}

/** These local fields recognize an untouched copy, never a global action/source clock. */
function fingerprint(query: SavedQuery | null): string | null {
  return query ? JSON.stringify([query.queryKey, query.state.data, query.state.dataUpdatedAt, query.state.dataUpdateCount]) : null;
}

function emptyCache(sequence = 0): ReadCache {
  return { schema: 1, epoch: newClientId(), buster: null, timestamp: Date.now(), sequence, records: {} };
}

function checkedCache(value: unknown, owner: string): ReadCache {
  if (!object(value) || value.schema !== 1 || typeof value.epoch !== 'string' || !value.epoch
    || (value.buster !== null && typeof value.buster !== 'string') || !Number.isFinite(value.timestamp) || (value.timestamp as number) <= 0
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 || !object(value.records)) {
    throw new TechnicalFailure('Saved read cache is not a supported readable version');
  }
  for (const [hash, row] of Object.entries(value.records)) {
    if (!object(row) || !Number.isSafeInteger(row.revision) || (row.revision as number) <= 0
      || (row.revision as number) > (value.sequence as number)
      || (row.query !== null && (!isOwnedReadQuery(row.query as SavedQuery, owner) || (row.query as SavedQuery).queryHash !== hash))) {
      throw new TechnicalFailure('Saved read cache contains an invalid record');
    }
  }
  return value as ReadCache;
}

function asClient(cache: ReadCache): PersistedClient {
  return { timestamp: cache.timestamp, buster: cache.buster ?? '', clientState: {
    queries: Object.values(cache.records).flatMap(row => row.query ? [row.query] : []), mutations: [],
  } };
}

/**
 * One atomic owner map, with per-record admission and a retained clear fence. Legacy input stays
 * in its original namespace. Changed DTO answers use commit order, not server-version chronology.
 */
export function createAccountReadStorage(owner: string, key: IDBValidKey, options: {
  readLegacy: () => Promise<PersistedClient | undefined>;
  mayWrite: () => boolean;
}): QueryClientStorage {
  let epoch: string | undefined;
  let observed = new Map<string, ObservedRecord>();
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    const pending = tail.then(action);
    // A rejected call remains rejected to its caller; it cannot poison later cache I/O.
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  const observe = (cache: ReadCache) => {
    epoch = cache.epoch;
    observed = new Map(Object.entries(cache.records).map(([hash, row]) => [hash,
      { revision: row.revision, fingerprint: fingerprint(row.query) }]));
  };

  return {
    readClient: async () => {
      // Reads have the generic silence deadline; an unanswered initial read is not a FIFO job.
      await tail;
      const saved = await get<unknown>(key, queryCacheStore);
      let restored: ReadCache;
      if (saved !== undefined) restored = checkedCache(saved, owner);
      else {
        const legacy = await options.readLegacy();
        const imported = emptyCache();
        imported.buster = legacy?.buster ?? '';
        imported.timestamp = legacy?.timestamp ?? imported.timestamp;
        for (const query of legacy?.clientState?.queries ?? []) {
          if (isOwnedReadQuery(query, owner)) imported.records[query.queryHash] = { revision: ++imported.sequence, query };
        }
        checkedCache(imported, owner);
        // Another tab can initialize or clear this namespace during the legacy read.
        await updateStoredValue<ReadCache>(key, current => {
          restored = current === undefined ? imported : checkedCache(current, owner);
          return restored;
        }, queryCacheStore);
      }
      observe(restored!);
      return asClient(restored!);
    },
    writeClient: client => {
      if (client.clientState.mutations.length) return Promise.reject(new TechnicalFailure('The account read cache cannot accept mutation commands'));
      // DTOs are JSON responses. Capture this submitted snapshot before any asynchronous opening.
      const frame = JSON.parse(JSON.stringify(client)) as PersistedClient;
      const incoming = new Map(frame.clientState.queries.filter(query => isOwnedReadQuery(query, owner)).map(query => [query.queryHash, query]));
      return enqueue(async () => {
        if (epoch === undefined || !options.mayWrite()) return;
        const accepted = new Map<string, ObservedRecord>();
        await updateStoredValue<ReadCache | undefined>(key, current => {
          if (!options.mayWrite()) return current;
          if (current === undefined) return emptyCache(); // Missing metadata never authorizes resurrection.
          const cache = checkedCache(current, owner);
          if (cache.epoch !== epoch || (cache.buster !== null && cache.buster !== frame.buster)) return cache;
          let sequence = cache.sequence;
          const records = { ...cache.records };
          for (const [hash, query] of incoming) {
            const nextFingerprint = fingerprint(query);
            if (observed.get(hash)?.fingerprint === nextFingerprint) continue;
            records[hash] = { revision: ++sequence, query };
            accepted.set(hash, { revision: sequence, fingerprint: nextFingerprint });
          }
          for (const [hash, baseline] of observed) {
            if (incoming.has(hash) || baseline.fingerprint === null) continue;
            // Absence retires only the record this tab actually read, never newer unseen work.
            if (records[hash]?.revision !== baseline.revision) continue;
            records[hash] = { revision: ++sequence, query: null };
            accepted.set(hash, { revision: sequence, fingerprint: null });
          }
          return sequence === cache.sequence ? cache : { ...cache, records, sequence, buster: frame.buster, timestamp: frame.timestamp };
        }, queryCacheStore);
        // Only a completed native transaction advances this session's observations.
        for (const [hash, row] of accepted) observed.set(hash, row);
      });
    },
    removeClient: () => enqueue(async () => {
      if (epoch === undefined || !options.mayWrite()) return;
      let cleared: ReadCache | undefined;
      await updateStoredValue<ReadCache | undefined>(key, current => {
        if (!options.mayWrite()) return current;
        const cache = current === undefined ? undefined : checkedCache(current, owner);
        if (cache && cache.epoch !== epoch) return cache;
        cleared = emptyCache((cache?.sequence ?? 0) + 1);
        return cleared;
      }, queryCacheStore);
      if (cleared) {
        epoch = cleared.epoch;
        // Retain old fingerprints: an unchanged pre-clear snapshot cannot refill the empty map.
      }
    }),
  };
}
