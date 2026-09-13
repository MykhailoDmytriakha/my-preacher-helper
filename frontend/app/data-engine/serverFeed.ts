import { collectionHeadRef } from './feed';
import { isValidIdentifier } from './protocol';

import type { CollectionChanges, DocumentData, ResourceSnapshot } from './types';

export const HEADS_COLLECTION = '_dataEngineHeads';
export const MAX_CHANGE_BYTES = 4 * 1024 * 1024;
export interface FeedWrite { path: string[]; value: DocumentData }
export interface ChangePointer { resource: { collection: string; id: string }; version: number }

function invalid(code = 'invalid-change-feed'): never { throw Object.assign(new Error(code), { code }); }
export const collectionHeadId = (owner: string, collection: string): string => collectionHeadRef(owner, collection).id;
export const sequenceId = (sequence: number): string => String(sequence).padStart(16, '0');

/** Heads are server-owned. Reject damaged or cross-owner state rather than reset counters. */
export function readHeadVersion(owner: string, collection: string, raw: DocumentData | undefined): number {
  if (!raw) return 0;
  const metadata = raw._dataEngine;
  if (raw.userId !== owner || raw.collection !== collection) return invalid('permission-denied');
  if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 1 || !metadata || Array.isArray(metadata) || typeof metadata !== 'object'
      || metadata.protocol !== 1 || metadata.generation !== collectionHeadId(owner, collection)
      || metadata.revision !== (raw.version as number) + 1 || metadata.deleted !== false) return invalid();
  return raw.version as number;
}

/** Called only after all affected heads have been read in the command transaction. */
export function planFeedWrites(owner: string, operationId: string, effects: ResourceSnapshot[], heads: Map<string, DocumentData | undefined>): FeedWrite[] {
  const collections = new Map<string, Set<string>>();
  for (const effect of effects) {
    if (effect.resource.collection === HEADS_COLLECTION) return invalid();
    const ids = collections.get(effect.resource.collection) ?? new Set<string>();
    if (ids.has(effect.resource.id)) return invalid();
    ids.add(effect.resource.id);
    collections.set(effect.resource.collection, ids);
  }
  const writes: FeedWrite[] = [];
  for (const [collection, ids] of collections) {
    if (!heads.has(collection)) return invalid('missing-change-head');
    const headId = collectionHeadId(owner, collection);
    let version = readHeadVersion(owner, collection, heads.get(collection));
    if (!Number.isSafeInteger(version + ids.size + 1)) return invalid('change-feed-exhausted');
    for (const id of [...ids].sort()) {
      version++;
      writes.push({ path: [HEADS_COLLECTION, headId, 'changes', sequenceId(version)], value: { resource: { collection, id }, version } });
    }
    writes.push({ path: [HEADS_COLLECTION, headId], value: { userId: owner, collection, version,
      _dataEngine: { protocol: 1, generation: headId, revision: version + 1, deleted: false, operationId } } });
  }
  return writes;
}

export function parseChangePointer(collection: string, documentId: string, raw: DocumentData): ChangePointer | undefined {
  const resource = raw.resource;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)
      || resource.collection !== collection || !isValidIdentifier(resource.id)
      || !Number.isSafeInteger(raw.version) || (raw.version as number) < 1 || sequenceId(raw.version as number) !== documentId) return undefined;
  return { resource: { collection, id: resource.id }, version: raw.version as number };
}

/** Cursor advances only through contiguous pointers included in this bounded page. */
export function assembleChangePage(version: number, after: number, pointers: Array<ChangePointer | undefined>, snapshots: Map<string, ResourceSnapshot>, maxBytes = MAX_CHANGE_BYTES): CollectionChanges {
  const result: CollectionChanges = { version, cursor: after, snapshots: [], hasMore: after < version };
  if (after > version) return { ...result, hasMore: false, resetRequired: true };
  const seen = new Set<string>();
  let bytes = 0;
  for (const pointer of pointers) {
    if (!pointer || pointer.version !== result.cursor + 1 || pointer.version > version) return { ...result, resetRequired: true };
    const snapshot = snapshots.get(pointer.resource.id);
    if (!snapshot || (snapshot.value === null && snapshot.metadata === null)) return { ...result, resetRequired: true };
    if (!seen.has(pointer.resource.id)) {
      const size = Buffer.byteLength(JSON.stringify(snapshot));
      if (bytes + size > maxBytes) {
        if (!result.snapshots.length) return invalid('change-document-too-large');
        break;
      }
      result.snapshots.push(snapshot);
      seen.add(pointer.resource.id);
      bytes += size;
    }
    result.cursor = pointer.version;
  }
  result.hasMore = result.cursor < version;
  if (!pointers.length && result.hasMore) result.resetRequired = true;
  return result;
}
