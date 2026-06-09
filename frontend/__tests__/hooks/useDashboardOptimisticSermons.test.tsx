import { QueryClient, QueryClientProvider, dehydrate, hydrate, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useDashboardOptimisticSermons } from '@/hooks/useDashboardOptimisticSermons';
import { registerOfflineMutationDefaults } from '@/utils/mutationDefaults';
import type { Sermon } from '@/models/models';

const mockCreateSermon = jest.fn();
const mockUpdateSermon = jest.fn();
const mockDeleteSermon = jest.fn();
const mockAddPreachDate = jest.fn();
const mockUpdatePreachDate = jest.fn();
const mockDeletePreachDate = jest.fn();

jest.mock('@services/firebaseAuth.service', () => ({
  auth: {
    currentUser: { uid: 'user-1' },
  },
}));

jest.mock('@services/sermon.service', () => ({
  createSermon: (...args: unknown[]) => mockCreateSermon(...args),
  updateSermon: (...args: unknown[]) => mockUpdateSermon(...args),
  deleteSermon: (...args: unknown[]) => mockDeleteSermon(...args),
}));

jest.mock('@services/preachDates.service', () => ({
  addPreachDate: (...args: unknown[]) => mockAddPreachDate(...args),
  updatePreachDate: (...args: unknown[]) => mockUpdatePreachDate(...args),
  deletePreachDate: (...args: unknown[]) => mockDeletePreachDate(...args),
}));

const { auth: mockAuth } = jest.requireMock('@services/firebaseAuth.service') as {
  auth: { currentUser: { uid: string } | null };
};

const createTestQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
        // Mirror production (QueryProvider): the first attempt runs, an offline
        // failure pauses the mutation instead of erroring it.
        networkMode: 'offlineFirst',
      },
    },
  });
  // The hook's mutations are bare {mutationKey} consumers — mutationFn and all
  // cache handlers live in the registered defaults, exactly like production.
  registerOfflineMutationDefaults(queryClient);
  return queryClient;
};

// For the offline-pause tests: pausing happens BETWEEN retries (no retries ->
// an offline failure errors out instead of pausing), so these need
// production's retry>0 — with zero delay to keep the tests fast.
const createOfflineTestQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: 5,
        retryDelay: 0,
        networkMode: 'offlineFirst',
      },
    },
  });
  registerOfflineMutationDefaults(queryClient);
  return queryClient;
};

const createSermon = (id: string, overrides: Partial<Sermon> = {}): Sermon => ({
  id,
  title: `Sermon ${id}`,
  verse: 'John 3:16',
  date: '2026-02-10T10:00:00.000Z',
  thoughts: [],
  userId: 'user-1',
  ...overrides,
});

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const getCachedSermons = (queryClient: QueryClient): Sermon[] => {
  const scoped = queryClient.getQueryData<Sermon[]>(['sermons', 'user-1']);
  if (Array.isArray(scoped)) {
    return scoped;
  }

  const sermonQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['sermons'] })
    .map((query) => query.state.data as Sermon[] | undefined)
    .filter((data): data is Sermon[] => Array.isArray(data));

  if (sermonQueries.length === 0) return [];

  const nonEmpty = sermonQueries.find((data) => data.length > 0);
  return nonEmpty ?? sermonQueries[0];
};

const setCachedSermons = (queryClient: QueryClient, sermons: Sermon[]) => {
  queryClient.setQueryData<Sermon[]>(['sermons', 'user-1'], sermons);
  queryClient.setQueryData<Sermon[]>(['sermons', undefined], sermons);
};

describe('useDashboardOptimisticSermons', () => {
  beforeEach(() => {
    mockAuth.currentUser = { uid: 'user-1' };
    mockCreateSermon.mockReset();
    mockUpdateSermon.mockReset();
    mockDeleteSermon.mockReset();
    mockAddPreachDate.mockReset();
    mockUpdatePreachDate.mockReset();
    mockDeletePreachDate.mockReset();
  });

  it('creates a sermon with a client id and reconciles it with the persisted sermon', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const createFlow = createDeferred<Sermon>();
    mockCreateSermon.mockReturnValueOnce(createFlow.promise);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    let createdId: string | undefined;
    await act(async () => {
      createdId = await result.current.actions.createSermon({
        title: 'Optimistic Sermon',
        verse: 'Psalm 1',
      });
    });

    // The optimistic row carries the client-generated id (not a temp- placeholder),
    // so navigation and idempotent server replay both reference the same id.
    const cacheAfterAction = getCachedSermons(queryClient);
    expect(cacheAfterAction).toHaveLength(1);
    expect(createdId).toBeTruthy();
    expect(cacheAfterAction[0].id).toBe(createdId);
    expect(cacheAfterAction[0].id.startsWith('temp-sermon-')).toBe(false);
    // The badge map is derived from the mutation cache via useMutationState,
    // whose subscription notifies on the next tick — poll instead of reading
    // synchronously.
    await waitFor(() => {
      expect(result.current.syncStatesById[createdId as string]?.status).toBe('pending');
    });

    // The server echoes the same id back (idempotent create).
    const persisted = createSermon(createdId as string, { title: 'Persisted Sermon' });
    await act(async () => {
      createFlow.resolve(persisted);
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient);
      expect(cache).toHaveLength(1);
      expect(cache[0].id).toBe(createdId);
      expect(cache[0].title).toBe('Persisted Sermon');
      expect(result.current.syncStatesById[createdId as string]).toBeUndefined();
    });
  });

  it('rolls back optimistic edit on failure and allows retry', async () => {
    const queryClient = createTestQueryClient();
    setCachedSermons(queryClient, [createSermon('sermon-1')]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const updateFlow = createDeferred<Sermon | null>();
    mockUpdateSermon.mockReturnValueOnce(updateFlow.promise);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });
    const original = getCachedSermons(queryClient)[0];

    await act(async () => {
      await result.current.actions.saveEditedSermon({
        sermon: original,
        title: 'Updated Title',
        verse: original.verse,
        plannedDate: '',
        initialPlannedDate: '',
      });
    });

    expect(getCachedSermons(queryClient)[0].title).toBe('Updated Title');

    await act(async () => {
      updateFlow.resolve(null);
    });

    await waitFor(() => {
      expect(result.current.syncStatesById['sermon-1']?.status).toBe('error');
      expect(getCachedSermons(queryClient)[0].title).toBe(original.title);
    });

    mockUpdateSermon.mockResolvedValueOnce({ ...original, title: 'Updated Title' });

    await act(async () => {
      await result.current.actions.retrySync('sermon-1');
    });

    await waitFor(() => {
      expect(getCachedSermons(queryClient)[0].title).toBe('Updated Title');
      expect(result.current.syncStatesById['sermon-1']).toBeUndefined();
    });
  });

  it('dismisses failed temporary create and removes it from cache', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    mockCreateSermon.mockRejectedValueOnce(new Error('Network down'));

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.createSermon({
        title: 'Will Fail',
        verse: 'Mark 1',
      });
    });

    let tempId = '';
    await waitFor(() => {
      const ids = Object.keys(result.current.syncStatesById);
      expect(ids).toHaveLength(1);
      tempId = ids[0];
      expect(result.current.syncStatesById[tempId]?.status).toBe('error');
    });

    await act(async () => {
      result.current.actions.dismissSyncError(tempId);
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient);
      expect(cache.find((sermon) => sermon.id === tempId)).toBeUndefined();
      expect(result.current.syncStatesById[tempId]).toBeUndefined();
    });
  });

  it('uses guest uid from localStorage and persists planned date on optimistic create', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    mockAuth.currentUser = null;
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-42' }));

    mockCreateSermon.mockResolvedValueOnce(
      createSermon('sermon-guest-1', { title: 'Guest Sermon', userId: 'guest-42' })
    );
    mockAddPreachDate.mockResolvedValueOnce({
      id: 'pd-created',
      date: '2026-05-12',
      status: 'planned',
      church: { id: 'church-unspecified', name: 'Guest Church', city: '' },
      createdAt: '2026-02-10T10:00:00.000Z',
    });

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.createSermon({
        title: 'Guest Sermon',
        verse: 'Psalm 23',
        plannedDate: '2026-05-12',
        unspecifiedChurchName: 'Guest Church',
      });
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient);
      expect(cache).toHaveLength(1);
      expect(cache[0].id).toBe('sermon-guest-1');
      expect(cache[0].userId).toBe('guest-42');
      expect(cache[0].preachDates?.[0]).toEqual(
        expect.objectContaining({ id: 'pd-created', date: '2026-05-12', status: 'planned' })
      );
      expect(result.current.syncStatesById['sermon-guest-1']).toBeUndefined();
    });

    expect(mockCreateSermon).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'guest-42',
        title: 'Guest Sermon',
      })
    );
  });

  it('does nothing on create when uid cannot be resolved', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    mockAuth.currentUser = null;
    window.localStorage.removeItem('guestUser');

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.createSermon({
        title: 'No UID',
        verse: 'John 1:1',
      });
    });

    expect(mockCreateSermon).not.toHaveBeenCalled();
    expect(getCachedSermons(queryClient)).toEqual([]);
  });

  it('adds planned date during optimistic edit when sermon had no planned date', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-2');
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockUpdateSermon.mockResolvedValueOnce({ ...original, title: 'Edited' });
    mockAddPreachDate.mockResolvedValueOnce({
      id: 'pd-added',
      date: '2026-06-01',
      status: 'planned',
      church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
      createdAt: '2026-02-10T10:00:00.000Z',
    });

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.saveEditedSermon({
        sermon: original,
        title: 'Edited',
        verse: original.verse,
        plannedDate: '2026-06-01',
        initialPlannedDate: '',
      });
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient);
      expect(cache[0].title).toBe('Edited');
      expect(cache[0].preachDates?.[0]).toEqual(
        expect.objectContaining({ id: 'pd-added', date: '2026-06-01' })
      );
      expect(result.current.syncStatesById['sermon-2']).toBeUndefined();
    });

    expect(mockAddPreachDate).toHaveBeenCalled();
    expect(mockDeletePreachDate).not.toHaveBeenCalled();
  });

  it('removes planned date during optimistic edit when plannedDate is cleared', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-3', {
      preachDates: [
        {
          id: 'pd-existing',
          date: '2026-07-01',
          status: 'planned',
          church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
          createdAt: '2026-02-10T10:00:00.000Z',
        },
      ],
    });
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockUpdateSermon.mockResolvedValueOnce({ ...original, verse: 'Romans 1:1' });
    mockDeletePreachDate.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.saveEditedSermon({
        sermon: original,
        title: original.title,
        verse: 'Romans 1:1',
        plannedDate: '',
        initialPlannedDate: '2026-07-01',
      });
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient);
      expect(cache[0].verse).toBe('Romans 1:1');
      expect(cache[0].preachDates).toEqual([]);
      expect(result.current.syncStatesById['sermon-3']).toBeUndefined();
    });

    expect(mockDeletePreachDate).toHaveBeenCalledWith('sermon-3', 'pd-existing');
  });

  it('skips second optimistic edit while first update is pending', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-4');
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const updateFlow = createDeferred<Sermon | null>();
    mockUpdateSermon.mockReturnValueOnce(updateFlow.promise);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.saveEditedSermon({
        sermon: original,
        title: 'First',
        verse: original.verse,
        plannedDate: '',
        initialPlannedDate: '',
      });
    });

    await act(async () => {
      await result.current.actions.saveEditedSermon({
        sermon: original,
        title: 'Second',
        verse: original.verse,
        plannedDate: '',
        initialPlannedDate: '',
      });
    });

    expect(mockUpdateSermon).toHaveBeenCalledTimes(1);

    await act(async () => {
      updateFlow.resolve({ ...original, title: 'First' });
    });

    await waitFor(() => {
      expect(getCachedSermons(queryClient)[0].title).toBe('First');
      expect(result.current.syncStatesById['sermon-4']).toBeUndefined();
    });
  });

  it('keeps sermon on delete failure and removes it after retry', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-delete');
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockDeleteSermon.mockRejectedValueOnce(new Error('delete failed'));
    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.deleteSermon(original);
    });

    await waitFor(() => {
      expect(result.current.syncStatesById['sermon-delete']?.status).toBe('error');
      expect(getCachedSermons(queryClient)).toHaveLength(1);
    });

    mockDeleteSermon.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.actions.retrySync('sermon-delete');
    });

    await waitFor(() => {
      expect(getCachedSermons(queryClient)).toHaveLength(0);
      expect(result.current.syncStatesById['sermon-delete']).toBeUndefined();
    });
  });

  it('rolls back preached status on failure and succeeds after retry', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-preached', {
      preachDates: [
        {
          id: 'pd-plan',
          date: '2026-07-20',
          status: 'planned',
          church: { id: 'c1', name: 'Church', city: 'City' },
          createdAt: '2026-02-10T10:00:00.000Z',
        },
      ],
    });
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockUpdatePreachDate.mockResolvedValue(undefined);
    mockUpdateSermon.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.markAsPreachedFromPreferred(original, original.preachDates![0]);
    });

    await waitFor(() => {
      expect(result.current.syncStatesById['sermon-preached']?.status).toBe('error');
      expect(getCachedSermons(queryClient)[0].isPreached).toBeUndefined();
      expect(getCachedSermons(queryClient)[0].preachDates?.[0].status).toBe('planned');
    });

    mockUpdateSermon.mockResolvedValueOnce({ ...original, isPreached: true });

    await act(async () => {
      await result.current.actions.retrySync('sermon-preached');
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient)[0];
      expect(cache.isPreached).toBe(true);
      expect(cache.preachDates?.[0].status).toBe('preached');
      expect(result.current.syncStatesById['sermon-preached']).toBeUndefined();
    });
  });

  it('unmarks preached dates and switches them to planned', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-unmark', {
      isPreached: true,
      preachDates: [
        {
          id: 'pd-1',
          date: '2026-08-01',
          status: 'preached',
          church: { id: 'c1', name: 'Church', city: 'City' },
          createdAt: '2026-02-10T10:00:00.000Z',
        },
        {
          id: 'pd-2',
          date: '2026-08-05',
          status: 'preached',
          church: { id: 'c2', name: 'Church 2', city: 'City 2' },
          createdAt: '2026-02-10T10:00:00.000Z',
        },
      ],
    });
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockUpdatePreachDate.mockResolvedValue(undefined);
    mockUpdateSermon.mockResolvedValueOnce({
      ...original,
      isPreached: false,
      preachDates: original.preachDates,
    });

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.unmarkAsPreached(original);
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient)[0];
      expect(cache.isPreached).toBe(false);
      expect(cache.preachDates?.every((pd) => pd.status === 'planned')).toBe(true);
      expect(result.current.syncStatesById['sermon-unmark']).toBeUndefined();
    });

    expect(mockUpdatePreachDate).toHaveBeenCalledTimes(2);
  });

  it('rolls back savePreachDate failure and recovers on retry for existing date', async () => {
    const queryClient = createTestQueryClient();
    const original = createSermon('sermon-save-date', {
      preachDates: [
        {
          id: 'pd-existing',
          date: '2026-09-01',
          status: 'planned',
          church: { id: 'c1', name: 'Church', city: 'City' },
          createdAt: '2026-02-10T10:00:00.000Z',
        },
      ],
    });
    setCachedSermons(queryClient, [original]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockUpdatePreachDate.mockRejectedValueOnce(new Error('save-preach-failed'));

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.savePreachDate(
        original,
        {
          date: '2026-09-02',
          status: 'preached',
          church: { id: 'c1', name: 'Church', city: 'City' },
        },
        original.preachDates![0]
      );
    });

    await waitFor(() => {
      expect(result.current.syncStatesById['sermon-save-date']?.status).toBe('error');
      expect(getCachedSermons(queryClient)[0].preachDates?.[0].status).toBe('planned');
    });

    mockUpdatePreachDate.mockResolvedValueOnce({
      id: 'pd-existing',
      date: '2026-09-02',
      status: 'preached',
      church: { id: 'c1', name: 'Church', city: 'City' },
      createdAt: '2026-02-10T10:00:00.000Z',
    });
    mockUpdateSermon.mockResolvedValueOnce({
      ...original,
      isPreached: true,
      preachDates: original.preachDates,
    });

    await act(async () => {
      await result.current.actions.retrySync('sermon-save-date');
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient)[0];
      expect(cache.isPreached).toBe(true);
      expect(cache.preachDates?.[0]).toEqual(expect.objectContaining({ status: 'preached', date: '2026-09-02' }));
      expect(result.current.syncStatesById['sermon-save-date']).toBeUndefined();
    });
  });

  it('ignores dismiss on pending sync and ignores retry for unknown id', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const createFlow = createDeferred<Sermon>();
    mockCreateSermon.mockReturnValueOnce(createFlow.promise);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.createSermon({
        title: 'Pending Sermon',
        verse: 'Mark 1:1',
      });
    });

    let tempId = '';
    await waitFor(() => {
      const ids = Object.keys(result.current.syncStatesById);
      expect(ids).toHaveLength(1);
      tempId = ids[0];
      expect(result.current.syncStatesById[tempId]?.status).toBe('pending');
    });

    await act(async () => {
      result.current.actions.dismissSyncError(tempId);
      await result.current.actions.retrySync('missing-id');
    });

    expect(result.current.syncStatesById[tempId]?.status).toBe('pending');

    await act(async () => {
      createFlow.resolve(createSermon('sermon-pending-done'));
    });
  });

  // The guarantees the persisted-mutation mechanism adds over the old
  // hand-rolled retry closures: offline ops pause (instead of erroring),
  // auto-replay on reconnect, survive a reload, and replay in submission
  // order — including the old mechanism's data-loss case where an offline
  // edit of an offline-created sermon overwrote the create's retry closure.
  describe('offline persistence (mechanism B semantics)', () => {
    afterEach(() => {
      act(() => {
        onlineManager.setOnline(true);
      });
    });

    it('pauses an offline edit (pending badge, no server call) and replays it on reconnect', async () => {
      const queryClient = createOfflineTestQueryClient();
      const original = createSermon('sermon-offline');
      setCachedSermons(queryClient, [original]);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      act(() => {
        onlineManager.setOnline(false);
      });
      // offlineFirst: the first attempt runs, fails (offline), then pauses.
      mockUpdateSermon.mockRejectedValueOnce(new Error('network down'));

      const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

      await act(async () => {
        await result.current.actions.saveEditedSermon({
          sermon: original,
          title: 'Offline Title',
          verse: original.verse,
          plannedDate: '',
          initialPlannedDate: '',
        });
      });

      // Optimistic edit applied; the op is queued (pending), NOT an error.
      expect(getCachedSermons(queryClient)[0].title).toBe('Offline Title');
      await waitFor(() => {
        expect(result.current.syncStatesById['sermon-offline']?.status).toBe('pending');
      });
      const paused = queryClient.getMutationCache().getAll();
      expect(paused).toHaveLength(1);
      expect(paused[0].state.isPaused).toBe(true);

      mockUpdateSermon.mockResolvedValueOnce({ ...original, title: 'Offline Title' });
      act(() => {
        onlineManager.setOnline(true);
      });

      await waitFor(() => {
        expect(mockUpdateSermon).toHaveBeenCalledTimes(2);
        expect(result.current.syncStatesById['sermon-offline']).toBeUndefined();
        expect(getCachedSermons(queryClient)[0].title).toBe('Offline Title');
      });
    });

    it('replays a paused offline edit after a simulated reload (dehydrate -> hydrate -> resume)', async () => {
      const clientA = createOfflineTestQueryClient();
      const original = createSermon('sermon-reload');
      setCachedSermons(clientA, [original]);
      const wrapperA = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={clientA}>{children}</QueryClientProvider>
      );

      act(() => {
        onlineManager.setOnline(false);
      });
      mockUpdateSermon.mockRejectedValueOnce(new Error('network down'));

      const { result, unmount } = renderHook(() => useDashboardOptimisticSermons(), { wrapper: wrapperA });
      await act(async () => {
        await result.current.actions.saveEditedSermon({
          sermon: original,
          title: 'Survives Reload',
          verse: original.verse,
          plannedDate: '',
          initialPlannedDate: '',
        });
      });
      await waitFor(() => {
        expect(clientA.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
      });

      // Simulated reload: dehydrate with the same predicate QueryProvider uses,
      // hydrate into a FRESH client whose only knowledge is the registered
      // defaults (the in-memory closures are gone — like after a real reload).
      const dehydrated = dehydrate(clientA, {
        shouldDehydrateQuery: (query) => query.state.status === 'success',
        shouldDehydrateMutation: (mutation) =>
          mutation.state.status === 'pending' || mutation.state.isPaused || mutation.state.status === 'error',
      });
      // The "old tab" dies with the reload: unmount its hook and drop its
      // caches so it cannot also resume the paused mutation on reconnect.
      unmount();
      clientA.clear();
      const clientB = createOfflineTestQueryClient();
      hydrate(clientB, dehydrated);

      act(() => {
        onlineManager.setOnline(true);
      });
      mockUpdateSermon.mockResolvedValueOnce({ ...original, title: 'Survives Reload' });

      await act(async () => {
        await clientB.resumePausedMutations();
      });

      // Replayed with the SAME persisted variables, and the defaults' onSuccess
      // reconciled the fresh client's list cache.
      expect(mockUpdateSermon).toHaveBeenCalledTimes(2);
      expect(mockUpdateSermon).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'sermon-reload', title: 'Survives Reload' })
      );
      const reloadedList = clientB.getQueryData<Sermon[]>(['sermons', 'user-1']);
      expect(reloadedList?.[0].title).toBe('Survives Reload');
    });

    it('replays an offline create then edit of the SAME sermon in submission order (old mechanism lost the create)', async () => {
      const queryClient = createOfflineTestQueryClient();
      setCachedSermons(queryClient, []);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      act(() => {
        onlineManager.setOnline(false);
      });
      mockCreateSermon.mockRejectedValueOnce(new Error('network down'));

      const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

      let createdId: string | undefined;
      await act(async () => {
        createdId = await result.current.actions.createSermon({ title: 'Offline Created', verse: 'V' });
      });
      await waitFor(() => {
        expect(queryClient.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
      });

      // Edit the still-unsynced optimistic row while offline: queues a SECOND
      // mutation (paused offline ops deliberately don't block new edits).
      const optimisticRow = getCachedSermons(queryClient).find((sermon) => sermon.id === createdId);
      expect(optimisticRow).toBeTruthy();
      mockUpdateSermon.mockRejectedValueOnce(new Error('network down'));
      await act(async () => {
        await result.current.actions.saveEditedSermon({
          sermon: optimisticRow as Sermon,
          title: 'Edited Offline',
          verse: 'V',
          plannedDate: '',
          initialPlannedDate: '',
        });
      });
      await waitFor(() => {
        expect(queryClient.getMutationCache().getAll()).toHaveLength(2);
      });

      const replayOrder: string[] = [];
      mockCreateSermon.mockImplementationOnce(async () => {
        replayOrder.push('create');
        return { ...(optimisticRow as Sermon), title: 'Offline Created' };
      });
      mockUpdateSermon.mockImplementationOnce(async () => {
        replayOrder.push('update');
        return { ...(optimisticRow as Sermon), title: 'Edited Offline' };
      });

      act(() => {
        onlineManager.setOnline(true);
      });

      await waitFor(() => {
        // Create replays BEFORE the edit (serial, submission order) — the old
        // retryActionsRef keyed by sermonId would have dropped the create.
        expect(replayOrder).toEqual(['create', 'update']);
        expect(result.current.syncStatesById[createdId as string]).toBeUndefined();
        expect(getCachedSermons(queryClient)[0].title).toBe('Edited Offline');
      });
    });
  });
});
