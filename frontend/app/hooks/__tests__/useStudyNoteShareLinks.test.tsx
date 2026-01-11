import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';

import { useAuth } from '@/providers/AuthProvider';
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

jest.mock('@services/studyNoteShareLinks.service', () => ({
  getStudyNoteShareLinks: jest.fn(),
  createStudyNoteShareLink: jest.fn(),
  deleteStudyNoteShareLink: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGetShareLinks = getStudyNoteShareLinks as jest.MockedFunction<typeof getStudyNoteShareLinks>;
const mockCreateShareLink = createStudyNoteShareLink as jest.MockedFunction<typeof createStudyNoteShareLink>;
const mockDeleteShareLink = deleteStudyNoteShareLink as jest.MockedFunction<typeof deleteStudyNoteShareLink>;

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
  });

  it('keeps loading true while auth is loading and skips fetching', () => {
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
      await result.current.createShareLink('note-1');
    });

    expect(mockCreateShareLink).toHaveBeenCalledWith('auth-1', 'note-1');
    await waitFor(() => expect(result.current.shareLinks).toEqual([created]));
  });

  it('updates cache after deleting a share link', async () => {
    const linkA = makeShareLink({ id: 'link-1', noteId: 'note-1' });
    const linkB = makeShareLink({ id: 'link-2', noteId: 'note-2' });

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
      await result.current.deleteShareLink('link-1');
    });

    expect(mockDeleteShareLink).toHaveBeenCalledWith('auth-1', 'link-1');
    await waitFor(() => expect(result.current.shareLinks).toEqual([linkB]));
  });

  it('throws when creating a share link without a uid', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    const { result } = renderHook(() => useStudyNoteShareLinks(), { wrapper: createWrapper() });

    await expect(result.current.createShareLink('note-1')).rejects.toThrow('No user');
  });
});
