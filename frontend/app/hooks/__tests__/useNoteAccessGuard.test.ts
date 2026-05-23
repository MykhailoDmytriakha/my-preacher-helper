import { act, renderHook, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useNoteAccessGuard } from '../useNoteAccessGuard';

import type { StudyNote } from '@/models/models';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

const makeNote = (overrides: Partial<StudyNote> = {}): StudyNote => ({
  id: 'note-1',
  userId: 'user-1',
  title: 'Current note',
  content: 'Body',
  tags: [],
  scriptureRefs: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  isDraft: false,
  type: 'note',
  ...overrides,
});

type GuardParams = Parameters<typeof useNoteAccessGuard>[0];

function makeGuardProps(overrides: Partial<GuardParams> = {}): GuardParams {
  return {
      noteId: 'note-1',
      isNew: false,
      notesLoading: false,
      existingNote: makeNote(),
      uid: 'user-1',
      redirectTo: '/studies',
      ...overrides,
    };
}

function renderGuard(overrides: Partial<GuardParams> = {}) {
  return renderHook((props: GuardParams) => useNoteAccessGuard(props), {
    initialProps: makeGuardProps(overrides),
  });
}

describe('useNoteAccessGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does not redirect while notes are still loading', () => {
    renderGuard({
      notesLoading: true,
      existingNote: undefined,
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows an error and redirects when an existing note is missing', async () => {
    renderGuard({
      existingNote: undefined,
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(toast.error).toHaveBeenCalledWith('Note not found');
    expect(mockPush).toHaveBeenCalledWith('/studies');
  });

  it('does not redirect missing notes while the notes query is in error', () => {
    renderGuard({
      existingNote: undefined,
      error: new Error('network'),
    });

    jest.advanceTimersByTime(500);

    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('cancels the missing-note redirect if the note returns during the grace window', () => {
    const { rerender } = renderGuard({
      existingNote: undefined,
    });

    jest.advanceTimersByTime(200);

    rerender(makeGuardProps({ existingNote: makeNote() }));

    jest.advanceTimersByTime(300);

    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows an error and redirects when the note belongs to another user', async () => {
    renderGuard({
      existingNote: makeNote({ userId: 'other-user' }),
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No access to this note');
      expect(mockPush).toHaveBeenCalledWith('/studies');
    });
  });

  it('does not redirect for the owner of the note', () => {
    renderGuard({
      existingNote: makeNote({ userId: 'user-1' }),
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
