import { update, type UseStore } from 'idb-keyval';

/** Keep atomic update/commit semantics, including an abort before the first read succeeds. */
export function updateStoredValue<T>(key: IDBValidKey, change: (current: T | undefined) => T, store: UseStore): Promise<void> {
  const abortAware: UseStore = <Result,>(mode: IDBTransactionMode,
    action: (objectStore: IDBObjectStore) => Result | PromiseLike<Result>) => store(mode, objectStore => {
    const transaction = objectStore.transaction;
    let onAbort: () => void;
    return new Promise<Result>((resolve, reject) => {
      onAbort = () => reject(transaction.error ?? new DOMException('Storage update aborted', 'AbortError'));
      // An additive listener survives idb-keyval installing its completion handlers after get.
      transaction.addEventListener('abort', onAbort, { once: true });
      try { Promise.resolve(action(objectStore)).then(resolve, reject); }
      catch (error) { reject(error); }
    }).finally(() => transaction.removeEventListener('abort', onAbort));
  });
  return update(key, change, abortAware);
}
