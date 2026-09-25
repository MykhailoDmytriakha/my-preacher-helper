'use client';

import { createStore, entries, get, update } from 'idb-keyval';

import { canReplaceSnapshot } from './engine';
import { getResourcePolicy } from './protocol';
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

/** A shared confirmed cache; editor drafts always live in the separate checkpoint store. */
export function createIndexedDbSnapshots(): CollectionSnapshotStore {
  let store: ReturnType<typeof createStore> | undefined;
  const database = () => (store ??= createStore('preacher-data-engine-snapshots-v1', 'snapshots'));
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
      await update<ResourceSnapshot>(key(owner, frozen.resource), current => {
        const stored = current === undefined ? undefined : validate(owner, frozen.resource, current);
        return canReplaceSnapshot(stored, frozen) ? frozen : stored!;
      }, database());
    },
  };
}
