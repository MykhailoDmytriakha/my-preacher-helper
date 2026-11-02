import { TechnicalFailure } from '@/utils/failureCode';

import type { UseStore } from 'idb-keyval';

export type StorageRead = <V>(request: IDBRequest<V>, success: (value: V) => void) => void;
export type StorageTransaction = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, read: StorageRead, done: (value: T) => void) => void) => Promise<T>;

/** Request callbacks stay inside one transaction; only its completion acknowledges the result. */
export function createStorageTransaction(database: () => UseStore): StorageTransaction {
  return <T,>(mode: IDBTransactionMode, action: (store: IDBObjectStore, read: StorageRead, done: (value: T) => void) => void): Promise<T> => {
    return database()(mode, store => new Promise<T>((resolve, reject) => {
      let result: T;
      const fail = (error: unknown) => { reject(error); try { store.transaction.abort(); } catch { /* Already aborted. */ } };
      store.transaction.oncomplete = () => resolve(result);
      store.transaction.onabort = () => reject(store.transaction.error ?? new TechnicalFailure('Data storage aborted'));
      store.transaction.onerror = () => reject(store.transaction.error ?? new TechnicalFailure('Data storage failed'));
      const read: StorageRead = (request, success) => {
        request.onsuccess = () => { try { success(request.result); } catch (error) { fail(error); } };
        request.onerror = () => fail(request.error ?? new TechnicalFailure('Data storage read failed'));
      };
      try { action(store, read, value => { result = value; }); } catch (error) { fail(error); }
    }));
  };
}
