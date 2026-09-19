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

/** Cache state has no provable opening ancestor or delivery status. Archive, never import. */
export async function preserveLegacyQueryCache(enabled: (collection: string) => boolean): Promise<void> {
  if (!enabled('councils')) return;
  const persisted: unknown = await get('react-query-cache');
  if (!object(persisted) || !object(persisted.clientState) || !Array.isArray(persisted.clientState.queries)) return;
  const copies = new Map<string, Omit<LegacyQueryCopy, 'id'>[]>();
  for (const query of persisted.clientState.queries) {
    if (!object(query) || !Array.isArray(query.queryKey) || query.queryKey.length !== 2
      || query.queryKey[0] !== 'councils' || typeof query.queryKey[1] !== 'string' || !query.queryKey[1]
      || !object(query.state) || !Array.isArray(query.state.data)) continue;
    const owner = query.queryKey[1];
    for (const document of query.state.data) {
      if (!object(document) || document.userId !== owner || typeof document.id !== 'string' || !document.id) continue;
      const identity = JSON.stringify(['legacy-query', owner, 'councils', document.id]);
      const group = copies.get(identity) ?? [];
      group.push({ owner, collection: 'councils', documentId: document.id,
        title: typeof document.title === 'string' ? document.title : document.id,
        raw: JSON.stringify(document, null, 2),
        savedAt: typeof query.state.dataUpdatedAt === 'number' && Number.isFinite(query.state.dataUpdatedAt) ? query.state.dataUpdatedAt : null });
      copies.set(identity, group);
    }
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
