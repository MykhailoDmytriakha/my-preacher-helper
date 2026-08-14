import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';

import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Series, Sermon } from '@/models/models';
import { getGroupById } from '@/services/groups.service';
import { commitSeriesBatch, type SeriesTransform } from '@/services/seriesMembership.client';
import { OfflineQueuedError, StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { getSeriesById, updateSeries } from '@/services/series.service';
import { getSermonById } from '@/services/sermon.service';
import { toast } from 'sonner';
import { awaitAcceptance } from '@/utils/recoverableWrite';

// series.service no longer owns membership — add/remove/reorder go through the
// client playlist sweep (commitSeriesBatch). We mock the sweep commit and assert
// the SERIALIZABLE transforms it is fired with, keeping the pure transform logic
// (applySeriesTransform) real so optimistic cache math still runs.
jest.mock('@/services/series.service', () => ({
  getSeriesById: jest.fn(),
  updateSeries: jest.fn(),
}));

jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

jest.mock('@/services/groups.service', () => ({
  getGroupById: jest.fn(),
}));

jest.mock('@/services/seriesMembership.client', () => ({
  ...jest.requireActual('@/services/seriesMembership.client'),
  commitSeriesBatch: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'user-1', isAuthLoading: false }),
}));

// useServerFirstQuery consults useOnlineStatus and DISABLES the query offline.
jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(() => true),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));

// A late refusal is only read aloud to the person who wrote it — the reporter checks the
// live signed-in uid, because the closure outlives the page and can outlive the session.
jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'user-1' } },
}));

const mockGetSeriesById = getSeriesById as jest.MockedFunction<typeof getSeriesById>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const mockGetGroupById = getGroupById as jest.MockedFunction<typeof getGroupById>;
const mockUpdateSeries = updateSeries as jest.MockedFunction<typeof updateSeries>;
const mockCommitSeriesBatch = commitSeriesBatch as jest.MockedFunction<typeof commitSeriesBatch>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;

const lastTransforms = (): SeriesTransform[] =>
  mockCommitSeriesBatch.mock.calls[mockCommitSeriesBatch.mock.calls.length - 1][0];

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
      outline: { introduction: [], main: [], conclusion: [] },
      isPreached: false,
    },
    {
      id: 'sermon-2',
      title: 'Sermon 2',
      verse: 'Romans 8:28',
      date: '2024-01-08',
      userId: 'user-1',
      thoughts: [],
      outline: { introduction: [], main: [], conclusion: [] },
      isPreached: false,
    },
    { id: 'new-sermon-1', title: 'New Sermon One', verse: 'Psalm 1', date: '2024-01-15', userId: 'user-1', thoughts: [] },
    { id: 'new-sermon-2', title: 'New Sermon Two', verse: 'Psalm 2', date: '2024-01-22', userId: 'user-1', thoughts: [] },
  ];

  // Seed the ['series', uid] + ['sermons', uid] caches the sweep reads for
  // discovery/optimism (mirrors the series detail page, which mounts useSeries).
  const createWrapper = () => {
    const queryClient = new QueryClient({
      // gcTime must survive: the ['series', uid] discovery cache has no observer
      // in this isolated hook test, so gcTime:0 would evict it before a sweep reads it.
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
    });
    queryClient.setQueryData(['series', 'user-1'], [mockSeries]);
    queryClient.setQueryData(['sermons', 'user-1'], mockSermons);
    queryClient.setQueryData(['groups', 'user-1'], [
      { id: 'group-1', title: 'Group One' },
      { id: 'group-2', title: 'Group Two' },
    ]);

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // A refused save is persisted so it survives a reload — clear it between tests,
    // or one test's conflict is restored into the next one's fresh mount.
    localStorage.clear();
    mockGetSeriesById.mockResolvedValue(mockSeries);
    mockGetSermonById.mockImplementation((id) =>
      Promise.resolve(mockSermons.find((sermon) => sermon.id === id))
    );
    mockGetGroupById.mockResolvedValue(undefined);
    mockUpdateSeries.mockResolvedValue(mockSeries);
    mockCommitSeriesBatch.mockResolvedValue(undefined);
    mockUseOnlineStatus.mockReturnValue(true);
  });

  it('does NOT fetch while offline (useServerFirstQuery disables the query)', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

    // Offline: the read query is disabled, so the server fetch never runs and the
    // detail payload stays empty (the sweep relies on optimism + Firestore's queue).
    await Promise.resolve();
    expect(mockGetSeriesById).not.toHaveBeenCalled();
    expect(result.current.series).toBeNull();
  });

  it('fetches series detail payload on mount', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetSeriesById).toHaveBeenCalledWith('series-1');
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1');
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-2');
    expect(result.current.series).toMatchObject({ id: 'series-1', title: 'Test Series' });
    expect(result.current.sermons).toHaveLength(2);
    expect(result.current.items).toHaveLength(2);
  });

  it('does not fetch when seriesId is empty', async () => {
    const { result } = renderHook(() => useSeriesDetail(''), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(false);
    expect(mockGetSeriesById).not.toHaveBeenCalled();
    expect(result.current.series).toBeNull();
  });

  it('returns error when series is missing', async () => {
    mockGetSeriesById.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSeriesDetail('missing-series'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('Series not found');
  });

  it('adds one sermon into series via the client sweep', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addSermon('new-sermon-id', 2);
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    const transforms = lastTransforms();
    expect(transforms).toEqual([
      { seriesId: 'series-1', op: 'add', refs: [{ type: 'sermon', refId: 'new-sermon-id' }], position: 2 },
    ]);
  });

  it('adds multiple sermons in ONE union-sweep batch (no lost adds)', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addSermons(['new-sermon-1', 'new-sermon-2']);
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    // Exactly ONE batch, and the target 'add' carries BOTH refs (never 2 parallel sweeps).
    expect(mockCommitSeriesBatch).toHaveBeenCalledTimes(1);
    const transforms = lastTransforms();
    const addTransform = transforms.find((t) => t.op === 'add');
    expect(addTransform).toBeDefined();
    expect(addTransform && 'refs' in addTransform ? addTransform.refs : []).toEqual([
      { type: 'sermon', refId: 'new-sermon-1' },
      { type: 'sermon', refId: 'new-sermon-2' },
    ]);
  });

  it.each([
    ['sermon', () => ['new-sermon-1', 'new-sermon-2'], (hook: ReturnType<typeof useSeriesDetail>) => hook.addSermons(['new-sermon-1', 'new-sermon-2'])],
    ['group', () => ['group-1', 'group-2'], (hook: ReturnType<typeof useSeriesDetail>) => hook.addGroups(['group-1', 'group-2'])],
  ] as const)(
    'reports a terminally refused %s membership change once with titled recovery text',
    async (_type, exactIds, submit) => {
      mockCommitSeriesBatch.mockRejectedValueOnce(
        Object.assign(new Error('Permission denied'), { code: 'permission-denied', name: 'FirebaseError' })
      );
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => submit(result.current));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            duration: Infinity,
            description: expect.stringContaining(
              _type === 'sermon' ? 'New Sermon One, New Sermon Two' : 'Group One, Group Two'
            ),
            action: expect.objectContaining({ onClick: expect.any(Function) }),
          })
        )
      );

      // A rules refusal offers copy, not a futile retry. The writer owns the one
      // report; the former page-local subscription must not add a second toast.
      expect((toast.error as jest.Mock).mock.calls).toHaveLength(1);
      expect((toast.error as jest.Mock).mock.calls[0][1].action.label).toBe('freshness.copyTextAction');
    }
  );

  it.each([
    ['remove', (hook: ReturnType<typeof useSeriesDetail>) => hook.removeItem('sermon', 'sermon-1')],
    ['reorder', (hook: ReturnType<typeof useSeriesDetail>) => hook.reorderMixedItems(hook.items.map((entry) => entry.item.id).reverse())],
  ] as const)('reports a terminally refused membership %s with affected item titles', async (_operation, submit) => {
    mockCommitSeriesBatch.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'permission-denied', name: 'FirebaseError' })
    );
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => submit(result.current));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'writeRecovery.refused',
        expect.objectContaining({ description: expect.stringContaining('Sermon') })
      )
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sermon', (hook: ReturnType<typeof useSeriesDetail>) => hook.addSermons(['queued-sermon'])],
    ['group', (hook: ReturnType<typeof useSeriesDetail>) => hook.addGroups(['queued-group'])],
  ] as const)('does not report a pending %s membership change as a failure', async (_type, submit) => {
    mockCommitSeriesBatch.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => submit(result.current));
    await act(async () => Promise.resolve());

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('removes a sermon via a sweep-all remove transform', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.removeSermon('sermon-1');
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    const transforms = lastTransforms();
    expect(transforms).toContainEqual({
      seriesId: 'series-1',
      op: 'remove',
      refs: [{ type: 'sermon', refId: 'sermon-1' }],
    });
  });

  it('reorders sermons via a single-doc reorder transform', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.reorderSeriesSermons(['sermon-2', 'sermon-1']);
    });

    await waitFor(() => expect(mockCommitSeriesBatch).toHaveBeenCalled());
    const transforms = lastTransforms();
    expect(transforms).toHaveLength(1);
    expect(transforms[0].op).toBe('reorder');
    expect(transforms[0].seriesId).toBe('series-1');
    expect(transforms[0].op === 'reorder' ? transforms[0].itemIds : []).toHaveLength(2);
  });

  it('updates series metadata through the own-doc client update', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateSeriesDetail({ title: 'Updated title' }).acceptance;
    });

    // Third argument = the revision this edit was built from, so a save from a
    // tab that never saw another device's change is refused, not applied.
    expect(mockUpdateSeries).toHaveBeenCalledWith('series-1', { title: 'Updated title' }, 0, null);
  });

  it('keeps the rendered editor and its exact draft mounted after a rules refusal', async () => {
    mockUpdateSeries.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'permission-denied', name: 'FirebaseError' })
    );

    function RenderedSeriesEditor() {
      const detail = useSeriesDetail('series-1');
      const [title, setTitle] = useState('Test Series');
      const [saveError, setSaveError] = useState('');

      if (detail.loading) return <p>Loading series</p>;
      if (detail.error) return <p>Series load failed</p>;
      if (!detail.series) return null;

      return (
        <div role="dialog" aria-label="Edit series">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setSaveError('');
              try {
                await awaitAcceptance(detail.updateSeriesDetail({ title }), () => undefined);
              } catch {
                setSaveError('Save refused');
              }
            }}
          >
            <label htmlFor="rendered-series-title">Series title</label>
            <input
              id="rendered-series-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit">Save rendered series</button>
            {saveError && <p role="alert">{saveError}</p>}
          </form>
        </div>
      );
    }

    render(<RenderedSeriesEditor />, { wrapper: createWrapper() });
    const title = await screen.findByLabelText('Series title');
    fireEvent.change(title, { target: { value: 'Exact refused rendered series title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rendered series' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save refused');
    expect(screen.getByRole('dialog', { name: 'Edit series' })).toBeInTheDocument();
    expect(screen.getByLabelText('Series title')).toHaveValue(
      'Exact refused rendered series title'
    );
    expect(screen.queryByText('Series load failed')).not.toBeInTheDocument();
  });

  it('refreshes data on demand', async () => {
    const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refreshSeriesDetail();
    });

    expect(mockGetSeriesById).toHaveBeenCalledTimes(2);
  });

  /** A refusal stays in the open editor and also survives reload as an offer. */
  describe('a refused save is held and can be resolved', () => {
    it('rejects to keep the editor open while retaining the exact refused payload', async () => {
      mockUpdateSeries.mockRejectedValueOnce(new StaleWriteError('meta', 0, 6));
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateSeriesDetail({
            title: 'Typed on the laptop',
            description: 'Exact series description',
          }).acceptance
        ).rejects.toBeInstanceOf(StaleWriteError);
      });

      expect(result.current.saveConflict).toEqual({
        payload: {
          title: 'Typed on the laptop',
          description: 'Exact series description',
        },
        actualRevision: 6,
      });
      // NO toast: the conflict banner set above says the same thing, holds this text and
      // offers the two choices. Since a conflict now closes the editor, a toast beside the
      // banner made one conflict look like two problems.
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('SAYS a permission refusal, because no descriptor watches this write', async () => {
      /**
       * The series LIST saves through a mutation, so `useSeries`' recovery descriptor
       * speaks for it — and `EditSeriesModal` was written to stay silent because of that.
       * The DETAIL page writes directly: no mutation, no descriptor. The production path
       * therefore refused the edit and told the person nothing at all.
       */
      mockUpdateSeries.mockRejectedValueOnce(
        Object.assign(new Error('Missing or insufficient permissions.'), {
          code: 'permission-denied',
        })
      );
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateSeriesDetail({
            title: 'Series title that was refused',
            description: 'And the description with it',
          }).acceptance
        ).rejects.toMatchObject({ code: 'permission-denied' });
      });

      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      // The person's own words come back with it — that is what makes it recoverable.
      const options = (toast.error as jest.Mock).mock.calls[0][1] as { description?: string };
      expect(options.description).toContain('Series title that was refused');
      expect(options.description).toContain('And the description with it');
    });

    it('does NOT read that refusal to whoever signs in next', async () => {
      /**
       * The refusal can land after sign-out: this reporter lives in a promise closure that
       * outlives the page, and the sign-out sweep already ran before the message existed.
       * On a shared computer that would read one person's series title, description and
       * colour to the next — with a button to copy them.
       */
      const { auth } = jest.requireMock('@services/firebaseAuth.service') as {
        auth: { currentUser: { uid: string } | null };
      };
      const author = auth.currentUser;
      // THE ORDER IS THE POINT: the write is sent while the author is signed in, and the
      // account changes only in the gap before the refusal comes back. Switching the user
      // beforehand would test a case that never happens and prove nothing about the race.
      let refuse: (error: unknown) => void = () => undefined;
      mockUpdateSeries.mockImplementationOnce(
        () => new Promise((_resolve, reject) => {
          refuse = reject;
        })
      );
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      try {
        let acceptance: Promise<unknown> = Promise.resolve();
        await act(async () => {
          acceptance = result.current.updateSeriesDetail({ title: 'Private series title' })
            .acceptance;
          void acceptance.catch(() => undefined);
        });
        expect(auth.currentUser).toEqual(author);

        // Somebody else is at the keyboard by the time the server answers.
        auth.currentUser = { uid: 'someone-else' };
        await act(async () => {
          refuse(
            Object.assign(new Error('Missing or insufficient permissions.'), {
              code: 'permission-denied',
            })
          );
          await expect(acceptance).rejects.toMatchObject({ code: 'permission-denied' });
        });

        expect(toast.error).not.toHaveBeenCalled();
      } finally {
        auth.currentUser = author;
      }
    });

    it('accepts an exact outbox-queued edit silently so the modal can close normally', async () => {
      mockUpdateSeries.mockRejectedValueOnce(new OfflineQueuedError('meta'));
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateSeriesDetail({ title: 'Queued exact series title' }).acceptance
        ).resolves.toMatchObject({ kind: 'queued' });
      });

      expect(toast.error).not.toHaveBeenCalled();
      expect(result.current.saveConflict).toBeNull();
    });


    it('states the revision the FORM was opened with, not the live one', async () => {
      // The modal keeps the text it opened with. If a focus refetch advances the
      // page object meanwhile, saving with the LIVE revision pairs fresh
      // permission with stale text and compare-and-set waves it through — the
      // overwrite the guard exists to refuse.
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateSeriesDetail({ title: 'Typed in a form opened earlier' }, 3).acceptance;
      });

      expect(mockUpdateSeries).toHaveBeenCalledWith(
        'series-1',
        { title: 'Typed in a form opened earlier' },
        3,
        null
      );
    });

    it('states the VALUES the form opened with, so a frozen counter cannot wave a stale save through', async () => {
      // The scenario the disabled Firestore rule cannot catch: an old installed PWA
      // changes the series title WITHOUT advancing `rev.meta`. Hours later this
      // client saves from the same number — the counter agrees, and only comparing
      // the values the form started from stops the phone's title being replaced.
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateSeriesDetail({ title: 'Typed on the laptop' }, 0, {
          title: 'the title this form opened with',
        }).acceptance;
      });

      expect(mockUpdateSeries).toHaveBeenCalledWith(
        'series-1',
        { title: 'Typed on the laptop' },
        0,
        { title: 'the title this form opened with' }
      );
    });

    it('re-sends with the server revision when "keep mine" is chosen', async () => {
      mockUpdateSeries.mockRejectedValueOnce(new StaleWriteError('meta', 0, 6));
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateSeriesDetail({ title: 'Typed on the laptop' }).acceptance
        ).rejects.toBeInstanceOf(StaleWriteError);
      });

      mockUpdateSeries.mockResolvedValueOnce(mockSeries);
      await act(async () => {
        await result.current.keepMineOnConflict();
      });

      // 6, NOT 0: resending the original revision would be refused again, and the
      // button would promise an action it never performs.
      // And NO baseline: the person saw the other version and chose their own, so
      // comparing content here would refuse the very act they just confirmed.
      expect(mockUpdateSeries).toHaveBeenLastCalledWith(
        'series-1',
        { title: 'Typed on the laptop' },
        6,
        null
      );
      expect(result.current.saveConflict).toBeNull();
    });

    it('drops the refused edit and reloads when "take theirs" is chosen', async () => {
      mockUpdateSeries.mockRejectedValueOnce(new StaleWriteError('meta', 0, 6));
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.updateSeriesDetail({ title: 'Typed on the laptop' }).acceptance
        ).rejects.toBeInstanceOf(StaleWriteError);
      });

      // There must BE something to choose about — otherwise this test would pass
      // even against a build that drops refused edits on the floor.
      expect(result.current.saveConflict).not.toBeNull();

      const callsBefore = mockGetSeriesById.mock.calls.length;
      await act(async () => {
        await result.current.takeTheirsOnConflict();
      });

      expect(mockGetSeriesById.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(result.current.saveConflict).toBeNull();
    });

    it('leaves no conflict behind when the save goes through', async () => {
      const { result } = renderHook(() => useSeriesDetail('series-1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateSeriesDetail({ title: 'Updated title' }).acceptance;
      });

      expect(result.current.saveConflict).toBeNull();
    });
  });

});
