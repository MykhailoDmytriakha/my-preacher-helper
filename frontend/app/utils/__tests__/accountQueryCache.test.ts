import { QueryClient, dehydrate } from '@tanstack/react-query';
import { get, set, update } from 'idb-keyval';

import { accountQueryCacheKey, createAccountQueryPersister } from '@/utils/accountQueryCache';
import { accountReadCacheKey, queryCacheStore } from '@/utils/queryPersister';

import type { PersistedClient } from '@tanstack/react-query-persist-client';

jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), update: jest.fn(), del: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
const rows = new Map<string, unknown>();
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
function fixture(queries: [readonly unknown[], unknown][]): PersistedClient {
  const client = new QueryClient();
  for (const [key, value] of queries) client.setQueryData(key, value);
  const saved = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear();
  return saved;
}
function readCache(saved: PersistedClient) {
  const records = Object.fromEntries(saved.clientState.queries.map((query, index) => [query.queryHash, { revision: index + 1, query }]));
  return { schema: 1 as const, epoch: 'test-read-cache', buster: saved.buster, timestamp: saved.timestamp, sequence: saved.clientState.queries.length, records };
}
const put = (key: IDBValidKey, value: unknown) => rows.set(keyOf(key), clone(value));
beforeEach(() => {
  jest.clearAllMocks(); rows.clear();
  jest.mocked(get).mockImplementation(async key => clone(rows.get(keyOf(key))));
  jest.mocked(set).mockImplementation(async (key, value) => { put(key, value); });
  jest.mocked(update).mockImplementation(async (key, updater) => { put(key, updater(clone(rows.get(keyOf(key))))); });
});

it('keeps signed-out storage operations in memory only', async () => {
  const persister = createAccountQueryPersister(undefined);
  await persister.restoreClient(); await persister.persistClient(fixture([])); await persister.removeClient();
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
});

it('does not publish A or unassigned originals while initializing B', async () => {
  const original = fixture([[['referral-stats', 'A'], 37], [['old-unscoped'], { content: 'Original words' }]]);
  put('react-query-cache', original);
  const b = await createAccountQueryPersister('B').restoreClient();
  expect(b?.clientState.queries).toEqual([]);
  expect(rows.get(keyOf('react-query-cache'))).toEqual(original);
  const a = await createAccountQueryPersister('A').restoreClient();
  expect(a?.clientState.queries.map(query => query.state.data)).toEqual([37]);
  expect(rows.get(keyOf('react-query-cache'))).toEqual(original);
});

it('keeps a newer read-cache partition created while the historical global fallback is being read', async () => {
  const legacy = fixture([[['referral-stats', 'A'], 37]]);
  const newer = readCache(fixture([[['referral-stats', 'A'], 99]]));
  let finish!: (value: PersistedClient) => void;
  let markStarted!: () => void;
  const legacyReadStarted = new Promise<void>(resolve => { markStarted = resolve; });
  jest.mocked(get).mockImplementation(async key => {
    if (keyOf(key) === keyOf(accountReadCacheKey('A'))) return undefined;
    if (keyOf(key) === keyOf(accountQueryCacheKey('A'))) return undefined;
    if (keyOf(key) === keyOf('react-query-cache')) {
      markStarted();
      return new Promise(resolve => { finish = resolve; });
    }
    return clone(rows.get(keyOf(key)));
  });
  const restoring = createAccountQueryPersister('A').restoreClient();
  await legacyReadStarted;
  put(accountReadCacheKey('A'), newer);
  finish(legacy);
  const restored = await restoring;
  expect(restored?.clientState.queries.map(query => query.state.data)).toEqual([99]);
  expect(rows.get(keyOf(accountReadCacheKey('A')))).toEqual(newer);
});

it('does not trust a query key when the cached document explicitly names another owner', async () => {
  const original = fixture([
    [['study-note-share-links', 'A'], [{ id: 'link-B', ownerId: 'B', noteId: 'note-B' }]],
    [['user-settings', 'A'], { id: 'B', enableAudioGeneration: true }],
  ]);
  put('react-query-cache', original);
  const saved = await createAccountQueryPersister('A').restoreClient();
  expect(saved?.clientState.queries).toEqual([]);
  expect(rows.get(keyOf('react-query-cache'))).toEqual(original);
});

it('does not restore an old settings profile into the active cache, and leaves the source intact', async () => {
  const profile = { id: 'A', language: 'en', firstDayOfWeek: 'monday' };
  const original = fixture([[['user-settings', 'A'], profile]]);
  put('react-query-cache', original);
  const saved = await createAccountQueryPersister('A').restoreClient();
  expect(saved?.clientState.queries ?? []).toEqual([]);
  expect(rows.get(keyOf('react-query-cache'))).toEqual(original);
});

it('treats an existing empty owner partition as a completed import', async () => {
  put(accountQueryCacheKey('A'), fixture([]));
  put('react-query-cache', fixture([[['referral-stats', 'A'], 37]]));
  const saved = await createAccountQueryPersister('A').restoreClient();
  expect(saved?.clientState.queries).toEqual([]);
  expect(get).toHaveBeenCalledWith(accountReadCacheKey('A'), queryCacheStore);
  expect(get).toHaveBeenCalledWith(accountQueryCacheKey('A'), queryCacheStore);
  expect(get).not.toHaveBeenCalledWith('react-query-cache', queryCacheStore);
  expect(update).toHaveBeenCalledWith(accountReadCacheKey('A'), expect.any(Function), expect.any(Function));
});


it.each(['global-only', 'owner-partition'] as const)('does not restore Engine-owned settings writers from %s after their canonical archive step', async location => {
  const previous = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'users';
  const client = new QueryClient();
  client.setQueryData(['user-settings', 'A'], { id: 'A', language: 'en' });
  client.getMutationCache().build(client, { mutationKey: ['user-settings', 'audioGeneration'] }, {
    context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null,
    isPaused: true, status: 'pending', variables: { userId: 'A', value: true }, submittedAt: Date.now(),
  });
  const original = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear();
  const source = location === 'global-only' ? 'react-query-cache' : accountQueryCacheKey('A');
  put(source, original);
  try {
    const restored = await createAccountQueryPersister('A').restoreClient();
    expect(restored?.clientState.mutations).toEqual([]);
    expect(restored?.clientState.queries).toEqual([]);
    // The archive's source is not destroyed by a read projection. Its exact payload was
    // archived by the real migration regression in legacyQueryRecovery.client.test.ts.
    expect(rows.get(keyOf(source))).toEqual(original);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previous;
  }
});

it('keeps an unknown paused legacy payload in its source without exposing it as a read-cache command', async () => {
  const client = new QueryClient();
  client.getMutationCache().build(client, { mutationKey: ['unrecognized-legacy', 'save'] }, {
    context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null,
    isPaused: true, status: 'pending', variables: { ownerId: 'A', body: 'Unsent local command' }, submittedAt: Date.now(),
  });
  const original = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear();
  put(accountQueryCacheKey('A'), original);
  const restored = await createAccountQueryPersister('A').restoreClient();
  expect(restored?.clientState.queries).toEqual([]);
  expect(restored?.clientState.mutations).toEqual([]);
  expect(rows.get(keyOf(accountQueryCacheKey('A')))).toEqual(original);
});
