import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  addPrayerUpdate,
  createPrayerRequest,
  deletePrayerRequest,
  getAllPrayerRequests,
  setPrayerStatus,
  updatePrayerRequest,
} from '@services/prayerRequests.service';

import type { ReactNode } from 'react';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@services/prayerRequests.service', () => ({
  addPrayerUpdate: jest.fn(),
  createPrayerRequest: jest.fn(),
  deletePrayerRequest: jest.fn(),
  getAllPrayerRequests: jest.fn(),
  setPrayerStatus: jest.fn(),
  updatePrayerRequest: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseResolvedUid = useResolvedUid as jest.MockedFunction<typeof useResolvedUid>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockCreatePrayerRequest = createPrayerRequest as jest.MockedFunction<typeof createPrayerRequest>;
const mockUpdatePrayerRequest = updatePrayerRequest as jest.MockedFunction<typeof updatePrayerRequest>;
const mockDeletePrayerRequest = deletePrayerRequest as jest.MockedFunction<typeof deletePrayerRequest>;
const mockAddPrayerUpdate = addPrayerUpdate as jest.MockedFunction<typeof addPrayerUpdate>;
const mockSetPrayerStatus = setPrayerStatus as jest.MockedFunction<typeof setPrayerStatus>;
const mockGetAllPrayerRequests = getAllPrayerRequests as jest.MockedFunction<typeof getAllPrayerRequests>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000, staleTime: 0 }, mutations: { retry: false } },
  });

  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
};

describe('usePrayerRequests', () => {
  const initialPrayer = {
    id: 'p1',
    userId: 'user-1',
    title: 'Pray for church',
    status: 'active',
    updates: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseResolvedUid.mockReturnValue({ uid: 'user-1' } as any);
    mockUseServerFirstQuery.mockReturnValue({
      data: [initialPrayer],
      isLoading: false,
      error: null,
    } as any);
    mockGetAllPrayerRequests.mockResolvedValue([initialPrayer] as any);
    mockCreatePrayerRequest.mockResolvedValue({ ...initialPrayer, id: 'p2', title: 'New prayer' } as any);
    mockUpdatePrayerRequest.mockResolvedValue({ ...initialPrayer, title: 'Updated prayer' } as any);
    mockDeletePrayerRequest.mockResolvedValue(undefined);
    mockAddPrayerUpdate.mockResolvedValue({
      ...initialPrayer,
      updates: [{ id: 'u1', text: 'Fresh update', createdAt: '2026-03-03T00:00:00.000Z' }],
    } as any);
    mockSetPrayerStatus.mockResolvedValue({
      ...initialPrayer,
      status: 'answered',
      answerText: 'God answered',
      answeredAt: '2026-03-04T00:00:00.000Z',
    } as any);
  });

  it('hydrates query data and executes create/update/delete/update/status mutations', async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    expect(result.current.prayerRequests).toHaveLength(1);
    expect(mockUseServerFirstQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['prayerRequests', 'user-1'],
        enabled: true,
      })
    );

    await act(async () => {
      await result.current.createPrayer({ userId: 'user-1', title: 'New prayer' } as any);
      await result.current.updatePrayer('p1', { title: 'Updated prayer' });
      await result.current.addUpdate('p1', 'Fresh update');
      await result.current.setStatus('p1', 'answered', 'God answered');
      await result.current.deletePrayer('p1');
    });

    expect(mockCreatePrayerRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'New prayer', id: expect.any(String) })
    );
    expect(mockUpdatePrayerRequest).toHaveBeenCalledWith('p1', { title: 'Updated prayer' });
    expect(mockAddPrayerUpdate).toHaveBeenCalledWith('p1', {
      updateId: expect.any(String),
      text: 'Fresh update',
      createdAt: expect.any(String),
    });
    expect(mockSetPrayerStatus).toHaveBeenCalledWith('p1', {
      status: 'answered',
      answerText: 'God answered',
      updatedAt: expect.any(String),
      answeredAt: expect.any(String),
    });
    const statusPayload = mockSetPrayerStatus.mock.calls[0][1] as { updatedAt: string; answeredAt?: string };
    expect(statusPayload.answeredAt).toBe(statusPayload.updatedAt);
    expect(mockDeletePrayerRequest).toHaveBeenCalledWith('p1');

    const cachedList = queryClient.getQueryData<any[]>(['prayerRequests', 'user-1']) ?? [];
    expect(cachedList.some((prayer) => prayer.id === 'p1')).toBe(false);
    expect(queryClient.getQueryData(['prayerRequest', 'p1'])).toBeUndefined();
  });

  it('replaces the optimistic create row with the persisted prayer', async () => {
    mockCreatePrayerRequest.mockImplementation(async (payload) => ({
      ...initialPrayer,
      ...payload,
      title: 'Persisted prayer',
      createdAt: '2026-03-05T00:00:00.000Z',
      updatedAt: '2026-03-05T00:00:00.000Z',
      status: 'active',
      updates: [],
    } as any));
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(['prayerRequests', 'user-1'], []);
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    let createdId = '';
    await act(async () => {
      createdId = await result.current.createPrayer({ userId: 'user-1', title: 'New prayer' } as any);
    });

    await waitFor(() => {
      const cachedList = queryClient.getQueryData<any[]>(['prayerRequests', 'user-1']) ?? [];
      expect(cachedList).toEqual([
        expect.objectContaining({
          id: createdId,
          title: 'Persisted prayer',
          updatedAt: '2026-03-05T00:00:00.000Z',
        }),
      ]);
    });
  });

  it('reconciles embedded update and status mutations with the persisted prayer', async () => {
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(['prayerRequests', 'user-1'], [initialPrayer]);
    queryClient.setQueryData(['prayerRequest', 'p1'], initialPrayer);
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.addUpdate('p1', 'Fresh update');
    });

    await waitFor(() => {
      const cachedList = queryClient.getQueryData<any[]>(['prayerRequests', 'user-1']) ?? [];
      expect(cachedList[0].updates).toEqual([
        { id: 'u1', text: 'Fresh update', createdAt: '2026-03-03T00:00:00.000Z' },
      ]);
    });

    await act(async () => {
      await result.current.setStatus('p1', 'answered', 'God answered');
    });

    await waitFor(() => {
      const cachedDetail = queryClient.getQueryData<any>(['prayerRequest', 'p1']);
      expect(cachedDetail).toEqual(
        expect.objectContaining({
          status: 'answered',
          answerText: 'God answered',
          answeredAt: '2026-03-04T00:00:00.000Z',
        })
      );
    });
  });

  it('does not throw on writes when offline — buffers them (Stage 2)', async () => {
    // Offline no longer short-circuits: the write is optimistic + fire-and-forget,
    // so createPrayer resolves (returning the client id) and React Query
    // pauses/persists the underlying mutation to replay on reconnect.
    mockUseOnlineStatus.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    let createdId: string | undefined;
    await act(async () => {
      createdId = await result.current.createPrayer({ userId: 'user-1', title: 'Offline prayer' } as any);
    });

    expect(typeof createdId).toBe('string');
    expect((createdId as string).length).toBeGreaterThan(0);
  });

  it('surfaces service failures via hook error state (normalized to Error)', async () => {
    mockCreatePrayerRequest.mockRejectedValue('broken');
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.createPrayer({ userId: 'user-1', title: 'Broken prayer' } as any);
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe('broken');
    });
  });

  it('rolls back optimistic delete state when the mutation fails', async () => {
    mockDeletePrayerRequest.mockRejectedValue(new Error('delete failed'));
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(['prayerRequests', 'user-1'], [initialPrayer, { ...initialPrayer, id: 'p2' }]);
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.deletePrayer('p1');
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe('delete failed');
    });

    await waitFor(() => {
      const rolledBack = queryClient.getQueryData<any[]>(['prayerRequests', 'user-1']) ?? [];
      expect(rolledBack.map((item) => item.id)).toEqual(['p1', 'p2']);
    });
  });
});
