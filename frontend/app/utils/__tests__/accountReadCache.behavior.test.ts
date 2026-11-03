import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import { del, get, set, update } from 'idb-keyval';
import { accountQueryCacheKey, createAccountQueryPersister } from '@/utils/accountQueryCache';

import type { PersistedClient } from '@tanstack/react-query-persist-client';

jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), update: jest.fn(), del: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

const rows = new Map<string, unknown>();
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const put = (key: IDBValidKey, value: unknown) => rows.set(keyOf(key), clone(value));
const entitlementKey = ['me', 'entitlement', 'v2', 'owner-A'] as const;
const referralKey = ['referral-stats', 'owner-A'] as const;
const entitlementOld = { effectiveTier: 'free', remaining: { text: 7 } };
const entitlementNew = { effectiveTier: 'pro', remaining: { text: 19 } };
const entitlementNewest = { effectiveTier: 'team', remaining: { text: 31 } };
const referralOld = { total: 7 };
const referralNew = { total: 9 };

function snapshot(queries: [readonly unknown[], unknown][]): PersistedClient {
  const client = new QueryClient();
  for (const [key, data] of queries) client.setQueryData(key, clone(data));
  const saved = clone({ timestamp: Date.now(), buster: '', clientState: dehydrate(client) });
  client.clear();
  return saved;
}
function snapshotClient(client: QueryClient): PersistedClient {
  return clone({ timestamp: Date.now(), buster: '', clientState: dehydrate(client) });
}
function hydrateClient(saved: PersistedClient | undefined): QueryClient {
  const client = new QueryClient();
  if (saved) hydrate(client, clone(saved.clientState));
  return client;
}
function queryData(saved: PersistedClient | undefined, key: readonly unknown[]): unknown {
  return saved?.clientState.queries.find(query => JSON.stringify(query.queryKey) === JSON.stringify(key))?.state.data;
}
function dataUpdateCount(client: QueryClient, key: readonly unknown[]): number {
  return client.getQueryState(key)?.dataUpdateCount ?? -1;
}
beforeEach(() => {
  jest.clearAllMocks(); rows.clear();
  jest.mocked(get).mockImplementation(async key => clone(rows.get(keyOf(key))));
  jest.mocked(set).mockImplementation(async (key, value) => { put(key, value); });
  jest.mocked(update).mockImplementation(async (key, updater) => { put(key, updater(clone(rows.get(keyOf(key))))); });
  jest.mocked(del).mockImplementation(async key => { rows.delete(keyOf(key)); });
});

it('keeps a newer entitlement when a tab saving its old entitlement also adds referral stats', async () => {
  put(accountQueryCacheKey('owner-A'), snapshot([[entitlementKey, entitlementOld]]));
  const persisterA = createAccountQueryPersister('owner-A');
  const persisterB = createAccountQueryPersister('owner-A');
  const restoredA = await persisterA.restoreClient();
  const restoredB = await persisterB.restoreClient();
  expect(queryData(restoredA, entitlementKey)).toEqual(entitlementOld);
  expect(queryData(restoredB, entitlementKey)).toEqual(entitlementOld);

  const clientA = hydrateClient(restoredA);
  const clientB = hydrateClient(restoredB);
  expect(clientA.getQueryData(entitlementKey)).toEqual(entitlementOld);
  expect(clientB.getQueryData(entitlementKey)).toEqual(entitlementOld);
  clientA.setQueryData(entitlementKey, entitlementNew);
  await persisterA.persistClient(snapshotClient(clientA));
  clientB.setQueryData(referralKey, referralNew);
  await persisterB.persistClient(snapshotClient(clientB));

  const final = await createAccountQueryPersister('owner-A').restoreClient();
  expect(queryData(final, entitlementKey)).toEqual(entitlementNew);
  expect(queryData(final, referralKey)).toEqual(referralNew);
});

it('does not resurrect an entitlement after one tab clears the owner cache', async () => {
  put(accountQueryCacheKey('owner-A'), snapshot([[entitlementKey, entitlementOld]]));
  const persisterA = createAccountQueryPersister('owner-A');
  const persisterB = createAccountQueryPersister('owner-A');
  const restoredA = await persisterA.restoreClient();
  const restoredB = await persisterB.restoreClient();
  const clientB = hydrateClient(restoredB);
  expect(clientB.getQueryData(entitlementKey)).toEqual(entitlementOld);
  expect(queryData(restoredA, entitlementKey)).toEqual(entitlementOld);
  expect(queryData(restoredB, entitlementKey)).toEqual(entitlementOld);

  await persisterA.removeClient();
  await persisterB.persistClient(snapshotClient(clientB));
  const final = await createAccountQueryPersister('owner-A').restoreClient();
  expect(queryData(final, entitlementKey)).toBeUndefined();
});

it('keeps an individual query removal while preserving a different tab’s referral update', async () => {
  put(accountQueryCacheKey('owner-A'), snapshot([[entitlementKey, entitlementOld], [referralKey, referralOld]]));
  const persisterA = createAccountQueryPersister('owner-A');
  const persisterB = createAccountQueryPersister('owner-A');
  const restoredA = await persisterA.restoreClient();
  const restoredB = await persisterB.restoreClient();
  const clientA = hydrateClient(restoredA);
  const clientB = hydrateClient(restoredB);
  expect(clientA.getQueryData(entitlementKey)).toEqual(entitlementOld);
  expect(clientA.getQueryData(referralKey)).toEqual(referralOld);
  expect(clientB.getQueryData(entitlementKey)).toEqual(entitlementOld);
  expect(clientB.getQueryData(referralKey)).toEqual(referralOld);
  clientA.removeQueries({ queryKey: entitlementKey, exact: true });
  clientB.setQueryData(referralKey, referralNew);
  await persisterA.persistClient(snapshotClient(clientA));
  await persisterB.persistClient(snapshotClient(clientB));

  const final = await createAccountQueryPersister('owner-A').restoreClient();
  expect(queryData(final, entitlementKey)).toBeUndefined();
  expect(queryData(final, referralKey)).toEqual(referralNew);
});

it('does not let a later root timestamp replace another tab’s newer query data', async () => {
  put(accountQueryCacheKey('owner-A'), snapshot([[entitlementKey, entitlementOld]]));
  const persisterA = createAccountQueryPersister('owner-A');
  const persisterB = createAccountQueryPersister('owner-A');
  const restoredA = await persisterA.restoreClient();
  const restoredB = await persisterB.restoreClient();
  const clientA = hydrateClient(restoredA);
  const clientB = hydrateClient(restoredB);
  expect(clientA.getQueryData(entitlementKey)).toEqual(entitlementOld);
  expect(clientB.getQueryData(entitlementKey)).toEqual(entitlementOld);
  clientA.setQueryData(entitlementKey, entitlementNewest);
  const newerSnapshot = snapshotClient(clientA);
  await persisterA.persistClient(newerSnapshot);

  const staleSnapshot = snapshotClient(clientB);
  const laterRootOnly: PersistedClient = { ...staleSnapshot, timestamp: newerSnapshot.timestamp + 1 }; // Change only the persisted envelope time; query data and metadata stay byte-for-byte unchanged.
  expect(laterRootOnly.timestamp).toBeGreaterThan(newerSnapshot.timestamp);
  expect(laterRootOnly.clientState).toEqual(staleSnapshot.clientState);
  await persisterB.persistClient(laterRootOnly);

  const final = await createAccountQueryPersister('owner-A').restoreClient();
  expect(queryData(final, entitlementKey)).toEqual(entitlementNewest);
});

it('accepts a new QueryClient value after the system clock moves backward', async () => {
  put(accountQueryCacheKey('owner-A'), snapshot([[entitlementKey, entitlementOld]]));
  const persister = createAccountQueryPersister('owner-A');
  const restored = await persister.restoreClient();
  const client = hydrateClient(restored);
  expect(client.getQueryData(entitlementKey)).toEqual(entitlementOld);
  const beforeCount = dataUpdateCount(client, entitlementKey);
  const forwardNow = Date.now();
  const rolledBackNow = forwardNow - 60_000;
  const originalNow = Date.now;
  let afterCount = -1;
  try {
    Date.now = () => rolledBackNow;
    client.setQueryData(entitlementKey, entitlementNew);
    afterCount = dataUpdateCount(client, entitlementKey);
    await persister.persistClient(snapshotClient(client));
  } finally {
    Date.now = originalNow;
  }

  const final = await createAccountQueryPersister('owner-A').restoreClient();
  expect(afterCount).toBeGreaterThan(beforeCount);
  expect(queryData(final, entitlementKey)).toEqual(entitlementNew);
});

it('restores a cleared persister lifetime before saving fresh data', async () => {
  const persister = createAccountQueryPersister('owner-A');
  await persister.restoreClient();
  const firstClient = new QueryClient();
  firstClient.setQueryData(entitlementKey, entitlementOld);
  await persister.persistClient(snapshotClient(firstClient));
  await persister.removeClient();

  const freshLifetime = createAccountQueryPersister('owner-A');
  const clearedRestore = await freshLifetime.restoreClient();
  expect(clearedRestore?.clientState.queries ?? []).toEqual([]);
  const nextClient = new QueryClient();
  nextClient.setQueryData(entitlementKey, entitlementNew);
  await freshLifetime.persistClient(snapshotClient(nextClient));
  const final = await createAccountQueryPersister('owner-A').restoreClient();
  expect(queryData(final, entitlementKey)).toEqual(entitlementNew);
});

it('preserves the existing separation between different accounts', async () => {
  const persisterA = createAccountQueryPersister('owner-A');
  const persisterB = createAccountQueryPersister('owner-B');
  await persisterA.restoreClient(); await persisterB.restoreClient();
  const clientA = new QueryClient(); const clientB = new QueryClient();
  clientA.setQueryData(referralKey, referralOld);
  clientB.setQueryData(['referral-stats', 'owner-B'], { total: 11 });
  await persisterA.persistClient(snapshotClient(clientA));
  await persisterB.persistClient(snapshotClient(clientB));
  const finalA = await createAccountQueryPersister('owner-A').restoreClient();
  const finalB = await createAccountQueryPersister('owner-B').restoreClient();
  expect(queryData(finalA, referralKey)).toEqual(referralOld);
  expect(queryData(finalB, ['referral-stats', 'owner-B'])).toEqual({ total: 11 });
  expect(rows.has(keyOf(accountQueryCacheKey('owner-A')))).toBe(true);
});
