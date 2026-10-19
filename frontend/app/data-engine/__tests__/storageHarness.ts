import { createStore } from 'idb-keyval';

const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

/** Transactional fake: native commit and the application's completion callback are separate boundaries. */
export function installStorageHarness() {
  const completionCallbacks: Array<() => void> = [];
  const harness = { rows: new Map<string, unknown>(), holdCommit: false, finishCommit: undefined as (() => void) | undefined,
    readFailure: false, writeFailure: false,
    holdCompletionAfterCommit: undefined as ((rows: ReadonlyMap<string, unknown>, mode: IDBTransactionMode) => boolean) | undefined,
    finishCompletion: () => { completionCallbacks.shift()?.(); } };
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { bound: (lower: unknown, upper: unknown) => ({ lower, upper }) } });
  let queue: Promise<unknown> = Promise.resolve();
  const useStore: ReturnType<typeof createStore> = (mode, action) => {
    const beginning = queue.catch(() => undefined).then(() => {
      const draft = new Map(harness.rows); let pending = 0, aborted = false, completed = false;
      let releaseNative!: () => void;
      const finished = new Promise<void>(resolve => { releaseNative = resolve; });
      const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null,
        onerror: null, error: null, abort: () => { aborted = true; releaseNative(); tx.onabort?.(); } };
      const complete = () => {
        if (aborted || completed || pending) return;
        completed = true;
        if (mode === 'readwrite') harness.rows = draft;
        // A completed IndexedDB transaction releases its locks even if page JavaScript stops here.
        releaseNative();
        if (harness.holdCompletionAfterCommit?.(harness.rows, mode)) completionCallbacks.push(() => tx.oncomplete?.());
        else tx.oncomplete?.();
      };
      const read = (value: unknown) => {
        pending += 1;
        const request = { result: clone(value), error: new Error('read failed'), onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
        void Promise.resolve().then(() => {
          if (harness.readFailure) request.onerror?.(); else request.onsuccess?.();
          pending -= 1;
          if (harness.holdCommit) harness.finishCommit = complete; else void Promise.resolve().then(complete);
        });
        return request;
      };
      const store = {
        transaction: tx,
        get: (key: unknown) => read(draft.get(JSON.stringify(key))),
        put: (value: unknown, key: unknown) => { if (harness.writeFailure) throw new Error('disk full'); draft.set(JSON.stringify(key), clone(value)); },
        delete: (key: unknown) => { draft.delete(JSON.stringify(key)); },
        getAll: (range: { lower: unknown[] }) => read([...draft].filter(([key]) => {
          const parsed = JSON.parse(key); return parsed[0] === range.lower[0] && parsed[1] === range.lower[1];
        }).map(([, value]) => value)),
      } as unknown as IDBObjectStore;
      const result = action(store);
      void Promise.resolve().then(() => { if (harness.holdCommit) harness.finishCommit = complete; else complete(); });
      return { result, finished };
    });
    queue = beginning.then(({ finished }) => finished);
    return beginning.then(({ result }) => result);
  };
  jest.mocked(createStore).mockReturnValue(useStore);
  return harness;
}
