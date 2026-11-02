/** @jest-environment node */

import { createOfflinePageStorage } from '@/utils/offlinePageStorage';

import type { CancellableStorageTransaction, StorageAction } from '@/utils/storageTransaction';

const ORIGIN = 'https://app.test';
const address = (id: string) => `${ORIGIN}/sermons/${id}`;
const acceptAddress = (value: string) => {
  const parsed = new URL(value);
  return parsed.origin === ORIGIN && /^\/sermons\/[a-zA-Z0-9-]+$/.test(parsed.pathname) && !parsed.search && !parsed.hash;
};
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const clone = <T>(value: T): T => structuredClone(value);

function createHarness() {
  const rows = new Map<string, unknown>();
  let failPayloadWrite = false;
  const transaction: CancellableStorageTransaction = async <T>(
    _mode: IDBTransactionMode,
    action: StorageAction<T>,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted) throw signal.reason;
    const pending = new Map([...rows].map(([key, value]) => [key, clone(value)]));
    const store = {
      get(key: IDBValidKey) {
        return { result: clone(pending.get(keyOf(key))), error: null, onsuccess: null, onerror: null } as unknown as IDBRequest;
      },
      put(value: unknown, key: IDBValidKey) {
        if (failPayloadWrite && Array.isArray(key) && key[0] === 'payload') {
          throw new DOMException('Injected payload write failure', 'QuotaExceededError');
        }
        pending.set(keyOf(key), clone(value));
      },
      delete(key: IDBValidKey) { pending.delete(keyOf(key)); },
    } as unknown as IDBObjectStore;
    const read = <V>(request: IDBRequest<V>, success: (value: V) => void) => {
      request.onsuccess = () => success(request.result);
      request.onsuccess.call(request, new Event('success'));
    };
    let result!: T;
    action(store, read, value => { result = value; });
    if (signal?.aborted) throw signal.reason;
    rows.clear();
    pending.forEach((value, key) => rows.set(key, value));
    return result;
  };
  return {
    rows,
    transaction,
    storage(build: string, maxEntries = 2, now: () => number = () => 100) {
      return createOfflinePageStorage({ build, maxEntries, acceptAddress, transaction, now });
    },
    failPayloadWrites(value: boolean) { failPayloadWrite = value; },
    payload(addressValue: string) { return rows.get(keyOf(['payload', addressValue])); },
    catalog() { return rows.get(keyOf('catalog')); },
    setCatalog(value: unknown) { rows.set(keyOf('catalog'), value); },
  };
}

function payload(text: string) {
  const bytes = new TextEncoder().encode(text);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return {
    body,
    headers: [['content-type', 'text/html'], ['x-page', text]] as [string, string][],
    status: 200,
    statusText: 'OK',
  };
}

async function reserve(storage: ReturnType<ReturnType<typeof createHarness>['storage']>, value: string) {
  const result = await storage.reserve(value, { leaseMs: 1000 });
  expect(result.outcome).toBe('fetch');
  if (result.outcome !== 'fetch') throw new Error(`Expected a fetch reservation, got ${result.outcome}`);
  return result.ticket;
}

describe('offline page storage', () => {
  it('reserves, publishes, and reads the exact body bytes and response metadata', async () => {
    const harness = createHarness();
    const storage = harness.storage('build-1');
    await storage.activate();
    const page = address('one');
    const ticket = await reserve(storage, page);
    const original = payload('body bytes: \u0000\u0001\u00ff');

    await expect(storage.publish(ticket, original)).resolves.toBe(true);
    const stored = harness.payload(page) as { body: ArrayBuffer; headers: [string, string][]; status: number; statusText: string; build: string; generation: number };
    expect([...new Uint8Array(stored.body)]).toEqual([...new Uint8Array(original.body)]);
    expect(stored).toMatchObject({ headers: original.headers, status: 200, statusText: 'OK', build: 'build-1', generation: ticket.generation });
    expect(await storage.entries()).toEqual([expect.objectContaining({ address: page, warm: true, generation: ticket.generation })]);
    const read = await storage.read(page);
    expect(read).toMatchObject(original);
    expect([...new Uint8Array(read!.body)]).toEqual([...new Uint8Array(original.body)]);
  });

  it('retires old-build bodies, preserves addresses, and rejects old-worker adoption', async () => {
    const harness = createHarness();
    const oldWorker = harness.storage('build-1');
    await oldWorker.activate();
    const page = address('kept-address');
    const oldTicket = await reserve(oldWorker, page);
    await oldWorker.publish(oldTicket, payload('old body'));
    const before = await oldWorker.entries();

    const currentWorker = harness.storage('build-2');
    await currentWorker.activate();
    expect(await oldWorker.read(page)).toBeUndefined();
    expect(await oldWorker.reserve(page, { leaseMs: 1000 })).toEqual({ outcome: 'inactive' });
    await expect(oldWorker.publish(oldTicket, payload('stale body'))).resolves.toBe(false);
    expect(harness.payload(page)).toBeUndefined();
    const currentEntries = await currentWorker.entries();
    expect(currentEntries).toEqual([expect.objectContaining({ address: page, warm: false })]);
    expect(currentEntries[0].generation).not.toBe(before[0].generation);
  });

  it('does not let an expired ticket overwrite a newer claim and body', async () => {
    const harness = createHarness();
    let now = 10;
    const storage = harness.storage('build-1', 2, () => now);
    await storage.activate();
    const page = address('reclaimed');
    const expired = await reserve(storage, page);
    now = expired.until + 1;
    const fresh = await reserve(storage, page);

    await expect(storage.publish(expired, payload('stale body'))).resolves.toBe(false);
    await expect(storage.publish(fresh, payload('fresh body'))).resolves.toBe(true);
    const read = await storage.read(page);
    expect(new TextDecoder().decode(read!.body)).toBe('fresh body');
  });

  it('keeps an address when an older gone result follows a later visit', async () => {
    const harness = createHarness();
    const storage = harness.storage('build-1');
    await storage.activate();
    const page = address('visited-again');
    const oldTicket = await reserve(storage, page);
    expect(await storage.reserve(page, { leaseMs: 1000, seen: true })).toEqual({ outcome: 'busy' });

    await expect(storage.finish(oldTicket, { gone: true })).resolves.toBe(true);
    expect(await storage.entries()).toEqual([expect.objectContaining({ address: page, warm: false })]);
    expect(harness.payload(page)).toBeUndefined();
  });

  it('ignores a stale gone result after a new build advances the address generation', async () => {
    const harness = createHarness();
    const oldWorker = harness.storage('build-1');
    await oldWorker.activate();
    const page = address('new-generation');
    const oldTicket = await reserve(oldWorker, page);
    const currentWorker = harness.storage('build-2');
    await currentWorker.activate();
    const currentEntry = (await currentWorker.entries())[0];

    await expect(oldWorker.finish(oldTicket, { gone: true })).resolves.toBe(false);
    expect(await currentWorker.entries()).toEqual([expect.objectContaining({ address: page, generation: currentEntry.generation, warm: false })]);
  });

  it('evicts the least-recent warm body after a refresh advances recency', async () => {
    const harness = createHarness();
    const storage = harness.storage('build-1', 2);
    await storage.activate();
    const page0 = address('0'), page1 = address('1'), page2 = address('2');
    for (const page of [page0, page1]) await storage.publish(await reserve(storage, page), payload(page));
    await expect(storage.reserve(page0, { leaseMs: 1000, seen: true })).resolves.toEqual({ outcome: 'kept' });
    await storage.publish(await reserve(storage, page2), payload(page2));

    expect(await storage.read(page0)).toBeDefined();
    expect(await storage.read(page1)).toBeUndefined();
    expect(await storage.read(page2)).toBeDefined();
    expect((await storage.entries()).map(entry => entry.address)).toEqual([page0, page2]);
  });

  it('does not evict usable warm bodies when cold reservations exceed their separate limit', async () => {
    const harness = createHarness();
    const storage = harness.storage('build-1', 2);
    await storage.activate();
    const warm0 = address('warm-0'), warm1 = address('warm-1');
    await storage.publish(await reserve(storage, warm0), payload('warm-0 body'));
    await storage.publish(await reserve(storage, warm1), payload('warm-1 body'));
    await reserve(storage, address('cold-0'));
    await reserve(storage, address('cold-1'));
    await reserve(storage, address('cold-2'));

    expect(new TextDecoder().decode((await storage.read(warm0))!.body)).toBe('warm-0 body');
    expect(new TextDecoder().decode((await storage.read(warm1))!.body)).toBe('warm-1 body');
    expect((await storage.entries()).filter(entry => entry.warm)).toHaveLength(2);
  });

  it('rolls back catalog and body state when a payload write fails', async () => {
    const harness = createHarness();
    const storage = harness.storage('build-1');
    await storage.activate();
    const page = address('write-failure');
    const ticket = await reserve(storage, page);
    const catalogBefore = structuredClone(harness.catalog());
    harness.failPayloadWrites(true);

    await expect(storage.publish(ticket, payload('must not persist'))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    harness.failPayloadWrites(false);
    expect(harness.catalog()).toEqual(catalogBefore);
    expect(harness.payload(page)).toBeUndefined();
    expect(await storage.entries()).toEqual([expect.objectContaining({ address: page, warm: false, claim: expect.objectContaining({ id: ticket.claim }) })]);
  });

  it('honors explicit retry deadlines across fresh storage instances', async () => {
    const harness = createHarness();
    let now = 100;
    const first = harness.storage('build-1', 2, () => now);
    await first.activate();
    const page = address('retry-later');
    const ticket = await reserve(first, page);
    const retryAt = now + 60_000;
    await expect(first.finish(ticket, { refusal: true, retryAt })).resolves.toBe(true);

    const restarted = harness.storage('build-1', 2, () => now);
    await expect(restarted.reserve(page, { leaseMs: 1000 })).resolves.toEqual({ outcome: 'cooling' });
    now = retryAt + 1;
    const retry = await restarted.reserve(page, { leaseMs: 1000 });
    expect(retry.outcome).toBe('fetch');
  });

  it('rejects unreadable catalog metadata without replacing it with an empty catalog', async () => {
    const harness = createHarness();
    const corrupt = { schema: 99, build: 'build-1', sequence: 1, pages: [], legacyImported: [] };
    harness.setCatalog(corrupt);
    const storage = harness.storage('build-1');

    await expect(storage.entries()).rejects.toMatchObject({ message: 'Offline page catalog is unreadable' });
    expect(harness.catalog()).toEqual(corrupt);
  });
});
