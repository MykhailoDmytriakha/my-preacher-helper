import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { Series, Sermon } from '@/models/models';
import {
  addGroupToSeries,
  addSermonToSeries,
  getSeriesById,
  removeSeriesItem,
  reorderSeriesItems,
  updateSeries,
} from '@/services/series.service';
import { getGroupById } from '@/services/groups.service';
import { getSermonById } from '@/services/sermon.service';

import type { ReactNode } from 'react';

jest.mock('@/services/series.service', () => ({
  getSeriesById: jest.fn(),
  addSermonToSeries: jest.fn(),
  addGroupToSeries: jest.fn(),
  removeSeriesItem: jest.fn(),
  reorderSeriesItems: jest.fn(),
  updateSeries: jest.fn(),
}));

jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

jest.mock('@/services/groups.service', () => ({
  getGroupById: jest.fn(),
}));

const mockGetSeriesById = getSeriesById as jest.MockedFunction<typeof getSeriesById>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const mockGetGroupById = getGroupById as jest.MockedFunction<typeof getGroupById>;
const mockAddSermonToSeries = addSermonToSeries as jest.MockedFunction<typeof addSermonToSeries>;
const mockAddGroupToSeries = addGroupToSeries as jest.MockedFunction<typeof addGroupToSeries>;
const mockRemoveSeriesItem = removeSeriesItem as jest.MockedFunction<typeof removeSeriesItem>;
const mockReorderSeriesItems = reorderSeriesItems as jest.MockedFunction<typeof reorderSeriesItems>;
const mockUpdateSeries = updateSeries as jest.MockedFunction<typeof updateSeries>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

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
      seriesPosition: 1,
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
      seriesPosition: 2,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSeriesById.mockResolvedValue(mockSeries);
    mockGetSermonById.mockImplementation((id) =>
      Promise.resolve(mockSermons.find((sermon) => sermon.id === id))
    );
    mockGetGroupById.mockResolvedValue(undefined);
    mockAddSermonToSeries.mockResolvedValue(undefined);
    mockAddGroupToSeries.mockResolvedValue(undefined);
    mockRemoveSeriesItem.mockResolvedValue(undefined);
    mockReorderSeriesItems.mockResolvedValue(undefined);
    mockUpdateSeries.mockResolvedValue(mockSeries);
  });

  it('fetches series detail payload on mount', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetSeriesById).toHaveBeenCalledWith('series-1');
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1');
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-2');
    expect(result.current.series).toMatchObject(mockSeries);
    expect(result.current.sermons).toEqual(mockSermons);
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

  it('adds one sermon into series', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addSermon('new-sermon-id', 2);
    });

    expect(mockAddSermonToSeries).toHaveBeenCalledWith('series-1', 'new-sermon-id', 2);
  });

  it('adds multiple sermons into series', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addSermons(['new-sermon-1', 'new-sermon-2']);
    });

    expect(mockAddSermonToSeries).toHaveBeenCalledTimes(2);
    expect(mockAddSermonToSeries).toHaveBeenNthCalledWith(1, 'series-1', 'new-sermon-1', 2);
    expect(mockAddSermonToSeries).toHaveBeenNthCalledWith(2, 'series-1', 'new-sermon-2', 3);
  });

  it('removes sermon via generic series-item API', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeSermon('sermon-1');
    });

    expect(mockRemoveSeriesItem).toHaveBeenCalledWith('series-1', 'sermon', 'sermon-1');
  });

  it('reorders sermons through mixed-item reorder endpoint', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reorderSeriesSermons(['sermon-2', 'sermon-1']);
    });

    expect(mockReorderSeriesItems).toHaveBeenCalledWith('series-1', expect.any(Array));
    const calledIds = mockReorderSeriesItems.mock.calls[0][1];
    expect(calledIds).toHaveLength(2);
  });

  it('updates series metadata', async () => {
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
