import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { getDocs } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { useDataCollection } from '@/data-engine/react.client';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';
import { apiClient } from '@/utils/apiClient';

jest.mock('@/data-engine/react.client', () => ({
  useDataCollection: jest.fn(),
  isLiveCollectionDocument: jest.requireActual('@/data-engine/react.client').isLiveCollectionDocument,
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => false }));
// The old series list read the SDK (`getDocs`) and the server (`apiClient` -> `fetch`); the engine is
// mocked here, so any of the three being called is a legacy read.
jest.mock('@/utils/apiClient', () => ({ ...jest.requireActual('@/utils/apiClient'), apiClient: jest.fn() }));
const row = (title: string) => ({ resource: { collection: 'series', id: 's' }, value: { userId: 'owner', title, sermonIds: ['sermon'] }, metadata: null });
function setup() {
  const refresh = jest.fn(async () => undefined);
  const state = { snapshots: [row('Confirmed title')], documents: [{ ...row('Queued title'), pending: true }], complete: true, freshness: 'cache', checking: false, version: 1, error: null };
  jest.mocked(useDataCollection).mockReturnValue({ state, refresh, loading: false, error: null } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { refresh, state, client, wrapper };
}
const previousCollections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series'; });
afterAll(() => {
  if (previousCollections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previousCollections;
});
it('uses the public collection overlay and refresh even offline, with no legacy reads', async () => {
  const t = setup(), { result } = renderHook(() => useSeries('owner'), { wrapper: t.wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.series[0]).toMatchObject({ title: 'Queued title', items: [{ type: 'sermon', refId: 'sermon' }] });
  await act(async () => { await result.current.refreshSeries(); }); expect(t.refresh).toHaveBeenCalledTimes(1);
  expect(t.client.getMutationCache().getAll()).toHaveLength(0);
  expect(getDocs).not.toHaveBeenCalled();
  expect(apiClient).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  t.client.clear();
});
it('does not expose another owner and respects an empty overlay over stale cached snapshots', () => {
  const t = setup(), { result, rerender } = renderHook(({ owner }) => useSeriesDataCollection(true, owner), { initialProps: { owner: 'other' } });
  expect(result.current.series).toEqual([]);
  rerender({ owner: 'owner' }); expect(result.current.series[0].title).toBe('Queued title');
  jest.mocked(useDataCollection).mockReturnValue({ state: { ...t.state, documents: [] }, refresh: t.refresh, loading: false, error: null } as never);
  rerender({ owner: 'owner' }); expect(result.current.series).toEqual([]);
  t.client.clear();
});
