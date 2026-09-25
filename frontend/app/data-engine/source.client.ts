'use client';

import { doc, onSnapshot } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { resolveOwnerUid } from '@/utils/queryKeys';

import { getResourcePolicy, TOMBSTONE_OWNER_FIELD } from './protocol';
import { snapshotSchema } from './transport.client';

import type { ObservationSource } from './observer';
import type { Json, ResourceRef, ResourceSnapshot } from './types';

/** Match server JSON decoding so SDK and HTTP copies compare by content. */
export function normalizeFirestoreValue(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (value && typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeFirestoreValue(item)]));
  }
  throw new Error('Unsupported stored value');
}

function decode(owner: string, resource: ResourceRef, raw: Record<string, unknown> | undefined): ResourceSnapshot {
  const policy = getResourcePolicy(resource.collection);
  // A tombstone names its owner outside the legacy owner field, so no legacy query returns it.
  const ownedBy = raw && (raw[policy.ownerField] ?? raw[TOMBSTONE_OWNER_FIELD]);
  if (policy.ownerField === 'id' ? resource.id !== owner : raw && ownedBy !== owner) {
    throw new Error('Document ownership mismatch');
  }
  if (!raw) return { resource, value: null, metadata: null };
  if (raw._dataEngine === null) throw new Error('Unsupported protocol metadata');
  const metadata = raw._dataEngine === undefined ? null : raw._dataEngine;
  const deleted = metadata && typeof metadata === 'object' && 'deleted' in metadata && metadata.deleted === true;
  const content = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== '_dataEngine' && key !== TOMBSTONE_OWNER_FIELD));
  return snapshotSchema.parse({ resource, metadata, value: deleted ? null : normalizeFirestoreValue(content) });
}

/** A read-only SDK source. Journal delivery remains exclusively on the HTTP transport. */
export function createFirestoreObservationSource(): ObservationSource {
  return {
    listen(owner, resource, publish, onError) {
      resource = { ...resource };
      let active = true;
      let stop: (() => void) | undefined;
      const current = () => active && Boolean(owner) && resolveOwnerUid() === owner;
      const reportError = () => { if (current()) onError(); };
      if (!current()) return () => { active = false; };
      try {
        const policy = getResourcePolicy(resource.collection);
        if (!resource.id || resource.id.length > 1500 || resource.id.includes('/')
          || resource.id === '.' || resource.id === '..' || /^__.*__$/.test(resource.id)) throw new Error('Invalid document identity');
        if (policy.ownerField === 'id' && resource.id !== owner) throw new Error('Document ownership mismatch');
        stop = onSnapshot(doc(getClientDb(), resource.collection, resource.id), { includeMetadataChanges: true }, (snapshot) => {
          if (!current() || snapshot.metadata.hasPendingWrites) return;
          if (snapshot.metadata.fromCache && !snapshot.exists()) return;
          try {
            const decoded = decode(owner, resource, snapshot.exists() ? snapshot.data() : undefined);
            if (!current() || (snapshot.metadata.fromCache && decoded.value === null)) return;
            publish({ snapshot: decoded, source: snapshot.metadata.fromCache ? 'cache' : 'server' });
          } catch { reportError(); }
        }, reportError);
      } catch { reportError(); }
      return () => {
        if (!active) return;
        active = false;
        stop?.();
      };
    },
  };
}
