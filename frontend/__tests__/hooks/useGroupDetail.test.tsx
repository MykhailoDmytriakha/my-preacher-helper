import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useGroupDetail } from '@/hooks/useGroupDetail';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
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
  // Real constant: the hook reads `group.rev[GROUP_CONTENT_AGGREGATE]`, so a stubbed
  // undefined here would silently make every stated revision 0 and hide a break.
  GROUP_CONTENT_AGGREGATE: 'content',
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
    // A refused save is persisted so it survives a reload — clear it between tests,
    // or one test's conflict is restored into the next one's fresh mount.
    localStorage.clear();
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

    // Third argument = the revision this edit was built from, so a save from a tab
    // that never saw another device's change is refused rather than applied.
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'Updated' }, 0);
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

  /**
   * A refused group edit must not disappear.
   *
   * The group write is fire-and-forget, so a refusal lands in a `.catch` that used
   * to treat every failure the same way: toast + refetch. That refetch would pull
   * the other device's text over the person's still-unsent words — the silent loss
   * this whole mechanism exists to prevent.
   */
  describe('a refused save is held, not reconciled away', () => {
    const groupAtRev5 = {
      id: 'g1',
      userId: 'user-1',
      title: 'Group 1',
      status: 'draft' as const,
      templates: [],
      flow: [],
      meetingDates: [],
      rev: { content: 5 },
    };

    const mountAtRev5 = () => {
      mockUseServerFirstQuery.mockReturnValue({
        data: groupAtRev5,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
      } as any);
      return renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });
    };

    it('states the revision the edit was built from', async () => {
      const { result } = mountAtRev5();

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'Updated' });
      });

      expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'Updated' }, 5);
    });

    it('holds the refused edit instead of toasting a generic failure', async () => {
      mockUpdateGroup.mockRejectedValueOnce(new StaleWriteError('content', 5, 9));
      const { result } = mountAtRev5();

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'Typed on the laptop' });
      });

      await waitFor(() =>
        expect(result.current.saveConflict).toEqual({
          payload: { title: 'Typed on the laptop' },
          actualRevision: 9,
        })
      );
      // NOT the generic "failed to update group" — that would read as a glitch.
      expect(mockToastError).toHaveBeenCalledWith('freshness.staleSaveToast');
    });

    it('re-sends with the server revision when "keep mine" is chosen', async () => {
      mockUpdateGroup.mockRejectedValueOnce(new StaleWriteError('content', 5, 9));
      const { result } = mountAtRev5();

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'Typed on the laptop' });
      });
      await waitFor(() => expect(result.current.saveConflict).not.toBeNull());

      await act(async () => {
        await result.current.keepMineOnConflict();
      });

      // 9, NOT 5: otherwise the resend is refused again and the button lies.
      expect(mockUpdateGroup).toHaveBeenLastCalledWith('g1', { title: 'Typed on the laptop' }, 9);
    });


    it('carries the COMMITTED revision forward, so the next edit is not refused', async () => {
      // Found by adversarial review: the service returned the new revision and the
      // hook threw it away, so the person's SECOND keystroke stated the pre-write
      // number and was refused against their OWN save — a false conflict, and
      // strictly worse than before the guard existed.
      mockUpdateGroup.mockResolvedValueOnce({ ...groupAtRev5, rev: { content: 6 } } as any);
      const { result } = mountAtRev5();

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'First edit' });
      });
      await waitFor(() => expect(mockUpdateGroup).toHaveBeenCalledTimes(1));

      mockUpdateGroup.mockResolvedValueOnce({ ...groupAtRev5, rev: { content: 7 } } as any);
      await act(async () => {
        await result.current.updateGroupDetail({ title: 'Second edit' });
      });

      // 6, not 5 — the second save is built on what the first one committed.
      expect(mockUpdateGroup).toHaveBeenLastCalledWith('g1', { title: 'Second edit' }, 6);
    });

    it('does NOT discard the refused text when "take theirs" fails to load', async () => {
      // `invalidateQueries` resolves even when the refetch errors. Clearing the
      // conflict regardless would throw away the only copy of the typed text AND
      // fail to deliver the version it promised.
      mockUpdateGroup.mockRejectedValueOnce(new StaleWriteError('content', 5, 9));
      // The refresh cannot load the other version (expired permission).
      mockUseServerFirstQuery.mockReturnValue({
        data: groupAtRev5,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: jest.fn().mockResolvedValue({ isError: true, error: new Error('permission denied') }),
      } as any);
      const { result } = renderHook(() => useGroupDetail('g1'), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'Typed on the laptop' });
      });
      await waitFor(() => expect(result.current.saveConflict).not.toBeNull());

      await act(async () => {
        await result.current.takeTheirsOnConflict();
      });

      expect(result.current.saveConflict).not.toBeNull();
    });


    it('keeps the write counted until the backend answers', async () => {
      // The write is fire-and-forget, so the "Saved" indicator used to appear the
      // moment the request was SENT — before the transaction could refuse it, and
      // even while offline. The screen reads this counter instead.
      let settle: (v: unknown) => void = () => {};
      mockUpdateGroup.mockImplementationOnce(() => new Promise((res) => { settle = res; }) as never);
      const { result } = mountAtRev5();

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'In flight' });
      });

      expect(result.current.pendingWrites).toBe(1);

      await act(async () => {
        settle({ ...groupAtRev5, rev: { content: 6 } });
      });

      await waitFor(() => expect(result.current.pendingWrites).toBe(0));
    });

    it('a generic failure still goes down the old reconcile path', async () => {
      mockUpdateGroup.mockRejectedValueOnce(new Error('permission denied'));
      const { result } = mountAtRev5();

      await act(async () => {
        await result.current.updateGroupDetail({ title: 'Updated' });
      });

      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.saveConflict).toBeNull();
    });
  });

});
