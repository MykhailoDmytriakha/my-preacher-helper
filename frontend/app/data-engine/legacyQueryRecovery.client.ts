'use client';

import { get } from 'idb-keyval';

import { createEngineStorageTransaction, engineOwnerRange } from './storage.client';

export interface LegacyQueryCopy {
  id: string;
  owner: string;
  collection: string;
  documentId: string;
  title: string;
  raw: string;
  savedAt: number | null;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type Candidate = Omit<LegacyQueryCopy, 'id'>;
const OWNER_DETAIL = 'owner-detail';
const QUERY_SOURCES: Record<string, { collection: string; length: number; kind: 'list' | 'detail' | 'owner-detail' | 'series-detail' }> = {
  councils: { collection: 'councils', length: 2, kind: 'list' },
  groups: { collection: 'groups', length: 2, kind: 'list' },
  'group-detail': { collection: 'groups', length: 2, kind: 'detail' },
  calendarGroups: { collection: 'groups', length: 4, kind: 'list' },
  series: { collection: 'series', length: 2, kind: 'list' },
  'series-detail': { collection: 'series', length: 2, kind: 'series-detail' },
  sermons: { collection: 'sermons', length: 2, kind: 'list' },
  sermon: { collection: 'sermons', length: 3, kind: OWNER_DETAIL },
  calendarSermons: { collection: 'sermons', length: 4, kind: 'list' },
};
function querySource(query: unknown, enabled: (collection: string) => boolean) {
  if (!object(query) || !Array.isArray(query.queryKey) || !object(query.state)) return null;
  const key = query.queryKey, source = QUERY_SOURCES[String(key[0])];
  if (!source || !enabled(source.collection) || key.length !== source.length) return null;
  const { collection, kind } = source, detail = kind !== 'list';
  const rows = kind === 'series-detail' ? [object(query.state.data) ? query.state.data.series : null]
    : detail ? [query.state.data] : query.state.data;
  if (!Array.isArray(rows)) return null;
  return { collection, detail, identity: kind === OWNER_DETAIL ? key[2] : key[1], rows, owner: kind === OWNER_DETAIL ? key[1] : null,
    savedAt: typeof query.state.dataUpdatedAt === 'number' && Number.isFinite(query.state.dataUpdatedAt) ? query.state.dataUpdatedAt : null };
}

function queryCopies(query: unknown, enabled: (collection: string) => boolean): Candidate[] {
  const source = querySource(query, enabled);
  if (!source) return [];
  return source.rows.flatMap((document: unknown) => {
    if (!object(document) || typeof document.id !== 'string' || !document.id
      || typeof document.userId !== 'string' || !document.userId) return [];
    // Old detail keys omit owner; the complete document still names its owner.
    // Never assign a cached document to whoever happens to be signed in now.
    if ((source.owner !== null && document.userId !== source.owner) || (source.detail ? document.id !== source.identity : document.userId !== source.identity)) return [];
    return [{ owner: document.userId, collection: source.collection, documentId: document.id,
      title: typeof document.title === 'string' ? document.title : document.id,
      raw: JSON.stringify(document, null, 2), savedAt: source.savedAt }];
  });
}

const MUTATION_OPERATIONS: Record<string, readonly string[]> = {
  groups: ['create', 'update', 'delete'], series: ['create', 'update', 'delete'],
  dashboardSermons: ['create', 'update', 'delete', 'markPreached', 'unmarkPreached', 'savePreachDate'],
};
const textField = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
function mutationIdentity(collection: string, operation: string, variables: unknown) {
  const fields = object(variables) ? variables : {};
  const documentId = (operation === 'delete' ? textField(variables) : null)
    ?? textField(fields.sermonId) ?? textField(fields.id) ?? textField(fields.seriesId) ?? 'unassigned-create';
  const explicitOwner = textField(collection === 'sermons' ? fields.uid : fields.userId);
  const payload = object(fields.input) ? fields.input : object(fields.updates) ? fields.updates : fields;
  return { documentId, explicitOwner, title: textField(payload.title) ?? `${operation}: ${documentId}` };
}

/** Paused/error variables can outlive the optimistic row, or have no row at all. */
function mutationCopies(mutations: unknown[], queries: Candidate[], enabled: (collection: string) => boolean): Candidate[] {
  return mutations.flatMap((mutation): Candidate[] => {
    if (!object(mutation) || !Array.isArray(mutation.mutationKey) || !object(mutation.state)) return [];
    const [prefix, operation] = mutation.mutationKey;
    const collection = prefix === 'dashboardSermons' ? 'sermons' : String(prefix);
    if (mutation.mutationKey.length !== 2 || !MUTATION_OPERATIONS[String(prefix)]?.includes(String(operation)) || !enabled(collection)) return [];
    const { documentId, explicitOwner, title } = mutationIdentity(collection, String(operation), mutation.state.variables);
    const cachedOwners = new Set(queries.filter(copy => copy.collection === collection && copy.documentId === documentId).map(copy => copy.owner));
    // Old deletes have only an ID. An ambiguous owner remains quarantined (owner='').
    const owner = explicitOwner ?? (cachedOwners.size === 1 ? [...cachedOwners][0] : '');
    return [{ owner, collection, documentId, title, raw: JSON.stringify(mutation, null, 2),
      savedAt: typeof mutation.state.submittedAt === 'number' ? mutation.state.submittedAt : null }];
  });
}

/** Cache state has no provable opening ancestor or delivery status. Archive, never import. */
export async function preserveLegacyQueryCache(enabled: (collection: string) => boolean): Promise<void> {
  if (!['councils', 'groups', 'series', 'sermons'].some(enabled)) return;
  const persisted: unknown = await get('react-query-cache');
  if (!object(persisted) || !object(persisted.clientState)) return;
  const queries = (Array.isArray(persisted.clientState.queries) ? persisted.clientState.queries : []).flatMap(query => queryCopies(query, enabled));
  const mutations = mutationCopies(Array.isArray(persisted.clientState.mutations) ? persisted.clientState.mutations : [], queries, enabled);
  const copies = new Map<string, Omit<LegacyQueryCopy, 'id'>[]>();
  for (const candidate of [...queries, ...mutations]) {
      const identity = JSON.stringify(['legacy-query', candidate.owner, candidate.collection, candidate.documentId]);
      const group = copies.get(identity) ?? [];
      group.push(candidate);
      copies.set(identity, group);
  }
  if (!copies.size) return;
  await createEngineStorageTransaction()<void>('readwrite', (store, read, done) => {
    let remaining = copies.size;
    for (const [identity, candidates] of copies) {
      const key = JSON.parse(identity) as IDBValidKey;
      read(store.get(key), (stored: LegacyQueryCopy[] | undefined) => {
        const archive = stored ?? [];
        for (const candidate of candidates) {
          // Timestamp changes alone are not new content. A stale tab cannot replace a newer copy.
          if (archive.some(copy => copy.raw === candidate.raw)) continue;
          archive.push({ ...candidate, id: JSON.stringify([...JSON.parse(identity), archive.length]) });
        }
        store.put(archive, key);
        if (--remaining === 0) done(undefined);
      });
    }
  });
}

export function listLegacyQueryCopies(owner: string): Promise<LegacyQueryCopy[]> {
  if (!owner) return Promise.resolve([]);
  return createEngineStorageTransaction()('readonly', (store, read, done) => {
    read(store.getAll(engineOwnerRange('legacy-query', owner)), (groups: LegacyQueryCopy[][]) => {
      done(groups.flat().filter(copy => copy.owner === owner));
    });
  });
}
