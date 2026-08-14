import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { OfflineQueuedError, StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { toast } from 'sonner';
import { awaitAcceptance } from '@/utils/recoverableWrite';
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

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
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
      await result.current.createPrayer({ userId: 'user-1', title: 'New prayer' } as any).persistence;
      await result.current.updatePrayer('p1', { title: 'Updated prayer' }).persistence;
      await result.current.addUpdate('p1', 'Fresh update').persistence;
      await result.current.setStatus('p1', 'answered', 'God answered').persistence;
      await result.current.deletePrayer('p1').persistence;
    });

    expect(mockCreatePrayerRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'New prayer', id: expect.any(String) })
    );
    // Third argument = the revision this edit was built from; the hook passes
    // `null` when the caller states none, keeping the unguarded legacy path.
    expect(mockUpdatePrayerRequest).toHaveBeenCalledWith('p1', { title: 'Updated prayer' }, null, null);
    expect(mockAddPrayerUpdate).toHaveBeenCalledWith('p1', {
      updateId: expect.any(String),
      text: 'Fresh update',
      createdAt: expect.any(String),
    });
    // The answer carries human text, so the write states the revision it was built
    // from (`null` when the caller does not know one) — two devices answering the
    // same prayer must not overwrite each other in silence.
    expect(mockSetPrayerStatus).toHaveBeenCalledWith(
      'p1',
      {
        status: 'answered',
        answerText: 'God answered',
        updatedAt: expect.any(String),
        answeredAt: expect.any(String),
      },
      undefined,
      null,
      null
    );
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
      const submission = result.current.createPrayer({ userId: 'user-1', title: 'New prayer' } as any);
      const acceptance = await submission.acceptance;
      expect(acceptance.kind).toBe('queued');
      createdId = (acceptance.kind === 'queued' ? acceptance.receipt : '').replace('prayer:create:', '');
      await submission.persistence;
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
      await result.current.addUpdate('p1', 'Fresh update').persistence;
    });

    await waitFor(() => {
      const cachedList = queryClient.getQueryData<any[]>(['prayerRequests', 'user-1']) ?? [];
      expect(cachedList[0].updates).toEqual([
        { id: 'u1', text: 'Fresh update', createdAt: '2026-03-03T00:00:00.000Z' },
      ]);
    });

    await act(async () => {
      await result.current.setStatus('p1', 'answered', 'God answered').persistence;
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

  it('keeps update and status optimistic mirrors when a real durable outbox accepts them', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    mockUpdatePrayerRequest.mockRejectedValueOnce(new OfflineQueuedError('core'));
    mockSetPrayerStatus.mockRejectedValueOnce(new OfflineQueuedError('status'));
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(['prayerRequests', 'user-1'], [initialPrayer]);
    queryClient.setQueryData(['prayerRequest', 'p1'], initialPrayer);
    const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      const update = result.current.updatePrayer('p1', { title: 'Queued title' });
      await expect(awaitAcceptance(update, jest.fn())).resolves.toEqual(
        expect.objectContaining({ kind: 'queued' })
      );
      await Promise.resolve();
    });

    expect(queryClient.getQueryData<any[]>(['prayerRequests', 'user-1'])?.[0]).toEqual(
      expect.objectContaining({ title: 'Queued title' })
    );
    expect(queryClient.getQueryData<any>(['prayerRequest', 'p1'])).toEqual(
      expect.objectContaining({ title: 'Queued title' })
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();

    await act(async () => {
      const status = result.current.setStatus('p1', 'answered', 'Queued answer');
      await expect(awaitAcceptance(status, jest.fn())).resolves.toEqual(
        expect.objectContaining({ kind: 'queued' })
      );
      await Promise.resolve();
    });

    expect(queryClient.getQueryData<any[]>(['prayerRequests', 'user-1'])?.[0]).toEqual(
      expect.objectContaining({ status: 'answered', answerText: 'Queued answer' })
    );
    expect(queryClient.getQueryData<any>(['prayerRequest', 'p1'])).toEqual(
      expect.objectContaining({ status: 'answered', answerText: 'Queued answer' })
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
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
      const submission = result.current.createPrayer({ userId: 'user-1', title: 'Offline prayer' } as any);
      const acceptance = await submission.acceptance;
      createdId = acceptance.kind === 'queued' ? acceptance.receipt.replace('prayer:create:', '') : undefined;
    });

    expect(typeof createdId).toBe('string');
    expect((createdId as string).length).toBeGreaterThan(0);
  });

  it('keeps a failed write out of the page-fatal error state', async () => {
    /**
     * This test previously awaited the SUBMISSION OBJECT and then ran an empty
     * `waitFor` — it asserted nothing at all, so the very regression it names could
     * return unnoticed. Now it waits for the write to actually fail and checks the
     * field a page renders as fatal: one refused prayer must not replace the screen.
     */
    mockCreatePrayerRequest.mockRejectedValue(new Error('broken'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests('user-1'), { wrapper });

    await act(async () => {
      const submission = result.current.createPrayer({
        userId: 'user-1',
        title: 'Broken prayer',
      } as never);
      await submission.persistence.catch(() => undefined);
    });

    await waitFor(() => expect(mockCreatePrayerRequest).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
  });

  it('keeps a terminally failed prayer create recoverable with its exact text and retry action', async () => {
    mockCreatePrayerRequest.mockRejectedValueOnce(new Error('Permission denied'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.createPrayer({
        userId: 'user-1',
        title: 'Prayer dictated at the hospital',
        description: 'Please pray for the exact words I cannot reconstruct.',
      });
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          duration: Infinity,
          description: expect.stringContaining('Please pray for the exact words I cannot reconstruct.'),
          action: expect.objectContaining({
            label: expect.any(String),
            onClick: expect.any(Function),
          }),
        })
      )
    );

    const firstPayload = mockCreatePrayerRequest.mock.calls[0][0];
    const recoveryAction = (toast.error as jest.Mock).mock.calls[0][1].action;
    act(() => recoveryAction.onClick());
    await waitFor(() => expect(mockCreatePrayerRequest).toHaveBeenCalledTimes(2));
    expect(mockCreatePrayerRequest.mock.calls[1][0]).toEqual(firstPayload);
  });

  it('keeps a terminally failed prayer update recoverable with its exact text and retry action', async () => {
    mockAddPrayerUpdate.mockRejectedValueOnce(new Error('Invalid prayer state'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.addUpdate('p1', 'The exact update dictated after the service');
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          duration: Infinity,
          description: 'The exact update dictated after the service',
          action: expect.objectContaining({ onClick: expect.any(Function) }),
        })
      )
    );

    const firstPayload = mockAddPrayerUpdate.mock.calls[0][1];
    const recoveryAction = (toast.error as jest.Mock).mock.calls[0][1].action;
    act(() => recoveryAction.onClick());
    await waitFor(() => expect(mockAddPrayerUpdate).toHaveBeenCalledTimes(2));
    expect(mockAddPrayerUpdate.mock.calls[1][1]).toEqual(firstPayload);
  });

  it('names a rules refusal and offers copy instead of a pointless retry', async () => {
    mockAddPrayerUpdate.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'permission-denied' })
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.addUpdate('p1', 'Господь ответил в среду');
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'writeRecovery.refused',
        expect.objectContaining({
          description: 'Господь ответил в среду',
          action: expect.objectContaining({ label: 'freshness.copyTextAction' }),
        })
      )
    );

    const action = (toast.error as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());
    await Promise.resolve();
    expect(mockAddPrayerUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending prayer update silent with its exact text still queued', async () => {
    mockAddPrayerUpdate.mockReturnValueOnce(new Promise(() => undefined));
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests(), { wrapper });

    await act(async () => {
      await result.current.addUpdate('p1', 'Exact queued prayer update');
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
    const queued = queryClient.getMutationCache().getAll().find(
      (mutation) => JSON.stringify(mutation.options.mutationKey) === JSON.stringify(['prayerRequests', 'addUpdate'])
    );
    expect(queued?.state.status).toBe('pending');
    expect((queued?.state.variables as { text?: string } | undefined)?.text).toBe(
      'Exact queued prayer update'
    );
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
      
    });

    await waitFor(() => {
      const rolledBack = queryClient.getQueryData<any[]>(['prayerRequests', 'user-1']) ?? [];
      expect(rolledBack.map((item) => item.id)).toEqual(['p1', 'p2']);
    });
  });

  /**
   * A refused prayer edit must not vanish with the optimistic rollback.
   *
   * The rollback itself is right — the server is the truth. What must not happen
   * is the person's words disappearing along with it, leaving only a toast that
   * reads like a glitch.
   */
  describe('a refused save is held, not rolled away in silence', () => {
    // The conflict is persisted now, so one test's refusal would otherwise be
    // restored into the next test's fresh mount.
    beforeEach(() => localStorage.clear());
    it('holds the refused edit with the revision the server actually had', async () => {
      mockUpdatePrayerRequest.mockRejectedValueOnce(new StaleWriteError('core', 2, 7));
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

      await act(async () => {
        // `updatePrayer` is awaited for real now, so a refusal reaches the caller
        // instead of being announced as success — swallow it here on purpose.
        await result.current.updatePrayer('p1', { title: 'Typed on the laptop' }, 2).acceptance.catch(() => {});
      });

      await waitFor(() =>
        expect(result.current.saveConflict).toEqual({
          payload: { id: 'p1', updates: { title: 'Typed on the laptop' } },
          actualRevision: 7,
        })
      );
    });

    it('re-sends with the server revision when "keep mine" is chosen', async () => {
      mockUpdatePrayerRequest.mockRejectedValueOnce(new StaleWriteError('core', 2, 7));
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

      await act(async () => {
        // `updatePrayer` is awaited for real now, so a refusal reaches the caller
        // instead of being announced as success — swallow it here on purpose.
        await result.current.updatePrayer('p1', { title: 'Typed on the laptop' }, 2).acceptance.catch(() => {});
      });
      await waitFor(() => expect(result.current.saveConflict).not.toBeNull());

      await act(async () => {
        await result.current.keepMineOnConflict();
      });

      // 7, NOT 2: otherwise the resend is refused again and the button lies.
      // And NO baseline: the person has SEEN the other version and chose their own,
      // so this is a deliberate overwrite — comparing content here would refuse the
      // very action they just confirmed.
      await waitFor(() =>
        expect(mockUpdatePrayerRequest).toHaveBeenLastCalledWith(
          'p1',
          { title: 'Typed on the laptop' },
          7,
          null
        )
      );
    });


    it('gives the refused text back after a reload', async () => {
      // Held only in component state, a refusal died with the page. The page now
      // supplies the open prayer's id, which is what makes the slot durable.
      mockUpdatePrayerRequest.mockRejectedValueOnce(new StaleWriteError('core', 2, 7));
      const { wrapper } = createWrapper();
      const first = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

      await act(async () => {
        await first.result.current.updatePrayer('p1', { title: 'Typed on the laptop' }, 2).acceptance.catch(() => {});
      });
      await waitFor(() => expect(first.result.current.saveConflict).not.toBeNull());
      first.unmount();

      const { wrapper: wrapper2 } = createWrapper();
      const second = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper: wrapper2 });

      expect(second.result.current.saveConflict).toEqual({
        payload: { id: 'p1', updates: { title: 'Typed on the laptop' } },
        actualRevision: 7,
      });
    });

    it('leaves a generic failure on the old error path', async () => {
      mockUpdatePrayerRequest.mockRejectedValueOnce(new Error('permission denied'));
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

      await act(async () => {
        await result.current.updatePrayer('p1', { title: 'Updated' }, 2).acceptance.catch(() => {});
      });

      // A generic failure does NOT become a conflict offer — and it does not become a
      // page-fatal error either; `error` stays the query's.
      await waitFor(() => expect(result.current.saveConflict).toBeNull());
      expect(result.current.error).toBeNull();
    });
  });

});

/**
 * The ANSWER is the longest text on this screen and it lives nowhere but the modal
 * that carries it. "The modal stays open" is not durability: the backdrop, the ✕ and
 * a reload all take it. Status/answer is a different aggregate from the core fields,
 * so it needs its own slot — sharing one would let a refused title overwrite a
 * refused answer.
 */
describe('a refused ANSWER survives the modal', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    // Standalone setup: relying on the previous describe's beforeEach makes this
    // block pass only when the whole file runs, and crash when run alone.
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseResolvedUid.mockReturnValue({ uid: 'user-1' } as never);
    mockUseServerFirstQuery.mockReturnValue({ data: [], isLoading: false, error: null } as never);
  });

  it('is held durably and retired only once the resend commits', async () => {
    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 0, 4));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      await result.current
          .setStatus('p1', 'answered', 'God provided a job', 0, { status: 'active' })
          .acceptance.catch(() => {});
    });

    await waitFor(() => expect(result.current.statusConflict).not.toBeNull());
    expect(result.current.statusConflict?.payload.answerText).toBe('God provided a job');
    // Written where a reload can find it — not in component state.
    expect(Object.keys(localStorage).some((k) => k.includes('conflict:status'))).toBe(true);

    // Keep mine: the resend adopts the revision the server held at refusal, states
    // NO baseline (the overwrite is deliberate now), and commits.
    mockSetPrayerStatus.mockResolvedValueOnce({ id: 'p1' } as never);
    await act(async () => {
      await result.current.keepMineOnStatusConflict();
    });

    await waitFor(() => expect(result.current.statusConflict).toBeNull());
    expect(mockSetPrayerStatus).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ status: 'answered', answerText: 'God provided a job' }),
      undefined,
      4,
      null
    );
  });

  it('stays BUSY while the deliberate overwrite is in flight', async () => {
    /**
     * `resolvingConflict` is what disables the two conflict buttons. It was cleared in a
     * `finally` that ran on the same tick as an unawaited `mutate()`, so the buttons were
     * live again while their own write was still travelling: a second click sent a second
     * deliberate overwrite, or raced "take theirs" and undid the choice just made.
     */
    const { wrapper } = createWrapper();
    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 0, 4));
    const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      await result.current
        .setStatus('p1', 'answered', 'God provided a job', 0, { status: 'active' })
        .acceptance.catch(() => {});
    });
    await waitFor(() => expect(result.current.statusConflict).not.toBeNull());

    // Hold the resend open so the in-flight window is observable.
    let finishResend: (value: unknown) => void = () => undefined;
    mockSetPrayerStatus.mockImplementationOnce(
      () => new Promise((resolve) => { finishResend = resolve; }) as never
    );

    let resend: Promise<void> = Promise.resolve();
    await act(async () => {
      resend = result.current.keepMineOnStatusConflict();
      await Promise.resolve();
    });

    expect(result.current.resolvingConflict).toBe(true);

    await act(async () => {
      finishResend({ id: 'p1' });
      await resend;
    });

    await waitFor(() => expect(result.current.resolvingConflict).toBe(false));
  });

  it('still holds the answer when the resend is refused AGAIN', async () => {
    // Two devices, hours apart: while the person reads the question, the other device
    // saves once more. Retiring the answer the moment the resend is SENT would leave
    // nothing to hold the second refusal — the words would be gone for good.
    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 0, 4));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      await result.current.setStatus('p1', 'answered', 'God provided a job', 0).acceptance.catch(() => {});
    });
    await waitFor(() => expect(result.current.statusConflict).not.toBeNull());

    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 4, 9));
    await act(async () => {
      await result.current.keepMineOnStatusConflict();
    });

    await waitFor(() => expect(result.current.statusConflict?.actualRevision).toBe(9));
    expect(result.current.statusConflict?.payload.answerText).toBe('God provided a job');
  });

  it('keeps the answer when the resend fails for any OTHER reason', async () => {
    // A refusal re-captures itself in onError; a network failure does not. So the
    // copy may only be retired on a confirmed commit — retiring it when the resend
    // is merely SENT loses the answer to a dropped connection.
    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 0, 4));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      await result.current.setStatus('p1', 'answered', 'God provided a job', 0).acceptance.catch(() => {});
    });
    await waitFor(() => expect(result.current.statusConflict).not.toBeNull());

    mockSetPrayerStatus.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await result.current.keepMineOnStatusConflict();
    });
    // The answer is what must survive; `error` stays the query's and is not raised to a
    // page-fatal state by a refused write.
    expect(result.current.error).toBeNull();

    expect(result.current.statusConflict?.payload.answerText).toBe('God provided a job');
  });

  it('gives the refused answer back after a reload', async () => {
    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 0, 4));
    const { wrapper } = createWrapper();
    const first = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      await first.result.current
          .setStatus('p1', 'answered', 'God provided a job', 0, { status: 'active' })
          .acceptance.catch(() => {});
    });
    await waitFor(() => expect(first.result.current.statusConflict).not.toBeNull());
    first.unmount();

    const { wrapper: wrapper2 } = createWrapper();
    const second = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper: wrapper2 });

    expect(second.result.current.statusConflict?.payload.answerText).toBe('God provided a job');
  });

  it('keeps the refused answer out of the core slot', async () => {
    // Two aggregates, two slots. One shared slot would mean the answer replaces a
    // refused title (or the other way round) and one of them is gone.
    mockSetPrayerStatus.mockRejectedValueOnce(new StaleWriteError('status', 0, 4));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePrayerRequests('user-1', 'p1'), { wrapper });

    await act(async () => {
      await result.current.setStatus('p1', 'answered', 'God provided a job', 0).acceptance.catch(() => {});
    });

    await waitFor(() => expect(result.current.statusConflict).not.toBeNull());
    expect(result.current.saveConflict).toBeNull();
  });
});
