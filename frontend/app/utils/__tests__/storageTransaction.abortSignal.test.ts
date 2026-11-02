import { createStorageTransaction } from '@/utils/storageTransaction';

import type { UseStore } from 'idb-keyval';

type TransactionAction<T> = (
  store: IDBObjectStore,
  read: (request: IDBRequest<unknown>, success: (value: unknown) => void) => void,
  done: (value: T) => void,
) => void;
type AbortableTransaction = <T>(
  mode: IDBTransactionMode,
  action: TransactionAction<T>,
  signal?: AbortSignal,
) => Promise<T>;
type StoreCallback = (store: IDBObjectStore) => Promise<unknown>;

type HarnessOptions = { deferStore?: boolean };

function createHarness({ deferStore = false }: HarnessOptions = {}) {
  let storeCallback: StoreCallback | undefined;
  let storeOpened: (() => void) | undefined;
  let committed = false;
  let aborted = false;
  const transaction = {
    error: null as DOMException | null,
    onabort: null as ((event: Event) => void) | null,
    oncomplete: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    abort: jest.fn(() => {
      if (committed) throw new DOMException('The transaction is no longer active', 'InvalidStateError');
      if (aborted) throw new DOMException('The transaction was already aborted', 'InvalidStateError');
      aborted = true;
      transaction.error = new DOMException('The transaction was aborted', 'AbortError');
      queueMicrotask(() => transaction.onabort?.(new Event('abort')));
    }),
  };
  const store = { transaction, put: jest.fn() } as unknown as IDBObjectStore;
  const useStore = ((
    _mode: IDBTransactionMode,
    callback: StoreCallback,
  ) => {
    storeCallback = callback;
    if (!deferStore) return callback(store);
    return new Promise((resolve, reject) => {
      storeOpened = () => {
        try {
          Promise.resolve(callback(store)).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      };
    });
  }) as unknown as UseStore;
  const run = createStorageTransaction(() => useStore) as AbortableTransaction;
  return {
    run,
    transaction,
    openStore: () => {
      if (!storeOpened) throw new Error('Store opening was not deferred');
      storeOpened();
    },
    hasStoreCallback: () => storeCallback !== undefined,
    markCommitted: () => { committed = true; },
    commit: () => {
      if (aborted) return;
      committed = true;
      transaction.oncomplete?.(new Event('complete'));
    },
    failRead: (request: IDBRequest<unknown>, error: DOMException) => {
      Object.defineProperty(request, 'error', { configurable: true, value: error });
      request.onerror?.(new Event('error'));
    },
    succeedRead: (request: IDBRequest<unknown>, value: unknown) => {
      Object.defineProperty(request, 'result', { configurable: true, value });
      request.onsuccess?.(new Event('success'));
    },
  };
}

function makeRequest(): IDBRequest<unknown> {
  return {
    error: null,
    onsuccess: null,
    onerror: null,
    result: undefined,
  } as unknown as IDBRequest<unknown>;
}

describe('createStorageTransaction AbortSignal behavior', () => {
  it('rejects an already-aborted signal without opening storage or invoking the action', async () => {
    const controller = new AbortController();
    controller.abort();
    const database = jest.fn(() => {
      throw new Error('Storage must not be opened for an already-aborted signal');
    });
    const run = createStorageTransaction(database as unknown as () => UseStore) as AbortableTransaction;
    const action = jest.fn();

    await expect(run('readwrite', action, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(database).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('prevents writes when a delayed store opening resolves after abort', async () => {
    const harness = createHarness({ deferStore: true });
    const controller = new AbortController();
    const write = jest.fn();
    const action = jest.fn((store: IDBObjectStore) => {
      store.put('value', 'key');
      write();
    });
    const pending = harness.run('readwrite', action, controller.signal);

    expect(harness.hasStoreCallback()).toBe(true);
    controller.abort();
    harness.openStore();
    harness.commit();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(action).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(harness.transaction.abort).not.toHaveBeenCalled();
  });

  it('aborts its own transaction and ignores a held read that succeeds afterward', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const request = makeRequest();
    const userCallback = jest.fn();
    const write = jest.fn();
    const pending = harness.run('readwrite', (_store, read, done) => {
      read(request, value => {
        userCallback(value);
        write();
        done(value);
      });
    }, controller.signal);

    expect(request.onsuccess).toBeDefined();
    controller.abort();
    await Promise.resolve();
    harness.succeedRead(request, 'late value');
    harness.commit();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.transaction.abort).toHaveBeenCalledTimes(1);
    expect(userCallback).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('waits for confirmed abort when cancelled request errors bubble first', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const pending = harness.run('readwrite', (_store, _read, done) => done('not committed'), controller.signal);
    controller.abort();
    // Native IndexedDB can bubble errors while a manual abort still has no transaction error.
    harness.transaction.error = null;
    harness.transaction.onerror?.(new Event('error'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.transaction.abort).toHaveBeenCalledTimes(1);
  });

  it('keeps a committed result when abort arrives before the completion event', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    let settled = false;
    const pending = harness.run('readwrite', (_store, _read, done) => done('committed result'), controller.signal)
      .finally(() => { settled = true; });

    // The underlying IndexedDB transaction has committed, but oncomplete has not fired yet.
    harness.markCommitted();
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(harness.transaction.abort).toHaveBeenCalledTimes(1);

    harness.commit();
    await expect(pending).resolves.toBe('committed result');
  });

  it('preserves no-signal commit, read-failure, and synchronous-throw behavior', async () => {
    const committed = createHarness();
    const success = committed.run('readwrite', (_store, _read, done) => done('saved'));
    committed.commit();
    await expect(success).resolves.toBe('saved');

    const failedRead = createHarness();
    const request = makeRequest();
    const readFailure = new DOMException('Read failed', 'DataError');
    const failure = failedRead.run('readonly', (_store, read) => read(request, jest.fn()));
    failedRead.failRead(request, readFailure);
    await expect(failure).rejects.toBe(readFailure);
    expect(failedRead.transaction.abort).toHaveBeenCalledTimes(1);

    const thrown = createHarness();
    const actionFailure = new Error('Action failed synchronously');
    const synchronousFailure = thrown.run('readwrite', () => { throw actionFailure; });
    await expect(synchronousFailure).rejects.toBe(actionFailure);
    expect(thrown.transaction.abort).toHaveBeenCalledTimes(1);
  });
});
