import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { auth } from '@/services/firebaseAuth.service';
import { sermonDetailKey } from '@/utils/queryKeys';
import { getSermonById } from '@services/sermon.service';

import useSermon from '../useSermon';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const defaultAuthUser = auth.currentUser;
const mutableAuth = auth as { currentUser: unknown };

const makeSermon = (overrides: Partial<Sermon> = {}): Sermon => ({
  id: 'sermon-1',
  title: 'Cached sermon',
  verse: 'John 3:16',
  date: '2024-01-01',
  thoughts: [],
  userId: 'user-1',
  ...overrides,
});

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useSermon', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mutableAuth.currentUser = defaultAuthUser;
    window.localStorage.clear();
  });

  it('shows the newer server copy instead of an older sermon cached in the list', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const cachedSermon = makeSermon({
      userId: 'test-user-id',
      title: 'Older sermon left on this device',
      rev: { core: 1 },
    });
    queryClient.setQueryData(['sermons', 'test-user-id'], [cachedSermon]);
    mutableAuth.currentUser = { uid: 'test-user-id' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockResolvedValue(
      makeSermon({
        userId: 'test-user-id',
        title: 'Newer sermon saved elsewhere',
        rev: { core: 2 },
      })
    );

    const { result } = renderHook(() => useSermon('sermon-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(result.current.sermon?.title).toBe('Newer sermon saved elsewhere')
    );
    expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1');
  });

  it('keeps an unsaved local sermon edit when the server revision is not ahead', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unsaved = makeSermon({
      userId: 'test-user-id',
      title: 'Edited here, not saved yet',
      rev: { core: 4 },
    });
    queryClient.setQueryData(['sermons', 'test-user-id'], [unsaved]);
    mutableAuth.currentUser = { uid: 'test-user-id' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockResolvedValue(
      makeSermon({
        userId: 'test-user-id',
        title: 'What the server still holds',
        rev: { core: 4 },
      })
    );

    const { result } = renderHook(() => useSermon('sermon-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1'));
    expect(result.current.sermon?.title).toBe('Edited here, not saved yet');
  });

  it('keeps showing the stored sermon when the server request fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stored = makeSermon({
      userId: 'test-user-id',
      title: 'Still readable after a failed refresh',
      rev: { core: 1 },
    });
    queryClient.setQueryData(['sermons', 'test-user-id'], [stored]);
    mutableAuth.currentUser = { uid: 'test-user-id' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useSermon('sermon-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1'));
    expect(result.current.sermon?.title).toBe('Still readable after a failed refresh');
  });

  /**
   * A REFUSED read must not read as "still loading".
   *
   * Measured live 2026-07-28 on a foreign sermon link: Firestore rejects with
   * "Missing or insufficient permissions", React Query reads the failure as a lost
   * connection and pauses the retry, so the query sits at `status:'pending'` with
   * NO error — and the detail page, which waited on `!sermon && !error`, showed
   * skeleton placeholders forever with nothing in the console.
   */
  it('stops waiting once the read has failed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mutableAuth.currentUser = { uid: 'user-1' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockRejectedValue(new Error('Missing or insufficient permissions.'));

    const { result } = renderHook(() => useSermon('foreign-sermon'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.awaitingFirstAnswer).toBe(false);
    expect(result.current.sermon).toBeNull();
  });

  /**
   * Offline with nothing cached the query is DISABLED: it never runs, never
   * settles and never errors. Waiting for it is waiting for something that cannot
   * arrive, so the page must be free to say so.
   */
  it('stops waiting when offline with no local copy', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mutableAuth.currentUser = { uid: 'user-1' };
    mockUseOnlineStatus.mockReturnValue(false);
    mockGetSermonById.mockResolvedValue(makeSermon());

    const { result } = renderHook(() => useSermon('sermon-1'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.sermon).toBeNull();
    expect(result.current.awaitingFirstAnswer).toBe(false);
    expect(mockGetSermonById).not.toHaveBeenCalled();
  });

  it('keeps waiting while a read is genuinely in flight', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mutableAuth.currentUser = { uid: 'user-1' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSermon('slow-sermon'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

/**
 * The persisted React Query cache outlives sign-out, so a detail key naming only
 * the document is shared by every account that ever used this browser. Reproduced
 * live 2026-07-25 on a shared computer: signed out of A, signed in as B, opened
 * A's sermon by direct link — A's content rendered from cache while the server
 * answered 401.
 */
describe('the sermon detail cache is scoped to its owner', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mutableAuth.currentUser = defaultAuthUser;
    window.localStorage.clear();
  });

  it('does not hand one account the copy cached by another', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Account A cached this sermon on this machine.
    queryClient.setQueryData(sermonDetailKey('user-a', 'sermon-1'), makeSermon({ title: "A's sermon" }));

    // Account B now opens the same link. The read is refused, as it is in production.
    mutableAuth.currentUser = { uid: 'user-b' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockRejectedValue(new Error('Missing or insufficient permissions.'));

    const { result } = renderHook(() => useSermon('sermon-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sermon).toBeNull();
    // And A's copy is still A's — scoping must not destroy the other account's cache.
    expect(queryClient.getQueryData(sermonDetailKey('user-a', 'sermon-1'))).toBeTruthy();
  });
});

/**
 * The persisted cache hydrates from IndexedDB AFTER the first render. A one-off
 * cache peek misses that, and with the detail key now owner-scoped there is no
 * other subscription to fall back on — so an offline reader would be told there is
 * no local copy of a sermon that arrives moments later.
 */
it('picks up the owner list when it hydrates after the first render', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mutableAuth.currentUser = { uid: 'user-1' };
  mockUseOnlineStatus.mockReturnValue(false);

  const { result } = renderHook(() => useSermon('sermon-1'), {
    wrapper: createWrapper(queryClient),
  });

  expect(result.current.sermon).toBeNull();

  // The persister restores the dashboard list a moment later.
  const restored = makeSermon({ title: 'Restored from disk' });
  act(() => {
    queryClient.setQueryData(['sermons', 'user-1'], [restored]);
  });

  await waitFor(() => expect(result.current.sermon).toMatchObject({ title: 'Restored from disk' }));
});
