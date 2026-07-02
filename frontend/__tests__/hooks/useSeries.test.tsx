import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useSeries } from '@/hooks/useSeries';
import { Series } from '@/models/models';
import {
  getAllSeries,
  createSeries,
  updateSeries,
  deleteSeries,
} from '@/services/series.service';

import type { ReactNode } from 'react';

// Mock the services. Membership ops (add/remove/reorder) moved off series.service
// to the client playlist sweep, so they are no longer part of this hook's surface.
jest.mock('@/services/series.service', () => ({
  getAllSeries: jest.fn(),
  createSeries: jest.fn(),
  updateSeries: jest.fn(),
  deleteSeries: jest.fn(),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

const mockGetAllSeries = getAllSeries as jest.MockedFunction<typeof getAllSeries>;
const mockCreateSeries = createSeries as jest.MockedFunction<typeof createSeries>;
const mockUpdateSeries = updateSeries as jest.MockedFunction<typeof updateSeries>;
const mockDeleteSeries = deleteSeries as jest.MockedFunction<typeof deleteSeries>;
const mockUseResolvedUid = useResolvedUid as jest.MockedFunction<typeof useResolvedUid>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
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
    mockUseResolvedUid.mockReturnValue({ uid: undefined, isAuthLoading: false });
    mockUseOnlineStatus.mockReturnValue(true);
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
    it('should create a new series and reconcile to server state (optimistic + fire-and-forget)', async () => {
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
      // onSuccess invalidates → refetch returns the authoritative list (incl. created).
      mockGetAllSeries.mockResolvedValue([createdSeries, ...mockSeries]);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createNewSeries(newSeriesData);
      });

      // createNewSeries now mints a stable client id and passes it through so the
      // create is idempotent (setDoc by that id) — a replayed offline create is a
      // no-op overwrite, not a duplicate.
      expect(mockCreateSeries).toHaveBeenCalledWith(
        expect.objectContaining({ ...newSeriesData, id: expect.any(String) })
      );
      await waitFor(() => {
        expect(result.current.series).toEqual([createdSeries, ...mockSeries]);
      });
      expect(result.current.error).toBeNull();
    });

    it('should surface create error via hook error state (no reject)', async () => {
      const error = new Error('Create failed');
      mockCreateSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createNewSeries({
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
        });
      });

      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });
  });

  describe('updateExistingSeries', () => {
    it('should update existing series and reconcile to server state', async () => {
      const updates = { title: 'Updated Title', theme: 'Updated Theme' };
      const updatedSeries = { ...mockSeries[0], ...updates };
      mockUpdateSeries.mockResolvedValue(updatedSeries);
      mockGetAllSeries.mockResolvedValue([updatedSeries, mockSeries[1]]);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateExistingSeries('series-1', updates);
      });

      expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', updates);
      await waitFor(() => {
        expect(result.current.series[0]).toEqual(updatedSeries);
      });
      expect(result.current.series[1]).toEqual(mockSeries[1]); // unchanged
      expect(result.current.error).toBeNull();
    });

    it('should update SERIES_DETAIL cache if it exists', async () => {
      const updates = { title: 'Updated Title', theme: 'Updated Theme' };
      const updatedSeries = { ...mockSeries[0], ...updates };
      mockUpdateSeries.mockResolvedValue(updatedSeries);

      // We need queryClient to have some cache data
      const queryClient = new QueryClient();
      queryClient.setQueryData(['series-detail', 'series-1'], { series: mockSeries[0], other: 'data' });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(() => useSeries('user-1'), { wrapper });

      await act(async () => {
        await result.current.updateExistingSeries('series-1', updates);
      });

      // Optimistic onMutate + onSuccess both merge updates into the detail cache.
      await waitFor(() => {
        const cached = queryClient.getQueryData<any>(['series-detail', 'series-1']);
        expect(cached).toEqual({ series: updatedSeries, other: 'data' });
      });
    });

    it('should surface update error via hook error state (no reject)', async () => {
      const error = new Error('Update failed');
      mockUpdateSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateExistingSeries('series-1', { title: 'Updated' });
      });

      await waitFor(() => {
        expect(result.current.error).toEqual(error);
      });
    });

    it('should NOT throw on writes when offline — buffers them (Stage 2)', async () => {
      // Offline no longer short-circuits: the write is optimistic + fire-and-forget,
      // so the call resolves and React Query pauses/persists the underlying mutation.
      mockUseOnlineStatus.mockReturnValue(false);
      mockUpdateSeries.mockResolvedValue({ ...mockSeries[0], title: 'x' });
      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await act(async () => {
        await expect(
          result.current.updateExistingSeries('series-1', { title: 'x' })
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('deleteExistingSeries', () => {
    it('should delete series and reconcile to server state', async () => {
      mockDeleteSeries.mockResolvedValue(undefined);
      mockGetAllSeries.mockResolvedValue([mockSeries[1]]); // server reflects deletion

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteExistingSeries('series-1');
      });

      expect(mockDeleteSeries).toHaveBeenCalledWith('series-1');
      await waitFor(() => {
        expect(result.current.series).toEqual([mockSeries[1]]); // series-1 removed
      });
      expect(result.current.error).toBeNull();
    });

    it('should surface delete error via hook error state (no reject)', async () => {
      const error = new Error('Delete failed');
      mockDeleteSeries.mockRejectedValue(error);

      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteExistingSeries('series-1');
      });

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

    it('should handle refresh error', async () => {
      const { result } = renderHook(() => useSeries('user-1'), { wrapper: createWrapper() });

      const error = new Error('Refresh failed');
      mockGetAllSeries.mockRejectedValueOnce(error); // first load error

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockGetAllSeries.mockRejectedValueOnce(error); // refresh error
      await act(async () => {
        await expect(result.current.refreshSeries()).rejects.toThrow('Refresh failed');
      });

      expect(result.current.error).toEqual(error);
    });
  });
});
