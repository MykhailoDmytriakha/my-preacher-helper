import { QueryClient, dehydrate, useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { get, set, update } from 'idb-keyval';
import React from 'react';

import { QueryProvider } from '@/providers/QueryProvider';

const mockAuth = { user: { uid: 'A' } as { uid: string } | null, loading: false };
const mockRows = new Map<string, unknown>();
const mockArchiveRows = new Map<string, unknown>();
const mockDeliveries = jest.fn((_request: unknown) => Promise.resolve());
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const copy = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/utils/accountQueryCache', () => {
  const actual = jest.requireActual<typeof import('@/utils/accountQueryCache')>('@/utils/accountQueryCache');
  const persister = jest.requireActual<typeof import('@/utils/queryPersister')>('@/utils/queryPersister');
  return {
    ...actual,
    // Test-only: this synthetic prayerCategories intent exercises the generic serializer and owner fence.
    // Production's read-only account adapter intentionally does not accept this mutation snapshot.
    createAccountQueryPersister: (owner: string | undefined, options?: Parameters<typeof actual.createAccountQueryPersister>[1]) => owner
      ? persister.createIDBPersister(actual.accountQueryCacheKey(owner), options)
      : actual.createAccountQueryPersister(owner, options),
  };
});
jest.mock('@/data-engine/storage.client', () => ({
  ...jest.requireActual('@/data-engine/storage.client'),
  createEngineStorageTransaction: () => async (_mode: IDBTransactionMode, action: (store: IDBObjectStore, read: (request: IDBRequest, success: (value: unknown) => void) => void, done: (value: unknown) => void) => void) => {
    const store = {
      get: (key: IDBValidKey) => ({ result: mockArchiveRows.get(JSON.stringify(key)) }),
      put: (value: unknown, key: IDBValidKey) => mockArchiveRows.set(JSON.stringify(key), value === undefined ? value : JSON.parse(JSON.stringify(value))),
      delete: (key: IDBValidKey) => mockArchiveRows.delete(JSON.stringify(key)),
      getAll: () => ({ result: [...mockArchiveRows.values()] }),
    };
    return new Promise(resolve => {
      const read = (request: { result?: unknown }, success: (value: unknown) => void) => {
        queueMicrotask(() => success(request.result));
      };
      action(store as unknown as IDBObjectStore, read as never, resolve);
    });
  },
}));
jest.mock('@locales/i18n', () => ({
  i18n: {
    language: 'en',
    hasResourceBundle: () => true,
    t: (key: string) => key,
  },
}));
jest.mock('@/utils/queryKeys', () => ({
  ...jest.requireActual('@/utils/queryKeys'),
  resolveOwnerUid: () => mockAuth.user?.uid,
}));
jest.mock('idb-keyval', () => ({ ...jest.requireActual('idb-keyval'), get: jest.fn(), set: jest.fn(), update: jest.fn(), del: jest.fn() }));
jest.mock('@/utils/mutationDefaults', () => {
  const actual = jest.requireActual('@/utils/mutationDefaults');
  return {
    ...actual,
    registerOfflineMutationDefaults: (client: QueryClient) => {
      client.setMutationDefaults(actual.SHARE_LINK_MUTATION_KEYS.delete,
        { mutationFn: (variables: unknown) => mockDeliveries({ actor: mockAuth.user?.uid, variables }) });
      // This generic account-departure test uses a synthetic mutation on the optional,
      // still-legacy prayerCategories collection. Settings/share-link intents are archived.
      client.setMutationDefaults(['prayerCategories', 'update'],
        { mutationFn: (variables: unknown) => mockDeliveries({ actor: mockAuth.user?.uid, variables }) });
    },
  };
});

let currentClient: QueryClient | undefined;
function Probe() {
  currentClient = useQueryClient();
  const restoring = useIsRestoring();
  return <p>{restoring ? 'Restoring' : `Ready:${mockAuth.user?.uid ?? 'signed-out'}`}</p>;
}
const workspace = () => <QueryProvider><Probe /></QueryProvider>;
const ready = (owner: string) => screen.findByText(`Ready:${owner}`);

function pausedLegacyCategoryFixture() {
  const client = new QueryClient();
  client.getMutationCache().build(client, { mutationKey: ['prayerCategories', 'update'] }, {
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    isPaused: true,
    status: 'pending',
    variables: { userId: 'A', id: 'category-A' },
    submittedAt: Date.now(),
  });
  const saved = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear();
  return saved;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.clear();
  mockArchiveRows.clear();
  currentClient = undefined;
  mockAuth.user = { uid: 'A' };
  mockAuth.loading = false;
  jest.mocked(get).mockImplementation(async key => copy(mockRows.get(keyOf(key))));
  jest.mocked(set).mockImplementation(async (key, value) => { mockRows.set(keyOf(key), copy(value)); });
  jest.mocked(update).mockImplementation(async (key, updater) => {
    const next = updater(copy(mockRows.get(keyOf(key))));
    mockRows.set(keyOf(key), copy(next));
  });
});
afterEach(() => { cleanup(); currentClient?.clear(); });

test('retains A delivery as a manual-retry error when its request fails after switching to B', async () => {
  const variables = { userId: 'A', id: 'category-A' };
  const aKey: IDBValidKey = ['react-query-cache', 'A'];
  mockRows.set(keyOf(aKey), pausedLegacyCategoryFixture());

  let rejectDelivery!: (error: Error) => void;
  mockDeliveries.mockImplementationOnce(request => {
    expect(request).toEqual({ actor: 'A', variables });
    return new Promise((_resolve, reject) => { rejectDelivery = reject; });
  });

  const view = render(workspace());
  await ready('A');
  await waitFor(() => expect(mockDeliveries).toHaveBeenCalledTimes(1));
  const firstAClient = currentClient!;
  const firstMutation = firstAClient.getMutationCache().getAll()[0];
  expect(firstMutation.state.status).toBe('pending');

  mockAuth.user = { uid: 'B' };
  view.rerender(workspace());
  await ready('B');
  const bClient = currentClient!;
  expect(bClient.getMutationCache().getAll().some(mutation => (mutation.state.variables as { userId?: string } | undefined)?.userId === 'A')).toBe(false);

  await act(async () => {
    rejectDelivery(Object.assign(new Error('Account changed during delivery'), { code: 'unauthenticated' }));
  });
  await waitFor(() => expect(firstMutation.state.status).toBe('error'));

  mockAuth.user = { uid: 'A' };
  view.rerender(workspace());
  await ready('A');
  const restoredA = currentClient!.getMutationCache().getAll();
  expect(restoredA).toHaveLength(1);
  expect(restoredA[0].options.mutationKey).toEqual(['prayerCategories', 'update']);
  expect(restoredA[0].state.variables).toEqual(variables);
  expect(restoredA[0].state.status).toBe('error');
  // A detached session may only know that delivery was unconfirmed, not its eventual cause.
  expect(restoredA[0].state.error).toBeInstanceOf(Error);
  expect(restoredA[0].state.isPaused).toBe(false);
  expect(mockDeliveries).toHaveBeenCalledTimes(1);
  expect(mockDeliveries).toHaveBeenCalledWith({ actor: 'A', variables });
  expect(bClient.getMutationCache().getAll()).toHaveLength(0);
});
