import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { useGroupDetail } from '@/hooks/useGroupDetail';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  addGroupMeetingDate,
  deleteGroup,
  deleteGroupMeetingDate,
  updateGroup,
  updateGroupMeetingDate,
} from '@/services/groups.service';

import type { ReactNode } from 'react';

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@/services/groups.service', () => ({
  addGroupMeetingDate: jest.fn(),
  deleteGroup: jest.fn(),
  deleteGroupMeetingDate: jest.fn(),
  getGroupById: jest.fn(),
  updateGroup: jest.fn(),
  updateGroupMeetingDate: jest.fn(),
}));

const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockUpdateGroup = updateGroup as jest.MockedFunction<typeof updateGroup>;
const mockAddGroupMeetingDate = addGroupMeetingDate as jest.MockedFunction<typeof addGroupMeetingDate>;
const mockUpdateGroupMeetingDate = updateGroupMeetingDate as jest.MockedFunction<typeof updateGroupMeetingDate>;
const mockDeleteGroupMeetingDate = deleteGroupMeetingDate as jest.MockedFunction<typeof deleteGroupMeetingDate>;
const mockDeleteGroup = deleteGroup as jest.MockedFunction<typeof deleteGroup>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useGroupDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseServerFirstQuery.mockReturnValue({
      data: {
        id: 'g1',
        userId: 'user-1',
        title: 'Group 1',
        status: 'draft',
        templates: [],
        flow: [],
        meetingDates: [],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn().mockResolvedValue(undefined),
    } as any);

    mockUpdateGroup.mockResolvedValue({ id: 'g1', title: 'Updated' } as any);
    mockAddGroupMeetingDate.mockResolvedValue({ id: 'd1', date: '2026-02-11', createdAt: 'x' } as any);
    mockUpdateGroupMeetingDate.mockResolvedValue({ id: 'd1', date: '2026-02-12', createdAt: 'x' } as any);
    mockDeleteGroupMeetingDate.mockResolvedValue(undefined);
    mockDeleteGroup.mockResolvedValue(undefined);
  });

  it('updates group and meeting dates through service calls', async () => {
    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });
    expect(result.current.group?.id).toBe('g1');

    await act(async () => {
      await result.current.updateGroupDetail({ title: 'Updated' });
      await result.current.addMeetingDate({ date: '2026-02-11' });
      await result.current.updateMeetingDate('d1', { date: '2026-02-12' });
      await result.current.removeMeetingDate('d1');
    });

    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'Updated' });
    expect(mockAddGroupMeetingDate).toHaveBeenCalledWith('g1', { date: '2026-02-11' });
    expect(mockUpdateGroupMeetingDate).toHaveBeenCalledWith('g1', 'd1', { date: '2026-02-12' });
    expect(mockDeleteGroupMeetingDate).toHaveBeenCalledWith('g1', 'd1');
  });

  it('deletes group detail and refreshes via refetch callback', async () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockUseServerFirstQuery.mockReturnValue({
      data: {
        id: 'g1',
        userId: 'user-1',
        title: 'Group 1',
        status: 'draft',
        templates: [],
        flow: [],
        meetingDates: [],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch,
    } as any);

    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.refreshGroupDetail();
      await result.current.deleteGroupDetail();
    });

    expect(refetch).toHaveBeenCalled();
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
  });

  it('returns early and skips mutations when group is not available', async () => {
    mockUseServerFirstQuery.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn().mockResolvedValue(undefined),
    } as any);

    const { result } = renderHook(() => useGroupDetail('missing'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.updateGroupDetail({ title: 'X' });
      await result.current.addMeetingDate({ date: '2026-02-11' });
      await result.current.updateMeetingDate('d1', { date: '2026-02-12' });
      await result.current.removeMeetingDate('d1');
      await result.current.deleteGroupDetail();
    });

    expect(mockUpdateGroup).not.toHaveBeenCalled();
    expect(mockAddGroupMeetingDate).not.toHaveBeenCalled();
    expect(mockUpdateGroupMeetingDate).not.toHaveBeenCalled();
    expect(mockDeleteGroupMeetingDate).not.toHaveBeenCalled();
    expect(mockDeleteGroup).not.toHaveBeenCalled();
  });

  it('exposes normalized mutation error when service rejects', async () => {
    mockUpdateGroup.mockRejectedValue('not-an-error');
    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });

    await expect(result.current.updateGroupDetail({ title: 'X' })).rejects.toThrow('not-an-error');
  });
});
