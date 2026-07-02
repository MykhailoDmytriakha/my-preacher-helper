import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Series, Sermon } from '@/models/models';
import { getGroupById } from '@/services/groups.service';
import { commitSeriesBatch, type SeriesTransform } from '@/services/seriesMembership.client';
import { getSeriesById, updateSeries } from '@/services/series.service';
import { getSermonById } from '@/services/sermon.service';

import type { ReactNode } from 'react';

// series.service no longer owns membership — add/remove/reorder go through the
// client playlist sweep (commitSeriesBatch). We mock the sweep commit and assert
// the SERIALIZABLE transforms it is fired with, keeping the pure transform logic
// (applySeriesTransform) real so optimistic cache math still runs.
jest.mock('@/services/series.service', () => ({
  getSeriesById: jest.fn(),
  updateSeries: jest.fn(),
}));

jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

jest.mock('@/services/groups.service', () => ({
  getGroupById: jest.fn(),
}));

jest.mock('@/services/seriesMembership.client', () => ({
  ...jest.requireActual('@/services/seriesMembership.client'),
  commitSeriesBatch: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'user-1', isAuthLoading: false }),
}));

// useServerFirstQuery consults useOnlineStatus and DISABLES the query offline.
jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(() => true),
}));

const mockGetSeriesById = getSeriesById as jest.MockedFunction<typeof getSeriesById>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const mockGetGroupById = getGroupById as jest.MockedFunction<typeof getGroupById>;
const mockUpdateSeries = updateSeries as jest.MockedFunction<typeof updateSeries>;
const mockCommitSeriesBatch = commitSeriesBatch as jest.MockedFunction<typeof commitSeriesBatch>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;

const lastTransforms = (): SeriesTransform[] =>
  mockCommitSeriesBatch.mock.calls[mockCommitSeriesBatch.mock.calls.length - 1][0];

describe('useSeriesDetail', () => {
  const mockSeries: Series = {
    id: 'series-1',
    userId: 'user-1',
    title: 'Test Series',
    theme: 'Test Theme',
    description: 'Test Description',
    bookOrTopic: 'Test Book',
    sermonIds: ['sermon-1', 'sermon-2'],
    status: 'active',
    color: '#FF0000',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockSermons: Sermon[] = [
    {
      id: 'sermon-1',
      title: 'Sermon 1',
      verse: 'John 3:16',
      date: '2024-01-01',
      userId: 'user-1',
      thoughts: [],
      outline: { introduction: [], main: [], conclusion: [] },
      isPreached: false,
    },
    {
      id: 'sermon-2',
      title: 'Sermon 2',
      verse: 'Romans 8:28',
      date: '2024-01-08',
      userId: 'user-1',
      thoughts: [],
      outline: { introduction: [], main: [], conclusion: [] },
      isPreached: false,
    },
  ];

  // Seed the ['series', uid] + ['sermons', uid] caches the sweep reads for
  // discovery/optimism (mirrors the series detail page, which mounts useSeries).
  const createWrapper = () => {
    const queryClient = new QueryClient({
      // gcTime must survive: the ['series', uid] discovery cache has no observer
      // in this isolated hook test, so gcTime:0 would evict it before a sweep reads it.
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
    });
    queryClient.setQueryData(['series', 'user-1'], [mockSeries]);
    queryClient.setQueryData(['sermons', 'user-1'], mockSermons);

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSeriesById.mockResolvedValue(mockSeries);
    mockGetSermonById.mockImplementation((id) =>
      Promise.resolve(mockSermons.find((sermon) => sermon.id === id))
    );
    mockGetGroupById.mockResolvedValue(undefined);
    mockUpdateSeries.mockResolvedValue(mockSeries);
    mockCommitSeriesBatch.mockResolvedValue(undefined);
    mockUseOnlineStatus.mockReturnValue(true);
  });

  it('does NOT fetch while offline (useServerFirstQuery disables the query)', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

    // Offline: the read query is disabled, so the server fetch never runs and the
    // detail payload stays empty (the sweep relies on optimism + Firestore's queue).
    await Promise.resolve();
    expect(mockGetSeriesById).not.toHaveBeenCalled();
    expect(result.current.series).toBeNull();
  });

  it('fetches series detail payload on mount', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetSeriesById).toHaveBeenCalledWith('series-1');
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1');
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-2');
    expect(result.current.series).toMatchObject({ id: 'series-1', title: 'Test Series' });
    expect(result.current.sermons).toHaveLength(2);
    expect(result.current.items).toHaveLength(2);
  });

  it('does not fetch when seriesId is empty', async () => {
    const { result } = renderHook(() => useSeriesDetail(''), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(false);
    expect(mockGetSeriesById).not.toHaveBeenCalled();
    expect(result.current.series).toBeNull();
  });

  it('returns error when series is missing', async () => {
    mockGetSeriesById.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSeriesDetail('missing-series'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('Series not found');
  });

  it('adds one sermon into series via the client sweep', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addSermon('new-sermon-id', 2);
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    const transforms = lastTransforms();
    expect(transforms).toEqual([
      { seriesId: 'series-1', op: 'add', refs: [{ type: 'sermon', refId: 'new-sermon-id' }], position: 2 },
    ]);
  });

  it('adds multiple sermons in ONE union-sweep batch (no lost adds)', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addSermons(['new-sermon-1', 'new-sermon-2']);
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    // Exactly ONE batch, and the target 'add' carries BOTH refs (never 2 parallel sweeps).
    expect(mockCommitSeriesBatch).toHaveBeenCalledTimes(1);
    const transforms = lastTransforms();
    const addTransform = transforms.find((t) => t.op === 'add');
    expect(addTransform).toBeDefined();
    expect(addTransform && 'refs' in addTransform ? addTransform.refs : []).toEqual([
      { type: 'sermon', refId: 'new-sermon-1' },
      { type: 'sermon', refId: 'new-sermon-2' },
    ]);
  });

  it('removes a sermon via a sweep-all remove transform', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.removeSermon('sermon-1');
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    const transforms = lastTransforms();
    expect(transforms).toContainEqual({
      seriesId: 'series-1',
      op: 'remove',
      refs: [{ type: 'sermon', refId: 'sermon-1' }],
    });
  });

  it('reorders sermons via a single-doc reorder transform', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.reorderSeriesSermons(['sermon-2', 'sermon-1']);
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    const transforms = lastTransforms();
    expect(transforms).toHaveLength(1);
    expect(transforms[0].op).toBe('reorder');
    expect(transforms[0].seriesId).toBe('series-1');
    expect(transforms[0].op === 'reorder' ? transforms[0].itemIds : []).toHaveLength(2);
  });

  it('updates series metadata through the own-doc client update', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateSeriesDetail({ title: 'Updated title' });
    });

    expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', { title: 'Updated title' });
  });

  it('refreshes data on demand', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refreshSeriesDetail();
    });

    expect(mockGetSeriesById).toHaveBeenCalledTimes(2);
  });
});
