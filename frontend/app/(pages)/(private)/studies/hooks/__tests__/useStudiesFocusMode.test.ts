import { renderHook, act } from '@testing-library/react';

import { StudyNote } from '@/models/models';

import { useStudiesFocusMode } from '../useStudiesFocusMode';

// Mock Next.js navigation
const mockPush = jest.fn();
const mockPathname = '/studies';
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

const createTestNote = (id: string, title: string): StudyNote => ({
  id,
  userId: 'user-1',
  content: `Content for ${title}`,
  title,
  scriptureRefs: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isDraft: false,
});

describe('useStudiesFocusMode', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null focusedNote when no focus param in URL', () => {
    const notes = [createTestNote('note-1', 'First'), createTestNote('note-2', 'Second')];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    expect(result.current.focusedNote).toBeNull();
    expect(result.current.focusedNoteId).toBeNull();
    expect(result.current.focusedIndex).toBe(-1);
  });

  it('reads focus param from URL and returns focused note', () => {
    mockSearchParams = new URLSearchParams('focus=note-2');
    const notes = [createTestNote('note-1', 'First'), createTestNote('note-2', 'Second')];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    expect(result.current.focusedNoteId).toBe('note-2');
    expect(result.current.focusedNote?.title).toBe('Second');
    expect(result.current.focusedIndex).toBe(1);
  });

  it('syncs with URL changes', () => {
    const notes = [createTestNote('note-1', 'First'), createTestNote('note-2', 'Second')];

    mockSearchParams = new URLSearchParams('focus=note-1');
    const { result, rerender } = renderHook(() =>
      useStudiesFocusMode({ visibleNotes: notes })
    );

    expect(result.current.focusedNoteId).toBe('note-1');

    // Change URL params
    mockSearchParams = new URLSearchParams('focus=note-2');
    rerender();

    expect(result.current.focusedNoteId).toBe('note-2');
    expect(result.current.focusedNote?.title).toBe('Second');
  });

  it('enterFocus updates URL with focus param preserving existing params', () => {
    mockSearchParams = new URLSearchParams('q=grace');
    const notes = [createTestNote('note-1', 'First'), createTestNote('note-2', 'Second')];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    act(() => {
      result.current.enterFocus('note-1');
    });

    expect(mockPush).toHaveBeenCalledWith('/studies?q=grace&focus=note-1', { scroll: false });
  });

  it('exitFocus removes focus param from URL preserving other params', () => {
    mockSearchParams = new URLSearchParams('q=grace&focus=note-1');
    const notes = [createTestNote('note-1', 'First')];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    act(() => {
      result.current.exitFocus();
    });

    expect(mockPush).toHaveBeenCalledWith('/studies?q=grace', { scroll: false });
  });

  it('goToNext navigates to next note in list', () => {
    mockSearchParams = new URLSearchParams('focus=note-1');
    const notes = [
      createTestNote('note-1', 'First'),
      createTestNote('note-2', 'Second'),
      createTestNote('note-3', 'Third'),
    ];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);

    act(() => {
      result.current.goToNext();
    });

    expect(mockPush).toHaveBeenCalledWith('/studies?focus=note-2', { scroll: false });
  });

  it('goToPrev navigates to previous note in list', () => {
    mockSearchParams = new URLSearchParams('focus=note-2');
    const notes = [
      createTestNote('note-1', 'First'),
      createTestNote('note-2', 'Second'),
      createTestNote('note-3', 'Third'),
    ];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(true);

    act(() => {
      result.current.goToPrev();
    });

    expect(mockPush).toHaveBeenCalledWith('/studies?focus=note-1', { scroll: false });
  });

  it('does not navigate past first or last note', () => {
    mockSearchParams = new URLSearchParams('focus=note-1');
    const notes = [createTestNote('note-1', 'Only')];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrev).toBe(false);

    act(() => {
      result.current.goToNext();
      result.current.goToPrev();
    });

    // Should not call push since we're at boundaries
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('returns correct totalCount from visibleNotes', () => {
    const notes = [
      createTestNote('note-1', 'First'),
      createTestNote('note-2', 'Second'),
      createTestNote('note-3', 'Third'),
    ];

    const { result } = renderHook(() => useStudiesFocusMode({ visibleNotes: notes }));

    expect(result.current.totalCount).toBe(3);
  });
});

