'use client';

import { watchedStore } from '@/utils/deviceStorage';
import { createStorageTransaction, type StorageRead, type StorageTransaction } from '@/utils/storageTransaction';

export type { StorageRead, StorageTransaction } from '@/utils/storageTransaction';

export const engineOwnerRange = (kind: string, owner: string, ...path: string[]): IDBKeyRange => {
  const prefix = [kind, owner, ...path];
  return IDBKeyRange.bound(prefix, [...prefix, []]);
};

/** Shared transactions make checkpoint/recovery references atomic with request retention. */
export function createEngineStorageTransaction(): StorageTransaction {
  let database: ReturnType<typeof watchedStore> | undefined;
  return createStorageTransaction(() => database ??= watchedStore('preacher-data-engine-state-v1', 'records', 'engine-state'));
}

/** A stale recovery read must retry before it can create a dangling durable reference. */
export function validateCommitReferences(store: IDBObjectStore, read: StorageRead, owner: string, ids: readonly string[], proceed: () => void): void {
  const references = [...new Set(ids)];
  if (!references.length) { proceed(); return; }
  let remaining = references.length;
  for (const id of references) {
    read(store.get(['identity', owner, id]), (key: IDBValidKey | undefined) => {
      if (!key) throw Object.assign(new Error('Saved request reference changed'), { code: 'commit-reference-changed' });
      read(store.get(key), value => {
        if (!value) throw Object.assign(new Error('Saved request reference changed'), { code: 'commit-reference-changed' });
        remaining -= 1;
        if (!remaining) proceed();
      });
    });
  }
}
