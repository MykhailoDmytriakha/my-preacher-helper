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

function querySource(query: unknown, enabled: (collection: string) => boolean) {
  if (!object(query) || !Array.isArray(query.queryKey) || !object(query.state)) return null;
  const key = query.queryKey;
  const collection = key[0] === 'councils' ? 'councils'
    : ['groups', 'group-detail', 'calendarGroups'].includes(String(key[0])) ? 'groups' : null;
  if (!collection || !enabled(collection) || key.length !== (key[0] === 'calendarGroups' ? 4 : 2)) return null;
  const detail = key[0] === 'group-detail';
  const rows = detail ? [query.state.data] : query.state.data;
  if (!Array.isArray(rows)) return null;
  return { collection, detail, identity: key[1], rows,
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
    if (source.detail ? document.id !== source.identity : document.userId !== source.identity) return [];
    return [{ owner: document.userId, collection: source.collection, documentId: document.id,
      title: typeof document.title === 'string' ? document.title : document.id,
      raw: JSON.stringify(document, null, 2), savedAt: source.savedAt }];
  });
}

/** Paused/error variables can outlive the optimistic row, or have no row at all. */
function mutationCopies(mutations: unknown[], queries: Candidate[], enabled: (collection: string) => boolean): Candidate[] {
  if (!enabled('groups')) return [];
  return mutations.flatMap((mutation): Candidate[] => {
    if (!object(mutation) || !Array.isArray(mutation.mutationKey) || !object(mutation.state)) return [];
    const [collection, operation] = mutation.mutationKey;
    if (collection !== 'groups' || mutation.mutationKey.length !== 2 || !['create', 'update', 'delete'].includes(String(operation))) return [];
    const variables = mutation.state.variables;
    const fields = object(variables) ? variables : {};
    const documentId = operation === 'delete' && typeof variables === 'string' ? variables
      : typeof fields.id === 'string' ? fields.id : 'unassigned-create';
    const explicitOwner = typeof fields.userId === 'string' && fields.userId ? fields.userId : null;
    const cachedOwners = new Set(queries.filter(copy => copy.collection === 'groups' && copy.documentId === documentId).map(copy => copy.owner));
    // Old deletes have only an ID. Attribute only when the persisted document proves
    // one owner. Otherwise retain quarantined bytes (owner=''), never show another
    // account's intent merely because that person signs in after the upgrade.
    const owner = explicitOwner ?? (cachedOwners.size === 1 ? [...cachedOwners][0] : '');
    const payload = object(fields.updates) ? fields.updates : fields;
    return [{ owner, collection, documentId,
      title: typeof payload.title === 'string' ? payload.title : `${operation}: ${documentId}`,
      raw: JSON.stringify(mutation, null, 2),
      savedAt: typeof mutation.state.submittedAt === 'number' ? mutation.state.submittedAt : null }];
  });
}

/** Cache state has no provable opening ancestor or delivery status. Archive, never import. */
export async function preserveLegacyQueryCache(enabled: (collection: string) => boolean): Promise<void> {
  if (!enabled('councils') && !enabled('groups')) return;
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
