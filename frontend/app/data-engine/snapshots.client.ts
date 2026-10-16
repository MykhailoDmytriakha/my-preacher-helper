'use client';

import { entries, get, update } from 'idb-keyval';

import { watchedStore } from '@/utils/deviceStorage';

import { canReplaceSnapshot } from './engine';
import { equalValues, getResourcePolicy } from './protocol';
import { snapshotSchema } from './transport.client';

import type { CollectionSnapshotStore } from './collections';
import type { ResourceRef, ResourceSnapshot } from './types';

function validate(owner: string, resource: ResourceRef, value: unknown): ResourceSnapshot {
  const snapshot = snapshotSchema.parse(value);
  const policy = getResourcePolicy(resource.collection);
  if (snapshot.resource.collection !== resource.collection || snapshot.resource.id !== resource.id
    || (policy.ownerField === 'id' && resource.id !== owner)
    || (snapshot.value && policy.ownerField !== 'id' && snapshot.value[policy.ownerField] !== owner)) {
    throw new Error('Cached snapshot identity mismatch');
  }
  return snapshot;
}

type SnapshotListener = (resource: ResourceRef) => void;
const listeners = new Map<string, Set<SnapshotListener>>();

/** Local accepted-cache changes, shared by document and collection adapters; carries no draft data. */
export function subscribeSnapshotChanges(owner: string, listener: SnapshotListener): () => void {
  let subscriptions = listeners.get(owner);
  if (!subscriptions) listeners.set(owner, subscriptions = new Set());
  subscriptions.add(listener);
  return () => {
    subscriptions.delete(listener);
    if (!subscriptions.size && listeners.get(owner) === subscriptions) listeners.delete(owner);
  };
}

/** A shared confirmed cache; editor drafts always live in the separate checkpoint store. */
export function createIndexedDbSnapshots(): CollectionSnapshotStore {
  let store: ReturnType<typeof watchedStore> | undefined;
  const database = () => (store ??= watchedStore('preacher-data-engine-snapshots-v1', 'snapshots', 'engine-snapshots'));
  const key = (owner: string, resource: ResourceRef) => JSON.stringify([owner, resource.collection, resource.id]);
  return {
    async read(owner, resource) {
      const value = await get<unknown>(key(owner, resource), database());
      return value === undefined ? undefined : validate(owner, resource, value);
    },
    async list(owner, collection) {
      const rows = await entries<string, unknown>(database());
      const snapshots: ResourceSnapshot[] = [];
      for (const [storedKey, value] of rows) {
        let identity: unknown;
        try { identity = JSON.parse(storedKey); } catch { continue; }
        if (!Array.isArray(identity) || identity.length !== 3
          || identity[0] !== owner || identity[1] !== collection || typeof identity[2] !== 'string') continue;
        snapshots.push(validate(owner, { collection, id: identity[2] }, value));
      }
      return snapshots;
    },
    async put(owner, snapshot) {
      const frozen = validate(owner, snapshot.resource, snapshot);
      let changed = false;
      await update<ResourceSnapshot>(key(owner, frozen.resource), current => {
        const stored = current === undefined ? undefined : validate(owner, frozen.resource, current);
        if (!canReplaceSnapshot(stored, frozen)) return stored!;
        changed = !equalValues(stored, frozen);
        return frozen;
      }, database());
      // Only a completed transaction is evidence. A refused/unchanged candidate wakes nobody.
      if (changed) for (const listener of [...(listeners.get(owner) ?? [])]) {
        try { listener({ ...frozen.resource }); } catch { /* Rendering cannot fail an accepted cache write. */ }
      }
    },
  };
}
