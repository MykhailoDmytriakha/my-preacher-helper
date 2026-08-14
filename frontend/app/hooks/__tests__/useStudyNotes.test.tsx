import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';


import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/providers/AuthProvider';
import { auth } from '@/services/firebaseAuth.service';
import { createStudyNote, deleteStudyNote, getStudyNotes, updateStudyNote } from '@services/studies.service';
import { awaitAcceptance } from '@/utils/recoverableWrite';

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
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetStudyNotes = getStudyNotes as jest.MockedFunction<typeof getStudyNotes>;
const mockCreateStudyNote = createStudyNote as jest.MockedFunction<typeof createStudyNote>;
const mockUpdateStudyNote = updateStudyNote as jest.MockedFunction<typeof updateStudyNote>;
const mockDeleteStudyNote = deleteStudyNote as jest.MockedFunction<typeof deleteStudyNote>;
const defaultAuthUser = auth.currentUser;
const mutableAuth = auth as { currentUser: unknown };

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
    mutableAuth.currentUser = defaultAuthUser;
  });

  it('keeps loading true while auth is in progress and avoids fetching', () => {
    mutableAuth.currentUser = null;
    mockUseOnlineStatus.mockReturnValue(false);
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

  it('returns queued for a new note: the stable id is available without claiming Saved', async () => {
    let resolveWrite!: (note: StudyNote) => void;
    const persistence = new Promise<StudyNote>((resolve) => {
      resolveWrite = resolve;
    });
    mockUseOnlineStatus.mockReturnValue(false);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-uid' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetStudyNotes.mockResolvedValue([]);
    mockCreateStudyNote.mockReturnValue(persistence);

    const { result } = renderHook(() => useStudyNotes(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const submission = result.current.createNote({
      userId: 'auth-uid', title: 'Long-form draft', content: 'Never claim this is saved early.',
      tags: [], scriptureRefs: [], type: 'note', materialIds: [], relatedSermonIds: [],
    });
    const acceptance = await awaitAcceptance(submission, () => undefined);

    expect(acceptance.kind).toBe('queued');
    expect(submission.note.id).toBeTruthy();
    resolveWrite(makeNote({ id: submission.note.id }));
    await submission.persistence;
  });

  it('waits for a persisted existing-note update while online', async () => {
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-uid' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetStudyNotes.mockResolvedValue([makeNote({ userId: 'auth-uid' })]);
    mockUpdateStudyNote.mockResolvedValue(makeNote({ userId: 'auth-uid' }));

    const { result } = renderHook(() => useStudyNotes(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const submission = result.current.updateNote({ id: 'note-1', updates: { content: 'Changed text' } });
    await expect(awaitAcceptance(submission, () => undefined)).resolves.toEqual({ kind: 'persisted' });
    await expect(submission.result).resolves.toMatchObject({ id: 'note-1' });
  });

  it('returns queued for delete so the persisted mutation can replay offline', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-uid' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetStudyNotes.mockResolvedValue([makeNote({ userId: 'auth-uid' })]);
    mockDeleteStudyNote.mockResolvedValue(undefined);

    const { result } = renderHook(() => useStudyNotes(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const submission = result.current.deleteNote('note-1');
    await expect(awaitAcceptance(submission, () => undefined)).resolves.toMatchObject({ kind: 'queued' });
  });
});
