import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
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
import { toast } from 'sonner';

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

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => {
      if (key === 'writeRecovery.groupCreateFailed') {
        return `Group "${options?.name}" was not saved. Your text is ready to retry.`;
      }
      if (key === 'buttons.retry') return 'Retry';
      return key;
    },
  }),
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

const createOfflineWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: 5, retryDelay: 0, networkMode: 'offlineFirst' },
    },
  });

  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
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

  afterEach(() => {
    onlineManager.setOnline(true);
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

  it('offline write is ACCEPTED as queued, never as saved (Stage 2 + write contract)', async () => {
    // Offline does not short-circuit with an error: the write is optimistic and the
    // durable queue takes ownership, so acceptance resolves immediately. The contract
    // makes the DIFFERENCE visible: the outcome is `queued`, not `persisted`, which is
    // what forbids any caller from announcing it as saved.
    mockUseOnlineStatus.mockReturnValue(false);
    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await act(async () => {
      const submission = result.current.createNewGroup({
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

      await expect(submission.acceptance).resolves.toEqual({
        kind: 'queued',
        receipt: expect.stringContaining('group:create:'),
      });
    });
  });

  it('keeps a failed write out of the page-fatal error state', async () => {
    // Rewritten: a refused WRITE used to travel through `error`, the same field the
    // page renders as a fatal state — so one refused create replaced the entire screen,
    // taking the open editor and the list with it. The refusal is reported by the
    // recovery descriptor instead; `error` stays the query's.
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
      expect(result.current.error).toBeNull();
    });
  });

  it('keeps a terminally failed group draft recoverable with its exact text and a same-payload retry', async () => {
    mockCreateGroup.mockRejectedValueOnce(new Error('Permission denied'));
    const { result } = renderHook(() => useGroups(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.createNewGroup({
        userId: 'user-1',
        title: 'Hospital prayer team',
        description: 'The exact meeting plan dictated between services.',
        status: 'draft',
        templates: [],
        flow: [],
        meetingDates: [],
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        seriesId: null,
        seriesPosition: null,
      } as any);
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Hospital prayer team'),
        expect.objectContaining({
          duration: Infinity,
          description: expect.stringContaining('The exact meeting plan dictated between services.'),
          action: expect.objectContaining({
            label: expect.any(String),
            onClick: expect.any(Function),
          }),
        })
      )
    );

    const firstPayload = mockCreateGroup.mock.calls[0][0];
    const recoveryAction = (toast.error as jest.Mock).mock.calls.at(-1)[1].action;
    act(() => recoveryAction.onClick());

    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalledTimes(2));
    expect(mockCreateGroup.mock.calls[1][0]).toEqual(firstPayload);
  });

  it('keeps a paused offline group create silent while its exact payload remains queued', async () => {
    const { queryClient, wrapper } = createOfflineWrapper();
    onlineManager.setOnline(false);
    mockCreateGroup.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useGroups(), { wrapper });

    await act(async () => {
      await result.current.createNewGroup({
        userId: 'user-1',
        title: 'Queued group title',
        description: 'Queued group description',
        status: 'draft',
        templates: [],
        flow: [],
        meetingDates: [],
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        seriesId: null,
        seriesPosition: null,
      } as any);
    });

    await waitFor(() => {
      const queued = queryClient.getMutationCache().getAll()[0];
      expect(queued?.state.isPaused).toBe(true);
      expect((queued?.state.variables as { title?: string })?.title).toBe('Queued group title');
    });
    expect(toast.error).not.toHaveBeenCalled();

    mockCreateGroup.mockResolvedValueOnce({ id: 'queued-group-id' } as any);
  });
});
