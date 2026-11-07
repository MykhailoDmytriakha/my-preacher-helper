import { QueryClient, dehydrate, useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { get, set, update } from 'idb-keyval';
import React from 'react';

import { QueryProvider } from '@/providers/QueryProvider';
import { createAccountQueryPersister } from '@/utils/accountQueryCache';
import { accountReadCacheKey } from '@/utils/queryPersister';

const mockAuth = { user: { uid: 'B' } as { uid: string } | null, loading: false };
const mockRows = new Map<string, unknown>();
const mockReplay = jest.fn(async (_variables: unknown) => undefined);
const keyOf = (key: IDBValidKey) => JSON.stringify(key);
const copy = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/utils/queryKeys', () => ({
  ...jest.requireActual('@/utils/queryKeys'),
  resolveOwnerUid: () => mockAuth.user?.uid,
}));
jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), update: jest.fn(), del: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({
  DataEngineMigrationGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  queryCacheMayBeOverwritten: () => true,
  shouldPersistLegacyQuery: () => true,
  // Migrated share-link writers stay in the historical source; this mock gate does not archive them.
  shouldPersistLegacyMutation: () => false,
}));
jest.mock('@/utils/mutationDefaults', () => ({
  ...jest.requireActual('@/utils/mutationDefaults'),
  registerOfflineMutationDefaults: (client: QueryClient) => client.setMutationDefaults(
    ['study-note-share-links', 'create'], { mutationFn: (variables: unknown) => mockReplay({ actor: mockAuth.user?.uid, variables }) },
  ),
}));
jest.mock('@/utils/connectivity', () => ({ getConnectivityStatus: () => true, subscribeToConnectivity: () => () => undefined }));
jest.mock('@/components/usage/UsageCapGlobalHandler', () => () => null);
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

function legacyFixture(queued = true) {
  const client = new QueryClient();
  client.setQueryData(['referral-stats', 'A'], 37);
  client.setQueryData(['unknown-old-query'], { text: 'Unassigned original words' });
  if (queued) client.getMutationCache().build(client, { mutationKey: ['study-note-share-links', 'create'] }, {
    context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null,
    isPaused: true, status: 'pending', variables: { userId: 'A', noteId: 'note-A' }, submittedAt: Date.now(),
  });
  const result = { timestamp: Date.now(), buster: '', clientState: dehydrate(client) };
  client.clear();
  return result;
}

let current: QueryClient | undefined;
function Probe() {
  const client = useQueryClient();
  current = client;
  const restoring = useIsRestoring();
  return <p>{restoring ? 'Restoring' : 'Workspace ready'}</p>;
}
const workspace = () => <QueryProvider><Probe /></QueryProvider>;
const ready = () => screen.findByText('Workspace ready');
const persistedQueryData = async (owner: string, key: readonly unknown[]) => (await createAccountQueryPersister(owner).restoreClient())?.clientState.queries.find(query => JSON.stringify(query.queryKey) === JSON.stringify(key))?.state.data;

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.clear();
  current = undefined;
  mockAuth.user = { uid: 'B' };
  mockAuth.loading = false;
  jest.mocked(get).mockImplementation(async key => copy(mockRows.get(keyOf(key))));
  jest.mocked(set).mockImplementation(async (key, value) => { mockRows.set(keyOf(key), copy(value)); });
  jest.mocked(update).mockImplementation(async (key, updater) => { mockRows.set(keyOf(key), copy(updater(copy(mockRows.get(keyOf(key)))))); });
});
afterEach(() => { cleanup(); current?.clear(); });

describe('QueryProvider account ownership', () => {
  it('does not read or publish the device cache before Firebase finishes restoring identity', async () => {
    mockAuth.user = null;
    mockAuth.loading = true;
    mockRows.set(keyOf('react-query-cache'), legacyFixture());
    const view = render(workspace());
    await act(async () => { await Promise.resolve(); });
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
    expect(mockReplay).not.toHaveBeenCalled();
    mockAuth.user = { uid: 'B' };
    mockAuth.loading = false;
    view.rerender(workspace());
    await ready();
    expect(current?.getQueryData(['referral-stats', 'A'])).toBeUndefined();
    expect(mockReplay).not.toHaveBeenCalled();
  });

  it('keeps the migrated share writer raw and inactive across B restore and A reopen', async () => {
    const originalGlobal = legacyFixture();
    const originalOwner = legacyFixture();
    mockRows.set(keyOf('react-query-cache'), copy(originalGlobal));
    mockRows.set(keyOf(['react-query-cache', 'A']), copy(originalOwner));
    const view = render(workspace());
    await ready();
    expect(mockReplay).not.toHaveBeenCalled();
    expect(current?.getQueryData(['referral-stats', 'A'])).toBeUndefined();
    expect(current?.getQueryData(['unknown-old-query'])).toBeUndefined();
    expect(current?.getMutationCache().getAll()).toHaveLength(0);
    expect(mockRows.get(keyOf('react-query-cache'))).toEqual(originalGlobal);
    expect(mockRows.get(keyOf(['react-query-cache', 'A']))).toEqual(originalOwner);
    view.unmount();

    mockAuth.user = { uid: 'A' };
    render(workspace());
    await ready();
    expect(current?.getQueryData(['referral-stats', 'A'])).toBe(37);
    expect(current?.getQueryData(['unknown-old-query'])).toBeUndefined();
    expect(current?.getMutationCache().getAll()).toHaveLength(0);
    expect(mockReplay).not.toHaveBeenCalled();
    expect(mockRows.get(keyOf('react-query-cache'))).toEqual(originalGlobal);
    expect(mockRows.get(keyOf(['react-query-cache', 'A']))).toEqual(originalOwner);
  });

  it('switches the whole in-memory client and restores the newer owner DTO through the public persister', async () => {
    mockRows.set(keyOf('react-query-cache'), legacyFixture(false));
    mockAuth.user = { uid: 'A' };
    const view = render(workspace());
    await ready();
    const a = current!;
    act(() => { a.setQueryData(['referral-stats', 'A'], 99); });
    await waitFor(async () => expect(await persistedQueryData('A', ['referral-stats', 'A'])).toBe(99));
    mockAuth.user = { uid: 'B' };
    view.rerender(workspace());
    await ready();
    expect(current).not.toBe(a);
    expect(current?.getQueryData(['referral-stats', 'A'])).toBeUndefined();
    expect(current?.getMutationCache().getAll()).toHaveLength(0);
    mockAuth.user = { uid: 'A' };
    view.rerender(workspace());
    await ready();
    expect(current?.getQueryData(['referral-stats', 'A'])).toBe(99);
    expect(current?.getQueryData(['unknown-old-query'])).toBeUndefined();
  });

  it('cannot replay A or hydrate the active B client when an old storage read finishes after the switch', async () => {
    const original = legacyFixture();
    mockRows.set(keyOf('react-query-cache'), copy(original));
    let finish!: (value: unknown) => void;
    jest.mocked(get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mockAuth.user = { uid: 'A' };
    const view = render(workspace());
    await waitFor(() => expect(get).toHaveBeenCalled());
    mockAuth.user = { uid: 'B' };
    view.rerender(workspace());
    await act(async () => { finish(copy(original)); });
    await ready();
    expect(current?.getQueryData(['referral-stats', 'A'])).toBeUndefined();
    expect(current?.getMutationCache().getAll()).toHaveLength(0);
    expect(mockReplay).not.toHaveBeenCalled();
    expect(mockRows.get(keyOf('react-query-cache'))).toEqual(original);
  });
});


it('does not open persisted storage after Firebase confirms the visitor is signed out', async () => {
  mockRows.set(keyOf('react-query-cache'), legacyFixture());
  mockAuth.user = null;
  render(workspace());
  await ready();
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(current?.getMutationCache().getAll()).toHaveLength(0);
  expect(mockReplay).not.toHaveBeenCalled();
});

it('keeps the migrated share writer inactive on repeated owner-partition reopen', async () => {
  const originalGlobal = legacyFixture();
  const originalOwner = legacyFixture();
  mockRows.set(keyOf('react-query-cache'), copy(originalGlobal));
  mockRows.set(keyOf(['react-query-cache', 'A']), copy(originalOwner));
  mockAuth.user = { uid: 'A' };
  const first = render(workspace());
  await ready();
  expect(current?.getQueryData(['referral-stats', 'A'])).toBe(37);
  expect(current?.getMutationCache().getAll()).toHaveLength(0);
  expect(mockReplay).not.toHaveBeenCalled();
  first.unmount();

  render(workspace());
  await ready();
  await act(async () => { await Promise.resolve(); });
  expect(current?.getQueryData(['referral-stats', 'A'])).toBe(37);
  expect(current?.getMutationCache().getAll()).toHaveLength(0);
  expect(mockReplay).not.toHaveBeenCalled();
  expect(mockRows.get(keyOf('react-query-cache'))).toEqual(originalGlobal);
  expect(mockRows.get(keyOf(['react-query-cache', 'A']))).toEqual(originalOwner);
});

it('keeps public content rendered without exposing a restored query while identity is unknown', async () => {
  mockAuth.user = null;
  mockAuth.loading = true;
  mockRows.set(keyOf('react-query-cache'), legacyFixture());
  render(<QueryProvider><h1>Public welcome</h1><Probe /></QueryProvider>);
  expect(screen.getByRole('heading', { name: 'Public welcome' })).toBeInTheDocument();
  expect(screen.getByText('Restoring')).toBeInTheDocument();
  await act(async () => { await Promise.resolve(); });
  expect(get).not.toHaveBeenCalled();
  expect(current?.getQueryData(['referral-stats', 'A'])).toBeUndefined();
});


it('persists a newer live answer after late disk restoration, without another query update', async () => {
  const queryKey = ['referral-stats', 'B'];
  const old = { readVersion: '1794036480:500000001', value: 0 };
  const live = { readVersion: '1794036480:500000002', value: 1 };
  const initial = new QueryClient();
  initial.setQueryData(queryKey, old, { updatedAt: 300 });
  const seed = createAccountQueryPersister('B');
  await seed.restoreClient();
  await seed.persistClient({ timestamp: Date.now(), buster: '', clientState: dehydrate(initial) });
  initial.clear();
  const stored = mockRows.get(keyOf(accountReadCacheKey('B')));

  let finish!: (value: unknown) => void;
  jest.mocked(get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  jest.useFakeTimers();
  try {
    const view = render(workspace());
    await act(async () => { await jest.advanceTimersByTimeAsync(3001); });
    expect(screen.getByText('Workspace ready')).toBeVisible();
    await act(async () => { current!.setQueryData(queryKey, live, { updatedAt: 200 }); });
    expect(mockRows.get(keyOf(accountReadCacheKey('B')))).toEqual(stored);

    await act(async () => { finish(stored); await jest.advanceTimersByTimeAsync(0); });
    expect(current!.getQueryData(queryKey)).toEqual(live);
    view.unmount();
    expect(await persistedQueryData('B', queryKey)).toEqual(live);
  } finally {
    jest.useRealTimers();
  }
});
