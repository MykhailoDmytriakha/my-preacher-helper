import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useGroups } from '@/hooks/useGroups';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  createGroup,
  deleteGroup,
  getAllGroups,
  updateGroup,
} from '@/services/groups.service';

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

jest.mock('@/services/groups.service', () => ({
  createGroup: jest.fn(),
  deleteGroup: jest.fn(),
  getAllGroups: jest.fn(),
  updateGroup: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseResolvedUid = useResolvedUid as jest.MockedFunction<typeof useResolvedUid>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockCreateGroup = createGroup as jest.MockedFunction<typeof createGroup>;
const mockUpdateGroup = updateGroup as jest.MockedFunction<typeof updateGroup>;
const mockDeleteGroup = deleteGroup as jest.MockedFunction<typeof deleteGroup>;
const mockGetAllGroups = getAllGroups as jest.MockedFunction<typeof getAllGroups>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useGroups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseResolvedUid.mockReturnValue({ uid: 'user-1' } as any);
    mockUseServerFirstQuery.mockReturnValue({
      data: [{ id: 'g1', userId: 'user-1', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [] }],
      isLoading: false,
      isFetching: false,
      error: null,
    } as any);
    mockCreateGroup.mockResolvedValue({ id: 'g2' } as any);
    mockUpdateGroup.mockResolvedValue({ id: 'g1', title: 'Updated' } as any);
    mockDeleteGroup.mockResolvedValue(undefined);
    mockGetAllGroups.mockResolvedValue([{ id: 'g1' } as any]);
  });

  it('returns groups from query and executes create/update/delete mutations', async () => {
    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });
    expect(result.current.groups).toHaveLength(1);

    await act(async () => {
      await result.current.createNewGroup({
        userId: 'user-1',
        title: 'New group',
        status: 'draft',
        templates: [],
        flow: [],
        meetingDates: [],
        createdAt: 'x',
        updatedAt: 'x',
        seriesId: null,
        seriesPosition: null,
      } as any);
      await result.current.updateExistingGroup('g1', { title: 'Updated' });
      await result.current.deleteExistingGroup('g1');
    });

    expect(mockCreateGroup).toHaveBeenCalled();
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'Updated' });
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
  });

  it('refreshes groups only when online and user id exists', async () => {
    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });
    const refreshed = await result.current.refreshGroups();
    expect(refreshed).toEqual([{ id: 'g1' }]);
    expect(mockGetAllGroups).toHaveBeenCalledWith('user-1');

    mockUseOnlineStatus.mockReturnValue(false);
    const { result: offline } = renderHook(() => useGroups(), { wrapper: createWrapper() });
    const refreshedOffline = await offline.current.refreshGroups();
    expect(refreshedOffline).toBeUndefined();
  });

  it('does not throw on writes when offline — buffers them instead (Stage 2)', async () => {
    // Offline no longer short-circuits with an error: the write is optimistic +
    // fire-and-forget, so createNewGroup resolves immediately and React Query
    // pauses/persists the underlying mutation to replay on reconnect.
    mockUseOnlineStatus.mockReturnValue(false);
    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(
        result.current.createNewGroup({
          userId: 'user-1',
          title: 'X',
          status: 'draft',
          templates: [],
          flow: [],
          meetingDates: [],
          createdAt: 'x',
          updatedAt: 'x',
          seriesId: null,
          seriesPosition: null,
        } as any)
      ).resolves.toBeUndefined();
    });
  });

  it('surfaces mutation errors via hook error state (normalized to Error)', async () => {
    // Fire-and-forget: the call resolves; a genuine failure surfaces through the
    // hook `error` (via the mutation onError handler), normalized to an Error.
    mockCreateGroup.mockRejectedValue('broken');
    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.createNewGroup({
        userId: 'user-1',
        title: 'X',
        status: 'draft',
        templates: [],
        flow: [],
        meetingDates: [],
        createdAt: 'x',
        updatedAt: 'x',
        seriesId: null,
        seriesPosition: null,
      } as any);
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('broken');
    });
  });
});
