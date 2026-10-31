import { QueryClient, dehydrate, useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { get, set, update } from 'idb-keyval';
import React from 'react';

import { QueryProvider } from '@/providers/QueryProvider';

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
  shouldPersistLegacyMutation: () => true,
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

  it('keeps the old A queue and unknown originals untouched while B restores, then resumes A only as A', async () => {
    const original = legacyFixture();
    mockRows.set(keyOf('react-query-cache'), copy(original));
    const view = render(workspace());
    await ready();
    expect(mockReplay).not.toHaveBeenCalled();
    expect(current?.getQueryData(['referral-stats', 'A'])).toBeUndefined();
    expect(current?.getQueryData(['unknown-old-query'])).toBeUndefined();
    expect(current?.getMutationCache().getAll()).toHaveLength(0);
    expect(mockRows.get(keyOf('react-query-cache'))).toEqual(original);
    view.unmount();
    mockAuth.user = { uid: 'A' };
    render(workspace());
    await ready();
    await waitFor(() => expect(mockReplay).toHaveBeenCalledWith({ actor: 'A', variables: { userId: 'A', noteId: 'note-A' } }));
    expect(mockReplay).toHaveBeenCalledTimes(1);
    expect(current?.getQueryData(['referral-stats', 'A'])).toBe(37);
    expect(current?.getQueryData(['unknown-old-query'])).toBeUndefined();
    expect(mockRows.get(keyOf('react-query-cache'))).toEqual(original);
  });

  it('switches the whole in-memory client and restores the owner newer saved value on returning', async () => {
    mockRows.set(keyOf('react-query-cache'), legacyFixture(false));
    mockAuth.user = { uid: 'A' };
    const view = render(workspace());
    await ready();
    const a = current!;
    act(() => { a.setQueryData(['referral-stats', 'A'], 99); });
    await waitFor(() => expect(set).toHaveBeenCalled());
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

it('does not re-import the old paused action after its owner has resumed and acknowledged it', async () => {
  const original = legacyFixture();
  mockRows.set(keyOf('react-query-cache'), copy(original));
  mockAuth.user = { uid: 'A' };
  const first = render(workspace());
  await ready();
  await waitFor(() => expect(mockReplay).toHaveBeenCalledTimes(1));
  await waitFor(() => {
    const saved = mockRows.get(keyOf(['react-query-cache', 'A'])) as { clientState: { mutations: unknown[] } };
    expect(saved.clientState.mutations).toHaveLength(0);
  });
  first.unmount();
  render(workspace());
  await ready();
  await act(async () => { await Promise.resolve(); });
  expect(mockReplay).toHaveBeenCalledTimes(1);
  expect(current?.getQueryData(['referral-stats', 'A'])).toBe(37);
  expect(mockRows.get(keyOf('react-query-cache'))).toEqual(original);
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
