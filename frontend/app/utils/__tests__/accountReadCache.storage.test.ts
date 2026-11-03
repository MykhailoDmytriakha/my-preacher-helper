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
function snapshot(value: number): PersistedClient {
  const client = new QueryClient();
  client.setQueryData(entitlementKey, { remaining: value });
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
