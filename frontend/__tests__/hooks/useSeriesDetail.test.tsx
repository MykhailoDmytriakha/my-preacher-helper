import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { getSeriesById, addSermonToSeries, removeSermonFromSeries, reorderSermons, updateSeries } from '@/services/series.service';
import { getSermonById } from '@/services/sermon.service';
import { Series, Sermon } from '@/models/models';

// Mock the services
jest.mock('@/services/series.service', () => ({
  getSeriesById: jest.fn(),
  addSermonToSeries: jest.fn(),
  removeSermonFromSeries: jest.fn(),
  reorderSermons: jest.fn(),
  updateSeries: jest.fn(),
}));

jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

const mockGetSeriesById = getSeriesById as jest.MockedFunction<typeof getSeriesById>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const mockAddSermonToSeries = addSermonToSeries as jest.MockedFunction<typeof addSermonToSeries>;
const mockRemoveSermonFromSeries = removeSermonFromSeries as jest.MockedFunction<typeof removeSermonFromSeries>;
const mockReorderSermons = reorderSermons as jest.MockedFunction<typeof reorderSermons>;
const mockUpdateSeries = updateSeries as jest.MockedFunction<typeof updateSeries>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0, staleTime: 0 } },
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
      outline: {},
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
      outline: {},
      isPreached: false,
      seriesPosition: 2,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSeriesById.mockResolvedValue(mockSeries);
    mockGetSermonById.mockImplementation((id) =>
      Promise.resolve(mockSermons.find(s => s.id === id))
    );
  });

  describe('Initial state and data fetching', () => {
    it('should initialize with loading state and empty data', () => {
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      expect(result.current.loading).toBe(true);
      expect(result.current.series).toBeNull();
      expect(result.current.sermons).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should fetch series and sermons data on mount', async () => {
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetSeriesById).toHaveBeenCalledWith('series-1');
      expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1');
      expect(mockGetSermonById).toHaveBeenCalledWith('sermon-2');
      expect(result.current.series).toEqual(mockSeries);
      expect(result.current.sermons).toEqual(mockSermons); // sorted by seriesPosition
      expect(result.current.error).toBeNull();
    });

    it('should not fetch data when seriesId is empty', () => {
      const { result } = renderHook(() => useSeriesDetail(''), { wrapper: createWrapper() });

      expect(result.current.loading).toBe(false);
      expect(result.current.series).toBeNull();
      expect(result.current.sermons).toEqual([]);
      expect(mockGetSeriesById).not.toHaveBeenCalled();
    });

    it('should handle series not found error', async () => {
      mockGetSeriesById.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('non-existent'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.series).toBeNull();
      expect(result.current.sermons).toEqual([]);
      expect(result.current.error?.message).toBe('Series not found');
    });

    it('should handle fetch error gracefully', async () => {
      const error = new Error('Fetch failed');
      mockGetSeriesById.mockRejectedValue(error);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.series).toBeNull();
      expect(result.current.sermons).toEqual([]);
      expect(result.current.error).toEqual(error);
    });

    it('should filter out undefined sermons and sort by seriesPosition', async () => {
      mockGetSermonById.mockImplementation((id) => {
        if (id === 'sermon-1') return Promise.resolve(mockSermons[0]);
        if (id === 'sermon-2') return Promise.resolve(mockSermons[1]);
        return Promise.resolve(undefined); // sermon-3 doesn't exist
      });

      const seriesWithInvalidSermon = { ...mockSeries, sermonIds: ['sermon-1', 'sermon-2', 'sermon-3'] };

      mockGetSeriesById.mockResolvedValue(seriesWithInvalidSermon);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sermons).toEqual(mockSermons); // undefined sermon filtered out
    });
  });

  describe('addSermon', () => {
    it('should add sermon to series and refresh data', async () => {
      mockAddSermonToSeries.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addSermon('new-sermon-id', 3);
      });

      expect(mockAddSermonToSeries).toHaveBeenCalledWith('series-1', 'new-sermon-id', 3);
      expect(mockGetSeriesById).toHaveBeenCalledTimes(2); // initial + refresh
    });

    it('should handle add sermon error', async () => {
      const error = new Error('Add sermon failed');
      mockAddSermonToSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.addSermon('new-sermon-id')).rejects.toThrow('Add sermon failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });

    it('should do nothing if no series is loaded', async () => {
      mockGetSeriesById.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('non-existent'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addSermon('new-sermon-id');
      });

      expect(mockAddSermonToSeries).not.toHaveBeenCalled();
    });
  });

  describe('addSermons', () => {
    it('should add multiple sermons with optimistic updates', async () => {
      const newSermonIds = ['new-sermon-1', 'new-sermon-2'];
      const newSermons = [
        {
          id: 'new-sermon-1',
          title: 'New Sermon 1',
          verse: 'Matthew 5:1',
          date: '2024-01-15',
          userId: 'user-1',
          thoughts: [],
          outline: {},
          isPreached: false,
          seriesId: 'series-1',
          seriesPosition: 3,
        },
        {
          id: 'new-sermon-2',
          title: 'New Sermon 2',
          verse: 'Luke 6:20',
          date: '2024-01-22',
          userId: 'user-1',
          thoughts: [],
          outline: {},
          isPreached: false,
          seriesId: 'series-1',
          seriesPosition: 4,
        },
      ];

      mockGetSermonById.mockImplementation((id) => {
        const newSermon = newSermons.find(s => s.id === id);
        if (newSermon) return Promise.resolve(newSermon);
        return Promise.resolve(mockSermons.find(s => s.id === id));
      });

      mockAddSermonToSeries.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addSermons(newSermonIds);
      });

      expect(result.current.sermons).toEqual([...mockSermons, ...newSermons]);
      expect(mockAddSermonToSeries).toHaveBeenCalledTimes(2);
    });

    it('should rollback optimistic updates on error', async () => {
      const error = new Error('Add sermons failed');
      mockAddSermonToSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialSermons = [...result.current.sermons];

      await expect(result.current.addSermons(['new-sermon-id'])).rejects.toThrow('Add sermons failed');

      expect(result.current.sermons).toEqual(initialSermons); // rolled back

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('removeSermon', () => {
    it('should remove sermon with optimistic updates', async () => {
      mockRemoveSermonFromSeries.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.removeSermon('sermon-1');
      });

      expect(result.current.sermons).toEqual([mockSermons[1]]); // sermon-1 removed
      expect(mockRemoveSermonFromSeries).toHaveBeenCalledWith('series-1', 'sermon-1');
    });

    it('should rollback optimistic updates on error', async () => {
      const error = new Error('Remove sermon failed');
      mockRemoveSermonFromSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialSermons = [...result.current.sermons];

      await expect(result.current.removeSermon('sermon-1')).rejects.toThrow('Remove sermon failed');

      expect(result.current.sermons).toEqual(initialSermons); // rolled back

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('reorderSeriesSermons', () => {
    it('should reorder sermons with optimistic updates', async () => {
      const newOrder = ['sermon-2', 'sermon-1'];
      mockReorderSermons.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.reorderSeriesSermons(newOrder);
      });

      // Check that sermons are reordered with updated positions
      expect(result.current.sermons[0].id).toBe('sermon-2');
      expect(result.current.sermons[0].seriesPosition).toBe(1);
      expect(result.current.sermons[1].id).toBe('sermon-1');
      expect(result.current.sermons[1].seriesPosition).toBe(2);

      expect(mockReorderSermons).toHaveBeenCalledWith('series-1', newOrder);
    });

    it('should rollback optimistic updates on reorder error', async () => {
      const error = new Error('Reorder failed');
      mockReorderSermons.mockRejectedValue(error);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialSermons = [...result.current.sermons];
      const newOrder = ['sermon-2', 'sermon-1'];

      await expect(result.current.reorderSeriesSermons(newOrder)).rejects.toThrow('Reorder failed');

      expect(result.current.sermons).toEqual(initialSermons); // rolled back

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });

    it('should throw error if sermon in order is not found', async () => {
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.reorderSeriesSermons(['non-existent-sermon'])).rejects.toThrow('Sermon with id non-existent-sermon not found');
    });
  });

  describe('updateSeriesDetail', () => {
    it('should update series and refresh data', async () => {
      const updates = { title: 'Updated Title', theme: 'Updated Theme' };
      const updatedSeries = { ...mockSeries, ...updates };
      mockUpdateSeries.mockResolvedValue(updatedSeries);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateSeriesDetail(updates);
      });

      expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', updates);
      expect(mockGetSeriesById).toHaveBeenCalledTimes(2); // initial + refresh
    });

    it('should handle update error', async () => {
      const error = new Error('Update failed');
      mockUpdateSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.updateSeriesDetail({ title: 'Updated' })).rejects.toThrow('Update failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });

    it('should do nothing if no series is loaded', async () => {
      mockGetSeriesById.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeriesDetail('non-existent'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateSeriesDetail({ title: 'Updated' });
      });

      expect(mockUpdateSeries).not.toHaveBeenCalled();
    });
  });

  describe('refreshSeriesDetail', () => {
    it('should refresh all series detail data', async () => {
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.refreshSeriesDetail();
      });

      expect(mockGetSeriesById).toHaveBeenCalledTimes(2); // initial + refresh
      expect(mockGetSermonById).toHaveBeenCalledTimes(4); // initial (2) + refresh (2)
    });
  });
});
