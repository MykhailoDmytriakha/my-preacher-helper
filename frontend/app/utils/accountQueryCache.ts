import { MutationCache } from '@tanstack/react-query';
import { get, update } from 'idb-keyval';

import { shouldPersistLegacyMutation, shouldPersistLegacyQuery } from '@/data-engine/react.client';
import { createAccountReadStorage } from '@/utils/accountReadCache';
import { SETTINGS_MUTATION_KEYS, SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { accountQueryCacheKey, accountReadCacheKey, createIDBPersister, LEGACY_QUERY_CACHE_KEY, queryCacheStore, serializeSavedMutation } from '@/utils/queryPersister';

import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

type PersisterOptions = NonNullable<Parameters<typeof createIDBPersister>[1]>;
export { accountQueryCacheKey } from '@/utils/queryPersister';
const OWNER_QUERY_PREFIXES = new Set(['referral-stats', 'study-note-share-links', 'study-notes', 'user-settings', 'tags']);
const OWNER_MUTATIONS = new Set([...Object.values(SETTINGS_MUTATION_KEYS), ...Object.values(SHARE_LINK_MUTATION_KEYS)].map(key => JSON.stringify(key)));
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** These are the historical key shapes being imported, not constructors for new queries. */
function queryOwner(key: readonly unknown[]): unknown {
  if (key.length === 2 && OWNER_QUERY_PREFIXES.has(String(key[0]))) return key[1];
  if (key.length === 4 && key[0] === 'me' && key[1] === 'entitlement' && key[2] === 'v2') return key[3];
  return undefined;
}

function agreesWithOwner(data: unknown, owner: string): boolean {
  const rows = Array.isArray(data) ? data : [data];
  return rows.every(row => !object(row) || ['userId', 'ownerId'].every(field => !(field in row) || row[field] === owner));
}

/** The original stays untouched, including every row whose owner cannot be proved. */
function importOwnedCopy(legacy: PersistedClient | undefined, owner: string): PersistedClient {
  const imported: PersistedClient = { timestamp: Date.now(), buster: '', clientState: { queries: [], mutations: [] } };
  if (!legacy || legacy.buster !== '' || !Number.isFinite(legacy.timestamp) || !legacy.clientState) return imported;
  imported.clientState.queries = (Array.isArray(legacy.clientState.queries) ? legacy.clientState.queries : []).filter(query =>
    Array.isArray(query.queryKey) && shouldPersistLegacyQuery(query.queryKey) && queryOwner(query.queryKey) === owner && agreesWithOwner(query.state?.data, owner)
    && (query.queryKey[0] !== 'user-settings' || !object(query.state?.data) || query.state.data.id === owner));
  imported.clientState.mutations = (Array.isArray(legacy.clientState.mutations) ? legacy.clientState.mutations : []).filter(mutation =>
    shouldPersistLegacyMutation(mutation.mutationKey) && OWNER_MUTATIONS.has(JSON.stringify(mutation.mutationKey))
    && object(mutation.state?.variables) && mutation.state.variables.userId === owner).map(serializeSavedMutation);
  return imported;
}

/** The canonical archive already kept migrated originals; they never become active legacy writers. */
function withoutMigratedRows(client: PersistedClient): PersistedClient {
  return { ...client, clientState: { ...client.clientState,
    queries: client.clientState.queries.filter(query => shouldPersistLegacyQuery(query.queryKey)),
    mutations: client.clientState.mutations.filter(mutation => shouldPersistLegacyMutation(mutation.mutationKey)),
  } };
}

/** Per-owner read records; historical clients remain unchanged archival input. */
export function createAccountQueryPersister(owner: string | undefined, options: PersisterOptions = {}): Persister {
  if (!owner) return { persistClient: async () => undefined, restoreClient: async () => undefined, removeClient: async () => undefined };
  const legacyKey = accountQueryCacheKey(owner);
  const key = accountReadCacheKey(owner);
  const clientStorage = createAccountReadStorage(owner, key, {
    mayWrite: options.mayOverwrite ?? (() => true),
    readLegacy: async () => {
      const saved = await get<PersistedClient>(legacyKey, queryCacheStore);
      if (saved !== undefined) return withoutMigratedRows(saved);
      const legacy = await get<PersistedClient>(LEGACY_QUERY_CACHE_KEY, queryCacheStore);
      let adopted: PersistedClient | undefined;
      // Another opening may have created this partition while the old copy was being read.
      // The atomic update keeps its newer work and also marks an empty import as completed.
      await update<PersistedClient>(legacyKey, current => {
        adopted = current === undefined ? importOwnedCopy(legacy, owner) : current;
        return adopted;
      }, queryCacheStore);
      return adopted ? withoutMigratedRows(adopted) : undefined;
    },
  });
  return createIDBPersister(key, { ...options, clientStorage });
}

/** Retryer uses this seam before starts and after delays; an inactive account stays paused. */
export class OwnerMutationCache extends MutationCache {
  private readonly durable = new WeakSet<object>();

  constructor(private readonly mayRun: () => boolean, options?: ConstructorParameters<typeof MutationCache>[0]) {
    super(options);
    this.subscribe(event => {
      if ((event.type === 'added' || event.type === 'updated')
        && (event.mutation.state.isPaused || event.mutation.state.status === 'error')) this.durable.add(event.mutation);
    });
  }

  /** Resuming a saved intent must not remove its only recovery copy before the server answers. */
  wasDurable(mutation: Parameters<MutationCache['canRun']>[0]): boolean { return this.durable.has(mutation); }

  override canRun(mutation: Parameters<MutationCache['canRun']>[0]): boolean {
    return this.mayRun() && super.canRun(mutation);
  }
}
