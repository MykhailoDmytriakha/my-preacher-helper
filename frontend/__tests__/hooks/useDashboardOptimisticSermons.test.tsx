import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useDashboardOptimisticSermons } from '@/hooks/useDashboardOptimisticSermons';
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

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

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

  it('creates temporary sermon immediately and replaces it with persisted sermon', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const persisted = createSermon('sermon-real-1', { title: 'Persisted Sermon' });
    const createFlow = createDeferred<Sermon>();
    mockCreateSermon.mockReturnValueOnce(createFlow.promise);

    const { result } = renderHook(() => useDashboardOptimisticSermons(), { wrapper });

    await act(async () => {
      await result.current.actions.createSermon({
        title: 'Optimistic Sermon',
        verse: 'Psalm 1',
      });
    });

    const cacheAfterAction = getCachedSermons(queryClient);
    expect(cacheAfterAction).toHaveLength(1);
    expect(cacheAfterAction[0].id.startsWith('temp-sermon-')).toBe(true);
    expect(result.current.syncStatesById[cacheAfterAction[0].id]?.status).toBe('pending');

    await act(async () => {
      createFlow.resolve(persisted);
    });

    await waitFor(() => {
      const cache = getCachedSermons(queryClient);
      expect(cache).toHaveLength(1);
      expect(cache[0].id).toBe('sermon-real-1');
      expect(cache[0].title).toBe('Persisted Sermon');
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

    const tempId = Object.keys(result.current.syncStatesById)[0];
    expect(result.current.syncStatesById[tempId]?.status).toBe('pending');

    await act(async () => {
      result.current.actions.dismissSyncError(tempId);
      await result.current.actions.retrySync('missing-id');
    });

    expect(result.current.syncStatesById[tempId]?.status).toBe('pending');

    await act(async () => {
      createFlow.resolve(createSermon('sermon-pending-done'));
    });
  });
});
