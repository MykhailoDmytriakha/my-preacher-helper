import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';


import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/providers/AuthProvider';
import { getStudyNotes } from '@services/studies.service';

import { useStudyNotes } from '../useStudyNotes';

import type { StudyNote } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@services/studies.service', () => ({
  getStudyNotes: jest.fn(),
  createStudyNote: jest.fn(),
  updateStudyNote: jest.fn(),
  deleteStudyNote: jest.fn(),
  getStudyMaterials: jest.fn(),
  createStudyMaterial: jest.fn(),
  updateStudyMaterial: jest.fn(),
  deleteStudyMaterial: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetStudyNotes = getStudyNotes as jest.MockedFunction<typeof getStudyNotes>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const makeNote = (overrides: Partial<StudyNote> = {}): StudyNote => ({
  id: 'note-1',
  userId: overrides.userId ?? 'user-123',
  title: 'Test',
  content: 'Content',
  scriptureRefs: [],
  tags: [],
  createdAt: '2024-01-01',
  updatedAt: '2024-01-02',
  isDraft: false,
  ...overrides,
});

describe('useStudyNotes', () => {
  afterEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('keeps loading true while auth is in progress and avoids fetching', () => {
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    });

    const { result } = renderHook(() => useStudyNotes(), { wrapper: createWrapper() });

    expect(result.current.uid).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(mockGetStudyNotes).not.toHaveBeenCalled();
  });

  it('fetches notes once authenticated user is available', async () => {
    const notes = [makeNote()];
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-uid' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetStudyNotes.mockResolvedValue(notes);

    const { result } = renderHook(() => useStudyNotes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetStudyNotes).toHaveBeenCalledWith('auth-uid');
    expect(result.current.notes).toEqual(notes);
  });

  it('falls back to guest uid from localStorage when no auth user', async () => {
    const guestUid = 'guest-42';
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: guestUid }));
    mockUseOnlineStatus.mockReturnValue(true);

    const notes = [makeNote({ userId: guestUid })];
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });
    mockGetStudyNotes.mockResolvedValue(notes);

    const { result } = renderHook(() => useStudyNotes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetStudyNotes).toHaveBeenCalledWith(guestUid);
    expect(result.current.uid).toBe(guestUid);
    expect(result.current.notes).toEqual(notes);
  });
});

