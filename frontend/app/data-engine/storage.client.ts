'use client';

import { createStore } from 'idb-keyval';

export type StorageRead = <V>(request: IDBRequest<V>, success: (value: V) => void) => void;
export type StorageTransaction = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, read: StorageRead, done: (value: T) => void) => void) => Promise<T>;

export const engineOwnerRange = (kind: string, owner: string): IDBKeyRange => IDBKeyRange.bound([kind, owner], [kind, owner, []]);

/** Shared transactions make checkpoint/recovery references atomic with request retention. */
export function createEngineStorageTransaction(): StorageTransaction {
  let database: ReturnType<typeof createStore> | undefined;
  return <T,>(mode: IDBTransactionMode, action: (store: IDBObjectStore, read: StorageRead, done: (value: T) => void) => void): Promise<T> => {
    database ??= createStore('preacher-data-engine-state-v1', 'records');
    return database(mode, store => new Promise<T>((resolve, reject) => {
      let result: T;
      const fail = (error: unknown) => { reject(error); try { store.transaction.abort(); } catch { /* Already aborted. */ } };
      store.transaction.oncomplete = () => resolve(result);
      store.transaction.onabort = () => reject(store.transaction.error ?? new Error('Data storage aborted'));
      store.transaction.onerror = () => reject(store.transaction.error ?? new Error('Data storage failed'));
      const read: StorageRead = (request, success) => {
        request.onsuccess = () => { try { success(request.result); } catch (error) { fail(error); } };
        request.onerror = () => fail(request.error ?? new Error('Data storage read failed'));
      };
      try { action(store, read, value => { result = value; }); } catch (error) { fail(error); }
    }));
  };
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
