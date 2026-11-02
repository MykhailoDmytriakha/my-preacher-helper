import { TechnicalFailure } from '@/utils/failureCode';

import type { UseStore } from 'idb-keyval';

export type StorageRead = <V>(request: IDBRequest<V>, success: (value: V) => void) => void;
export type StorageAction<T> = (store: IDBObjectStore, read: StorageRead, done: (value: T) => void) => void;
export type StorageTransaction = <T>(mode: IDBTransactionMode, action: StorageAction<T>) => Promise<T>;
export type CancellableStorageTransaction = <T>(mode: IDBTransactionMode, action: StorageAction<T>, signal?: AbortSignal) => Promise<T>;

/** Request callbacks stay inside one transaction; only its completion acknowledges the result. */
export function createStorageTransaction(database: () => UseStore): CancellableStorageTransaction {
  return <T,>(mode: IDBTransactionMode, action: StorageAction<T>, signal?: AbortSignal): Promise<T> => {
    const cancellation = () => signal?.reason ?? new DOMException('Storage transaction cancelled', 'AbortError');
    if (signal?.aborted) return Promise.reject(cancellation());
    return database()(mode, store => {
      // Opening storage can finish after cancellation; this transaction has not done any work.
      if (signal?.aborted) return Promise.reject(cancellation());
      return new Promise<T>((resolve, reject) => {
        let result: T, cancelled = false;
        const transaction = store.transaction;
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        const fail = (error: unknown) => { reject(error); try { transaction.abort(); } catch { /* Already aborted. */ } };
        const cancel = () => {
          cancelled = true;
          // A native commit can precede its completion event. In that case abort throws and the
          // completion must still acknowledge the committed result, rather than inventing a failure.
          try { transaction.abort(); } catch { /* The native outcome still decides. */ }
        };
        transaction.oncomplete = () => { cleanup(); resolve(result); };
        transaction.onabort = () => { cleanup(); reject(transaction.error ?? (cancelled ? cancellation() : new TechnicalFailure('Data storage aborted'))); };
        transaction.onerror = () => { if (!cancelled) { cleanup(); reject(transaction.error ?? new TechnicalFailure('Data storage failed')); } };
        const read: StorageRead = (request, success) => {
          request.onsuccess = () => { if (!cancelled) { try { success(request.result); } catch (error) { fail(error); } } };
          request.onerror = () => { if (!cancelled) fail(request.error ?? new TechnicalFailure('Data storage read failed')); };
        };
        signal?.addEventListener('abort', cancel, { once: true });
        try { action(store, read, value => { result = value; }); } catch (error) { fail(error); }
      });
    });
  };
}
