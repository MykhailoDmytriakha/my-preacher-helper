import { QueryClient, dehydrate } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { get, set, update } from 'idb-keyval';

import { createAccountQueryPersister } from '@/utils/accountQueryCache';
import { accountReadCacheKey } from '@/utils/queryPersister';

import type { PersistedClient } from '@tanstack/react-query-persist-client';

jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), update: jest.fn(), del: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
const owner = 'owner-read-cache';
const entitlementKey = ['me', 'entitlement', 'v2', owner];
const disk = new Map<string, unknown>();
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const put = (key: IDBValidKey, value: unknown) => disk.set(keyOf(key), clone(value));
function snapshot(value: number, readVersion?: string, updatedAt?: number): PersistedClient {
  const client = new QueryClient();
  const data = { remaining: value };
  client.setQueryData(entitlementKey, readVersion ? { readVersion, value: data } : data, { updatedAt });
  const saved = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear();
  return saved;
}
beforeEach(() => {
  jest.clearAllMocks(); disk.clear();
  jest.mocked(get).mockImplementation(async key => clone(disk.get(keyOf(key))));
  jest.mocked(set).mockImplementation(async (key, value) => { put(key, value); });
  jest.mocked(update).mockImplementation(async (key, change) => { put(key, change(clone(disk.get(keyOf(key))))); });
});

it('keeps timestamp zero unread when TanStack attempts its restore-error removal', async () => {
  const seed = createAccountQueryPersister(owner);
  await seed.restoreClient(); await seed.persistClient(snapshot(7));
  const key = accountReadCacheKey(owner);
  const original = { ...(disk.get(keyOf(key)) as Record<string, unknown>), timestamp: 0 };
  put(key, original);
  const persister = createAccountQueryPersister(owner);
  const client = new QueryClient();
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await expect(persistQueryClientRestore({ queryClient: client, persister, maxAge: Infinity }))
      .rejects.toThrow('Saved read cache');
    expect(disk.get(keyOf(key))).toEqual(original);
    await persister.persistClient(snapshot(9));
    await persister.removeClient();
    expect(disk.get(keyOf(key))).toEqual(original);
  } finally {
    client.clear(); error.mockRestore(); warning.mockRestore();
  }
});


it('keeps the newer source answer when a different tab saves an older response later', async () => {
  const first = createAccountQueryPersister(owner);
  const second = createAccountQueryPersister(owner);
  await first.restoreClient();
  await second.restoreClient();
  await second.persistClient(snapshot(9, '1794036480:500000002', 200));
  await first.persistClient(snapshot(7, '1794036480:500000001', 300));

  const reopened = await createAccountQueryPersister(owner).restoreClient();
  expect(reopened?.clientState.queries[0].state.data).toEqual({
    readVersion: '1794036480:500000002', value: { remaining: 9 },
  });
});

it('copies a v1 offline answer forward once without changing what an older bundle reads', async () => {
  const previousKey = accountReadCacheKey(owner, 'v1');
  const query = snapshot(7).clientState.queries[0];
  const previous = { schema: 1, epoch: 'previous', buster: '', timestamp: Date.now(), sequence: 1,
    records: { [query.queryHash]: { revision: 1, query } } };
  put(previousKey, previous);

  const current = createAccountQueryPersister(owner);
  expect((await current.restoreClient())?.clientState.queries[0].state.data).toEqual({ remaining: 7 });
  await current.persistClient(snapshot(9, '1794036480:500000002'));

  expect(disk.get(keyOf(previousKey))).toEqual(previous);
  const reopened = await createAccountQueryPersister(owner).restoreClient();
  expect(reopened?.clientState.queries[0].state.data).toEqual({
    readVersion: '1794036480:500000002', value: { remaining: 9 },
  });
});

it('keeps a retired answer retired when an older success arrives from another tab', async () => {
  const active = createAccountQueryPersister(owner);
  const delayed = createAccountQueryPersister(owner);
  await active.restoreClient();
  await delayed.restoreClient();
  await active.persistClient(snapshot(9, '1794036480:500000002'));
  await active.persistClient({ timestamp: Date.now(), buster: '', clientState: { queries: [], mutations: [] } });
  await delayed.persistClient(snapshot(7, '1794036480:500000001'));

  const reopened = await createAccountQueryPersister(owner).restoreClient();
  expect(reopened?.clientState.queries).toEqual([]);
  await delayed.persistClient(snapshot(10, '1794036480:500000003'));
  const updated = await createAccountQueryPersister(owner).restoreClient();
  expect(updated?.clientState.queries[0].state.data).toEqual({
    readVersion: '1794036480:500000003', value: { remaining: 10 },
  });
});
