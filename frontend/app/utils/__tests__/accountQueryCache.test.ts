import { QueryClient, dehydrate } from '@tanstack/react-query';
import { get, set, update } from 'idb-keyval';

import { accountQueryCacheKey, createAccountQueryPersister } from '@/utils/accountQueryCache';

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

it('keeps a newer owner partition created while its historical global fallback was being read', async () => {
  const legacy = fixture([[['referral-stats', 'A'], 37]]);
  const newer = fixture([[['referral-stats', 'A'], 99]]);
  let finish!: (value: PersistedClient) => void;
  jest.mocked(get).mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const restoring = createAccountQueryPersister('A').restoreClient();
  await Promise.resolve();
  put(accountQueryCacheKey('A'), newer);
  finish(legacy);
  expect(await restoring).toEqual(newer);
  expect(rows.get(keyOf(accountQueryCacheKey('A')))).toEqual(newer);
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
  expect(get).toHaveBeenCalledTimes(1);
  expect(update).not.toHaveBeenCalled();
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
