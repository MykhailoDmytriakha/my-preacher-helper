import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { getStudyNotes } from '@services/studies.service';

import { useStudyNoteDetail } from '../useStudyNoteDetail';

import type { StudyNote } from '@/models/models';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: jest.fn(),
}));

jest.mock('@services/studies.service', () => ({
  getStudyNotes: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseResolvedUid = useResolvedUid as jest.MockedFunction<typeof useResolvedUid>;
const mockGetStudyNotes = getStudyNotes as jest.MockedFunction<typeof getStudyNotes>;

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

const makeNote = (overrides: Partial<StudyNote> = {}): StudyNote => ({
  id: 'note-1',
  userId: 'user-1',
  title: 'Study note',
  content: 'Content',
  scriptureRefs: [],
  tags: [],
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  isDraft: false,
  ...overrides,
});

describe('useStudyNoteDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseResolvedUid.mockReturnValue({ uid: 'user-1', isAuthLoading: false });
    mockGetStudyNotes.mockResolvedValue([]);
  });

  it('returns the note from the study notes list cache when present', () => {
    const queryClient = createQueryClient();
    const cachedNote = makeNote({ title: 'Cached note' });
    queryClient.setQueryData(['study-notes', 'user-1'], [cachedNote]);

    const { result } = renderHook(() => useStudyNoteDetail('note-1'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.note).toEqual(cachedNote);
    expect(result.current.loading).toBe(false);
    expect(mockGetStudyNotes).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['study-note-detail', 'note-1', 'user-1'])).toEqual(cachedNote);
  });

  it('returns null when the note is not found and no cache entry exists', async () => {
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useStudyNoteDetail('missing-note'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetStudyNotes).toHaveBeenCalledWith('user-1');
    expect(result.current.note).toBeNull();
    expect(queryClient.getQueryData(['study-note-detail', 'missing-note', 'user-1'])).toBeNull();
  });

  it('does not overwrite the study notes list cache during fallback detail fetches', async () => {
    const queryClient = createQueryClient();
    const optimisticNote = makeNote({ id: 'optimistic-note', title: 'Optimistic draft' });
    const fetchedDetail = makeNote({ id: 'target-note', title: 'Fetched detail' });
    queryClient.setQueryData(['study-notes', 'user-1'], [optimisticNote]);
    mockGetStudyNotes.mockResolvedValue([fetchedDetail]);

    const { result } = renderHook(() => useStudyNoteDetail('target-note'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.note).toEqual(fetchedDetail));

    expect(queryClient.getQueryData(['study-notes', 'user-1'])).toEqual([optimisticNote]);
  });

  it('reports loading while the fallback fetch is pending', () => {
    const queryClient = createQueryClient();
    mockGetStudyNotes.mockImplementation(() => new Promise<StudyNote[]>(() => {}));

    const { result } = renderHook(() => useStudyNoteDetail('note-1'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.note).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(mockGetStudyNotes).toHaveBeenCalledWith('user-1');
  });
});
