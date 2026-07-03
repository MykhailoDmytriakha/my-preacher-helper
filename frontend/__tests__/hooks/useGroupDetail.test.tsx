import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

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

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'user-1', isAuthLoading: false }),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(() => true),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
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
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

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

  it('fires content + meeting-date writes through the service (add mints an id)', async () => {
    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });
    expect(result.current.group?.id).toBe('g1');

    await act(async () => {
      await result.current.updateGroupDetail({ title: 'Updated' });
      await result.current.addMeetingDate({ date: '2026-02-11' });
      await result.current.updateMeetingDate('d1', { date: '2026-02-12' });
      await result.current.removeMeetingDate('d1');
    });

    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'Updated' });
    // addMeetingDate mints a stable client id in the wrapper (idempotent add).
    expect(mockAddGroupMeetingDate).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ date: '2026-02-11', id: expect.any(String) })
    );
    expect(mockUpdateGroupMeetingDate).toHaveBeenCalledWith('g1', 'd1', { date: '2026-02-12' });
    expect(mockDeleteGroupMeetingDate).toHaveBeenCalledWith('g1', 'd1');
  });

  it('deletes the group via the keyed mutation and refreshes via refetch', async () => {
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
      result.current.deleteGroupDetail();
    });

    expect(refetch).toHaveBeenCalled();
    await waitFor(() => expect(mockDeleteGroup).toHaveBeenCalledWith('g1'));
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
      result.current.deleteGroupDetail();
    });

    expect(mockUpdateGroup).not.toHaveBeenCalled();
    expect(mockAddGroupMeetingDate).not.toHaveBeenCalled();
    expect(mockUpdateGroupMeetingDate).not.toHaveBeenCalled();
    expect(mockDeleteGroupMeetingDate).not.toHaveBeenCalled();
    expect(mockDeleteGroup).not.toHaveBeenCalled();
  });

  it('surfaces a normalized error and toasts when an ONLINE write rejects (fire-and-forget, no throw)', async () => {
    mockUpdateGroup.mockRejectedValue('not-an-error');
    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });

    // Fire-and-forget: the call resolves even though the underlying write rejects.
    await act(async () => {
      await result.current.updateGroupDetail({ title: 'X' });
    });

    await waitFor(() => expect(result.current.error?.message).toBe('not-an-error'));
    expect(mockToastError).toHaveBeenCalledWith('Failed to update group');
  });

  it('toasts a delete failure via the mutation onError', async () => {
    mockDeleteGroup.mockRejectedValueOnce(new Error('delete boom'));
    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.deleteGroupDetail();
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to delete group'));
  });
});
