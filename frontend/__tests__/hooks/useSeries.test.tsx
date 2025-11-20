import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSeries } from '@/hooks/useSeries';
import {
  getAllSeries,
  createSeries,
  updateSeries,
  deleteSeries,
  addSermonToSeries,
  removeSermonFromSeries,
  reorderSermons
} from '@/services/series.service';
import { Series } from '@/models/models';

// Mock the services
jest.mock('@/services/series.service', () => ({
  getAllSeries: jest.fn(),
  createSeries: jest.fn(),
  updateSeries: jest.fn(),
  deleteSeries: jest.fn(),
  addSermonToSeries: jest.fn(),
  removeSermonFromSeries: jest.fn(),
  reorderSermons: jest.fn(),
}));

const mockGetAllSeries = getAllSeries as jest.MockedFunction<typeof getAllSeries>;
const mockCreateSeries = createSeries as jest.MockedFunction<typeof createSeries>;
const mockUpdateSeries = updateSeries as jest.MockedFunction<typeof updateSeries>;
const mockDeleteSeries = deleteSeries as jest.MockedFunction<typeof deleteSeries>;
const mockAddSermonToSeries = addSermonToSeries as jest.MockedFunction<typeof addSermonToSeries>;
const mockRemoveSermonFromSeries = removeSermonFromSeries as jest.MockedFunction<typeof removeSermonFromSeries>;
const mockReorderSermons = reorderSermons as jest.MockedFunction<typeof reorderSermons>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, cacheTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useSeries', () => {
  const mockSeries: Series[] = [
    {
      id: 'series-1',
      userId: 'user-1',
      title: 'Test Series 1',
      theme: 'Test Theme 1',
      description: 'Description 1',
      bookOrTopic: 'Book 1',
      sermonIds: ['sermon-1'],
      status: 'active',
      color: '#FF0000',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'series-2',
      userId: 'user-1',
      title: 'Test Series 2',
      theme: 'Test Theme 2',
      description: 'Description 2',
      bookOrTopic: 'Book 2',
      sermonIds: ['sermon-2', 'sermon-3'],
      status: 'draft',
      color: '#00FF00',
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllSeries.mockResolvedValue(mockSeries);
  });

  describe('Initial state and data fetching', () => {
    it('should initialize with loading state and empty series', () => {
      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      expect(result.current.loading).toBe(true);
      expect(result.current.series).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should fetch series on mount when userId is provided', async () => {
      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetAllSeries).toHaveBeenCalledWith('user-1');
      expect(result.current.series).toEqual(mockSeries);
      expect(result.current.error).toBeNull();
    });

    it('should not fetch series when userId is null', () => {
      const { result } = renderHook(() => useSeries(null), { wrapper: createWrapper() });

      expect(result.current.loading).toBe(false);
      expect(result.current.series).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(mockGetAllSeries).not.toHaveBeenCalled();
    });

    it('should handle fetch error gracefully', async () => {
      const error = new Error('Fetch failed');
      mockGetAllSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.series).toEqual([]);
      expect(result.current.error).toEqual(error);
    });
  });

  describe('createNewSeries', () => {
    it('should create a new series and update state', async () => {
    const newSeriesData = {
      userId: 'user-1',
      title: 'New Series',
      theme: 'New Theme',
        description: 'New Description',
        bookOrTopic: 'New Book',
        sermonIds: [],
        status: 'draft' as const,
        color: '#0000FF',
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      };

      const createdSeries = { ...newSeriesData, id: 'new-series-id' };
      mockCreateSeries.mockResolvedValue(createdSeries);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let returnedSeries;
      await act(async () => {
        returnedSeries = await result.current.createNewSeries(newSeriesData);
      });

      expect(mockCreateSeries).toHaveBeenCalledWith(newSeriesData);
      expect(returnedSeries).toEqual(createdSeries);
      expect(result.current.series).toEqual([createdSeries, ...mockSeries]);
      expect(result.current.error).toBeNull();
    });

    it('should handle create error and set error state', async () => {
      const error = new Error('Create failed');
      mockCreateSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.createNewSeries({
        userId: 'user-1',
        title: 'New Series',
        theme: 'New Theme',
        description: 'New Description',
        bookOrTopic: 'New Book',
        sermonIds: [],
        status: 'draft' as const,
        color: '#0000FF',
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      })).rejects.toThrow('Create failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('updateExistingSeries', () => {
    it('should update existing series and update state', async () => {
      const updates = { title: 'Updated Title', theme: 'Updated Theme' };
      const updatedSeries = { ...mockSeries[0], ...updates };
      mockUpdateSeries.mockResolvedValue(updatedSeries);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let returnedSeries;
      await act(async () => {
        returnedSeries = await result.current.updateExistingSeries('series-1', updates);
      });

      expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', updates);
      expect(returnedSeries).toEqual(updatedSeries);
      expect(result.current.series[0]).toEqual(updatedSeries);
      expect(result.current.series[1]).toEqual(mockSeries[1]); // unchanged
      expect(result.current.error).toBeNull();
    });

    it('should handle update error and set error state', async () => {
      const error = new Error('Update failed');
      mockUpdateSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.updateExistingSeries('series-1', { title: 'Updated' })).rejects.toThrow('Update failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('deleteExistingSeries', () => {
    it('should delete series and update state', async () => {
      mockDeleteSeries.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteExistingSeries('series-1');
      });

      expect(mockDeleteSeries).toHaveBeenCalledWith('series-1');
      expect(result.current.series).toEqual([mockSeries[1]]); // series-1 removed
      expect(result.current.error).toBeNull();
    });

    it('should handle delete error and set error state', async () => {
      const error = new Error('Delete failed');
      mockDeleteSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.deleteExistingSeries('series-1')).rejects.toThrow('Delete failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('addSermon', () => {
    it('should add sermon to series and refresh data', async () => {
      mockAddSermonToSeries.mockResolvedValue(undefined);
      // Mock refresh call
      mockGetAllSeries.mockResolvedValue(mockSeries);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addSermon('series-1', 'new-sermon-id', 1);
      });

      expect(mockAddSermonToSeries).toHaveBeenCalledWith('series-1', 'new-sermon-id', 1);
      expect(mockGetAllSeries).toHaveBeenCalledTimes(2); // initial + refresh
      expect(result.current.error).toBeNull();
    });

    it('should handle add sermon error and set error state', async () => {
      const error = new Error('Add sermon failed');
      mockAddSermonToSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.addSermon('series-1', 'new-sermon-id')).rejects.toThrow('Add sermon failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('removeSermon', () => {
    it('should remove sermon from series and refresh data', async () => {
      mockRemoveSermonFromSeries.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.removeSermon('series-1', 'sermon-1');
      });

      expect(mockRemoveSermonFromSeries).toHaveBeenCalledWith('series-1', 'sermon-1');
      expect(mockGetAllSeries).toHaveBeenCalledTimes(2); // initial + refresh
      expect(result.current.error).toBeNull();
    });

    it('should handle remove sermon error and set error state', async () => {
      const error = new Error('Remove sermon failed');
      mockRemoveSermonFromSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.removeSermon('series-1', 'sermon-1')).rejects.toThrow('Remove sermon failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('reorderSeriesSermons', () => {
    it('should reorder sermons in series and refresh data', async () => {
      const newOrder = ['sermon-2', 'sermon-1'];
      mockReorderSermons.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.reorderSeriesSermons('series-1', newOrder);
      });

      expect(mockReorderSermons).toHaveBeenCalledWith('series-1', newOrder);
      expect(mockGetAllSeries).toHaveBeenCalledTimes(2); // initial + refresh
      expect(result.current.error).toBeNull();
    });

    it('should handle reorder error and set error state', async () => {
      const error = new Error('Reorder failed');
      mockReorderSermons.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.reorderSeriesSermons('series-1', ['sermon-1'])).rejects.toThrow('Reorder failed');

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('refreshSeries', () => {
    it('should refresh series data', async () => {
      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Change mock to return different data
      const newSeries = [{ ...mockSeries[0], title: 'Refreshed Title' }];
      mockGetAllSeries.mockResolvedValue(newSeries);

      await act(async () => {
        await result.current.refreshSeries();
      });

      expect(result.current.series).toEqual(newSeries);
      expect(mockGetAllSeries).toHaveBeenCalledTimes(2);
    });
  });
});
