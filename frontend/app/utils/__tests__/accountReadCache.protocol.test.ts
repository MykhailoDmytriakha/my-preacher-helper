import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { get, set, update } from 'idb-keyval';

import { createAccountQueryPersister } from '@/utils/accountQueryCache';
import { accountReadCacheKey } from '@/utils/queryPersister';

import type { PersistedClient } from '@tanstack/react-query-persist-client';

jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), update: jest.fn(), del: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
const owner = 'protocol-owner';
const queryKey = ['me', 'entitlement', 'v2', owner];
const disk = new Map<string, unknown>();
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const put = (key: IDBValidKey, value: unknown) => disk.set(keyOf(key), clone(value));
const valueOf = (saved: PersistedClient | undefined) => saved?.clientState.queries.find(query => JSON.stringify(query.queryKey) === JSON.stringify(queryKey))?.state.data;
function snapshot(value: number): PersistedClient {
  const client = new QueryClient();
  client.setQueryData(queryKey, { remaining: value });
  const saved = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear(); return saved;
}
const normalUpdate = async (key: IDBValidKey, change: (current: unknown) => unknown) => { put(key, change(clone(disk.get(keyOf(key))))); };
beforeEach(() => {
  jest.clearAllMocks(); disk.clear();
  jest.mocked(get).mockImplementation(async key => clone(disk.get(keyOf(key))));
  jest.mocked(set).mockImplementation(async (key, value) => { put(key, value); });
  jest.mocked(update).mockImplementation(normalUpdate);
});

it('retries the same snapshot after a native commit fails without advancing its baseline', async () => {
  const persister = createAccountQueryPersister(owner);
  await persister.restoreClient(); await persister.persistClient(snapshot(7));
  const next = snapshot(9);
  jest.mocked(update).mockImplementationOnce(async (key, change) => {
    change(clone(disk.get(keyOf(key))));
    throw new Error('Commit aborted after the read callback');
  });
  await expect(persister.persistClient(next)).rejects.toThrow('Commit aborted');
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 7 });
  await persister.persistClient(next);
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 9 });
});

it('orders two snapshots while the first storage operation is delayed', async () => {
  const persister = createAccountQueryPersister(owner);
  await persister.restoreClient();
  let release: () => void = () => { throw new Error('First storage operation has not started'); };
  let started = false;
  jest.mocked(update).mockImplementationOnce((key, change) => new Promise<void>((resolve, reject) => {
    started = true;
    release = () => { normalUpdate(key, change).then(resolve, reject); };
  }));
  const first = persister.persistClient(snapshot(7));
  await Promise.resolve();
  expect(started).toBe(true);
  const updatesAtFirst = jest.mocked(update).mock.calls.length;
  const second = persister.persistClient(snapshot(9));
  await Promise.resolve();
  expect(jest.mocked(update).mock.calls.length).toBe(updatesAtFirst);
  release(); await first; await second;
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 9 });
});

it('keeps the old epoch usable when its clear transaction fails', async () => {
  const persister = createAccountQueryPersister(owner);
  await persister.restoreClient(); await persister.persistClient(snapshot(7));
  jest.mocked(update).mockImplementationOnce(async (key, change) => {
    change(clone(disk.get(keyOf(key))));
    throw new Error('Clear transaction aborted');
  });
  await expect(persister.removeClient()).rejects.toThrow('Clear transaction aborted');
  await persister.persistClient(snapshot(11));
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 11 });
});

it('leaves an unknown storage version unread and never replaces its original payload', async () => {
  const original = { schema: 99, unknownWords: 'Retain the future-format original' };
  put(accountReadCacheKey(owner), original);
  const persister = createAccountQueryPersister(owner);
  await expect(persister.restoreClient()).rejects.toThrow('Saved read cache');
  await persister.persistClient(snapshot(9)); await persister.removeClient();
  expect(disk.get(keyOf(accountReadCacheKey(owner)))).toEqual(original);
});

it('does not refill a self-cleared cache with its unchanged snapshot but accepts a new read', async () => {
  const persister = createAccountQueryPersister(owner);
  await persister.restoreClient();
  const old = snapshot(7);
  await persister.persistClient(old); await persister.removeClient();
  await persister.persistClient(old);
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toBeUndefined();
  await persister.persistClient(snapshot(9));
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 9 });
});

it('rechecks admission after an asynchronous opening before publishing a snapshot', async () => {
  let allowed = true;
  const persister = createAccountQueryPersister(owner, { mayOverwrite: () => allowed });
  await persister.restoreClient(); await persister.persistClient(snapshot(7));
  jest.mocked(update).mockImplementationOnce(async (key, change) => {
    allowed = false;
    await normalUpdate(key, change);
  });
  await persister.persistClient(snapshot(9));
  expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 7 });
});

it('admits a new buster after acknowledged reset and fences the previously opened tab', async () => {
  const current = createAccountQueryPersister(owner);
  await current.restoreClient(); await current.persistClient(snapshot(7));
  const oldTab = createAccountQueryPersister(owner); await oldTab.restoreClient();
  const client = new QueryClient();
  try {
    await persistQueryClientRestore({ queryClient: client, persister: current, buster: 'next', maxAge: Infinity });
    await current.persistClient({ ...snapshot(9), buster: 'next' });
    await oldTab.persistClient(snapshot(7));
    const restored = await createAccountQueryPersister(owner).restoreClient();
    expect(valueOf(restored)).toEqual({ remaining: 9 });
    expect(restored?.buster).toBe('next');
  } finally { client.clear(); }
});

it('keeps the newer in-memory query when a readable disk copy arrives late', async () => {
  jest.useFakeTimers();
  const client = new QueryClient();
  try {
    const seed = createAccountQueryPersister(owner);
    await seed.restoreClient(); const old = snapshot(7); await seed.persistClient(old);
    const saved = clone(disk.get(keyOf(accountReadCacheKey(owner))));
    let answer!: (value: unknown) => void;
    jest.mocked(get).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const taken: PersistedClient[] = [];
    const persister = createAccountQueryPersister(owner, { onLateRestore: copy => {
      taken.push(copy); hydrate(client, copy.clientState);
    } });
    const restoring = persister.restoreClient();
    await jest.advanceTimersByTimeAsync(3001);
    await expect(restoring).resolves.toBeUndefined();
    client.setQueryData(queryKey, { remaining: 9 }, { updatedAt: old.clientState.queries[0].state.dataUpdatedAt + 1000 });
    await persister.persistClient(snapshot(0)); await persister.removeClient();
    expect(disk.get(keyOf(accountReadCacheKey(owner)))).toEqual(saved);
    answer(saved); await jest.advanceTimersByTimeAsync(0);
    expect(taken).toHaveLength(1);
    expect(client.getQueryData(queryKey)).toEqual({ remaining: 9 });
    await persister.persistClient({ timestamp: Date.now(), buster: '', clientState: dehydrate(client) });
    expect(valueOf(await createAccountQueryPersister(owner).restoreClient())).toEqual({ remaining: 9 });
  } finally { client.clear(); jest.useRealTimers(); }
});
