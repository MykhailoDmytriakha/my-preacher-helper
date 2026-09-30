import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/providers/AuthProvider';
import { auth } from '@/services/firebaseAuth.service';
import { SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { awaitAcceptance } from '@/utils/recoverableWrite';
import { forgetReportedFailures } from '@/utils/writeRecovery';
import {
  createStudyNoteShareLink,
  deleteStudyNoteShareLink,
  getStudyNoteShareLinks,
} from '@services/studyNoteShareLinks.service';

import { useStudyNoteShareLinks } from '../useStudyNoteShareLinks';

import type { StudyNoteShareLink } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@services/studyNoteShareLinks.service', () => ({
  getStudyNoteShareLinks: jest.fn(),
  createStudyNoteShareLink: jest.fn(),
  deleteStudyNoteShareLink: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetShareLinks = getStudyNoteShareLinks as jest.MockedFunction<typeof getStudyNoteShareLinks>;
const mockCreateShareLink = createStudyNoteShareLink as jest.MockedFunction<typeof createStudyNoteShareLink>;
const mockDeleteShareLink = deleteStudyNoteShareLink as jest.MockedFunction<typeof deleteStudyNoteShareLink>;
const defaultAuthUser = auth.currentUser;
const mutableAuth = auth as { currentUser: unknown };

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const makeShareLink = (overrides: Partial<StudyNoteShareLink> = {}): StudyNoteShareLink => ({
  id: 'link-1',
  ownerId: 'user-1',
  noteId: 'note-1',
  token: 'token-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  viewCount: 0,
  ...overrides,
});

describe('useStudyNoteShareLinks', () => {
  afterEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mutableAuth.currentUser = defaultAuthUser;
  });

  it('keeps loading true while auth is loading and skips fetching', () => {
    mutableAuth.currentUser = null;
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    });

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    expect(result.current.uid).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(mockGetShareLinks).not.toHaveBeenCalled();
  });

  it('fetches share links when authenticated user exists', async () => {
    const links = [makeShareLink()];
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-1' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetShareLinks.mockResolvedValue(links);

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetShareLinks).toHaveBeenCalledWith('auth-1');
    expect(result.current.shareLinks).toEqual(links);
  });

  it('uses guest uid from localStorage when no auth user', async () => {
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-1' }));
    const links = [makeShareLink({ ownerId: 'guest-1' })];
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });
    mockGetShareLinks.mockResolvedValue(links);

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetShareLinks).toHaveBeenCalledWith('guest-1');
    expect(result.current.uid).toBe('guest-1');
    expect(result.current.shareLinks).toEqual(links);
  });

  it('handles invalid guest data gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    window.localStorage.setItem('guestUser', '{invalid-json');
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetShareLinks).not.toHaveBeenCalled();
    expect(result.current.uid).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('updates cache after creating a share link', async () => {
    const existing = makeShareLink({ id: 'link-1', noteId: 'note-1' });
    const created = makeShareLink({ id: 'link-2', noteId: 'note-1' });

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-1' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetShareLinks.mockResolvedValue([existing]);
    mockCreateShareLink.mockResolvedValue(created);

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const acceptance = await awaitAcceptance(result.current.createShareLink('note-1'), () => undefined);
      expect(acceptance).toEqual({ kind: 'persisted' });
    });

    expect(mockCreateShareLink).toHaveBeenCalledWith('auth-1', 'note-1');
    await waitFor(() => expect(result.current.shareLinks).toEqual([created]));
  });

  it('updates cache after deleting a share link', async () => {
    const linkA = makeShareLink({ id: 'link-1', noteId: 'note-1' });
    const linkB = makeShareLink({ id: 'link-2', noteId: 'note-2' });

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-1' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetShareLinks.mockResolvedValue([linkA, linkB]);
    mockDeleteShareLink.mockResolvedValue(undefined);

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.shareLinks).toEqual([linkA, linkB]));

    await act(async () => {
      const acceptance = await awaitAcceptance(result.current.deleteShareLink('link-1'), () => undefined);
      expect(acceptance).toEqual({ kind: 'persisted' });
    });

    expect(mockDeleteShareLink).toHaveBeenCalledWith('auth-1', 'link-1');
    await waitFor(() => expect(result.current.shareLinks).toEqual([linkB]));
  });

  describe('failures the person must hear about, and only those', () => {
    const EARLIER_SESSION = Date.now() - 60 * 60 * 1000;

    const signedIn = (links: StudyNoteShareLink[]) => {
      mockUseOnlineStatus.mockReturnValue(true);
      mockUseAuth.mockReturnValue({ user: { uid: 'auth-1' } as any, loading: false, isAuthenticated: true });
      mockGetShareLinks.mockResolvedValue(links);
    };

    const restoreFailure = async (
      queryClient: QueryClient,
      mutationKey: readonly unknown[],
      variables: Record<string, string>
    ) => {
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationKey,
        mutationFn: () => Promise.reject(new Error('The connection dropped')),
      });
      await mutation.execute(variables).catch(() => undefined);
      (mutation.state as { submittedAt: number }).submittedAt = EARLIER_SESSION;
      return mutation;
    };

    const renderWith = (queryClient: QueryClient) =>
      renderHook(() => useStudyNoteShareLinks(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

    const toastIds = (spy: jest.SpyInstance) =>
      spy.mock.calls.map(([, options]) => (options as { id?: string } | undefined)?.id);

    beforeEach(() => {
      forgetReportedFailures();
    });

    it('does not bring back a link creation that failed in an earlier session', async () => {
      // Its "Retry" could make a link the person has since disabled; a missing link shows in the list anyway.
      const toastError = jest.spyOn(toast, 'error');
      signedIn([makeShareLink({ id: 'link-1', noteId: 'note-1' })]);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      await restoreFailure(queryClient, SHARE_LINK_MUTATION_KEYS.create, { userId: 'auth-1', noteId: 'note-9' });

      const { result } = renderWith(queryClient);
      await waitFor(() => expect(result.current.loading).toBe(false));

      await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
      expect(toastIds(toastError)).not.toContain('write-recovery:study-note-share-link:create:note-9');
      toastError.mockRestore();
    });

    it('takes back the failure message once the same link is created after all', async () => {
      // Its "Retry" would otherwise stay on screen and could make a link the person disabled since.
      const toastError = jest.spyOn(toast, 'error');
      const toastDismiss = jest.spyOn(toast, 'dismiss');
      signedIn([]);
      mockCreateShareLink
        .mockRejectedValueOnce(new Error('The connection dropped'))
        .mockResolvedValueOnce(makeShareLink({ id: 'link-5', noteId: 'note-5' }));
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const { result } = renderWith(queryClient);
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await awaitAcceptance(result.current.createShareLink('note-5'), () => undefined).catch(() => undefined);
      });
      await waitFor(() => expect(toastIds(toastError)).toContain('write-recovery:study-note-share-link:create:note-5'));
      expect(toastDismiss).not.toHaveBeenCalledWith('write-recovery:study-note-share-link:create:note-5');

      await act(async () => {
        await awaitAcceptance(result.current.createShareLink('note-5'), () => undefined);
      });

      expect(toastDismiss).toHaveBeenCalledWith('write-recovery:study-note-share-link:create:note-5');
      toastError.mockRestore();
      toastDismiss.mockRestore();
    });
  });

  it('throws when creating a share link without a uid', async () => {
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    // A LOCAL refusal now: it rejects AND announces itself, because no mutation exists
    // for a recovery descriptor to report — see `refusedWrite`.
    await expect(result.current.createShareLink('note-1').acceptance).rejects.toThrow(
      'No signed-in user'
    );
  });
});
