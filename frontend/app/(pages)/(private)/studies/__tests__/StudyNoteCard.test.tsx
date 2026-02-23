import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock useClipboard hook
jest.mock('@/hooks/useClipboard', () => ({
  useClipboard: jest.fn(() => ({
    isCopied: false,
    copyToClipboard: jest.fn(),
  })),
}));

// Mock studyNoteUtils
jest.mock('@/utils/studyNoteUtils', () => ({
  formatStudyNoteForCopy: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { StudyNote } from '@/models/models';
import { HIGHLIGHT_COLORS } from '@/utils/themeColors';

import StudyNoteCard from '../StudyNoteCard';

const createTestNote = (overrides: Partial<StudyNote> = {}): StudyNote => {
  const timestamp = new Date(Date.now()).toISOString();
  return {
    id: 'note-1',
    userId: 'user-1',
    content: 'Reflect on grace',
    title: undefined,
    scriptureRefs: [],
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    isDraft: false,
    ...overrides,
  };
};

describe('StudyNoteCard', () => {
  it('shows the AI analyze control when the note lacks metadata', async () => {
    const onToggleExpand = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const onAnalyze = jest.fn();
    const note = createTestNote();

    render(
      <StudyNoteCard
        note={note}
        bibleLocale="en"
        isExpanded={false}
        onEdit={onEdit}
        onDelete={onDelete}
        onAnalyze={onAnalyze}
      />
    );

    expect(screen.getByText('studiesWorkspace.untitled')).toBeInTheDocument();

    const analyzeButton = screen.getByRole('button', {
      name: 'studiesWorkspace.aiAnalyze.buttonShort',
    });
    await userEvent.click(analyzeButton);

    expect(onAnalyze).toHaveBeenCalledWith(note);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('hides the AI analyze control when the note already has metadata', () => {
    const noteWithMetadata = createTestNote({
      id: 'note-2',
      title: 'Metadata present',
      tags: ['wisdom'],
      scriptureRefs: [
        { id: 'ref-1', book: 'Genesis', chapter: 1, fromVerse: 1 },
      ],
    });

    render(
      <StudyNoteCard
        note={noteWithMetadata}
        bibleLocale="en"
        isExpanded={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAnalyze={jest.fn()}
      />
    );

    expect(
      screen.queryByRole('button', {
        name: 'studiesWorkspace.aiAnalyze.buttonShort',
      })
    ).not.toBeInTheDocument();
  });

  beforeEach(() => {
    mockPush.mockClear();
  });

  it('navigates to the dedicated note page when the card body is clicked', async () => {
    const noteWithTitle = createTestNote({ id: 'note-redirect', title: 'Route Note' });

    render(
      <StudyNoteCard
        note={noteWithTitle}
        bibleLocale="en"
        isExpanded={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAnalyze={jest.fn()}
      />
    );

    const headerToggle = screen.getByRole('button', { name: /Route Note/i });
    await userEvent.click(headerToggle);

    expect(mockPush).toHaveBeenCalledWith('/studies/note-redirect');
  });

  it('supports keyboard toggle on the header to route, and ignores nested buttons', async () => {
    const onEdit = jest.fn();
    const noteWithTitle = createTestNote({ id: 'note-3b', title: 'Keyboard Note' });

    render(
      <StudyNoteCard
        note={noteWithTitle}
        bibleLocale="en"
        isExpanded={false}
        onEdit={onEdit}
        onDelete={jest.fn()}
        onAnalyze={jest.fn()}
      />
    );

    const headerToggle = screen.getByRole('button', { name: /Keyboard Note/i });
    headerToggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(mockPush).toHaveBeenCalledWith('/studies/note-3b');

    const editButton = screen.getByRole('button', { name: 'common.edit' });
    editButton.focus();
    await userEvent.keyboard('{Enter}');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(noteWithTitle);
  });

  it('applies responsive classes to the title', () => {
    const note = createTestNote({ id: 'note-4', title: 'A very long title that should wrap' });

    render(
      <StudyNoteCard
        note={note}
        bibleLocale="en"
        isExpanded={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAnalyze={jest.fn()}
      />
    );

    const heading = screen.getByRole('heading', { name: 'A very long title that should wrap' });
    expect(heading).toHaveClass('line-clamp-2');
    expect(heading).toHaveClass('leading-tight');
  });

  it('shows Edit button in header and calls onEdit when clicked', async () => {
    const onEdit = jest.fn();
    const note = createTestNote({ id: 'note-5', title: 'Card with header buttons' });

    render(
      <StudyNoteCard
        note={note}
        bibleLocale="en"
        isExpanded={false}
        onEdit={onEdit}
        onDelete={jest.fn()}
        onAnalyze={jest.fn()}
      />
    );

    const editButton = screen.getByRole('button', { name: 'common.edit' });
    expect(editButton).toBeInTheDocument();

    await userEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledWith(note);
  });

  it('shows Delete button in header and calls onDelete when clicked', async () => {
    const onDelete = jest.fn();
    const note = createTestNote({ id: 'note-6', title: 'Delete me' });

    // Mock confirm to return true
    const originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);

    render(
      <StudyNoteCard
        note={note}
        bibleLocale="en"
        isExpanded={false}
        onEdit={jest.fn()}
        onDelete={onDelete}
        onAnalyze={jest.fn()}
      />
    );

    const deleteButton = screen.getByRole('button', { name: 'common.delete' });
    expect(deleteButton).toBeInTheDocument();

    await userEvent.click(deleteButton);
    expect(window.confirm).toHaveBeenCalledWith('studiesWorkspace.deleteConfirm');
    expect(onDelete).toHaveBeenCalledWith(note.id);

    window.confirm = originalConfirm;
  });

  it('does not call onDelete when confirm is cancelled', async () => {
    const onDelete = jest.fn();
    const note = createTestNote({ id: 'note-7', title: 'Do not delete' });

    const originalConfirm = window.confirm;
    window.confirm = jest.fn(() => false);

    render(
      <StudyNoteCard
        note={note}
        bibleLocale="en"
        isExpanded={false}
        onEdit={jest.fn()}
        onDelete={onDelete}
        onAnalyze={jest.fn()}
      />
    );

    const deleteButton = screen.getByRole('button', { name: 'common.delete' });
    await userEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    window.confirm = originalConfirm;
  });

  describe('Search Highlighting', () => {
    it('highlights matching text in title when searchQuery is provided', () => {
      const note = createTestNote({
        id: 'note-search-1',
        title: 'Study about the Bible and faith',
        content: 'Some content here',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Bible"
        />
      );

      const mark = screen.getByRole('mark');
      expect(mark).toHaveTextContent('Bible');
      expect(mark).toHaveClass(HIGHLIGHT_COLORS.bg);
    });

    it('does not highlight when searchQuery is empty', () => {
      const note = createTestNote({
        id: 'note-search-2',
        title: 'Study about the Bible',
        content: 'Bible content',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery=""
        />
      );

      expect(screen.queryByRole('mark')).not.toBeInTheDocument();
    });

    it('highlights content in expanded view - title highlighting works in expanded state', () => {
      const note = createTestNote({
        id: 'note-search-3',
        title: 'The Bible is important',
        content: 'The Bible teaches us many things about faith',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={true}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Bible"
        />
      );

      // Title should have highlight in expanded state too
      const marks = screen.getAllByRole('mark');
      expect(marks.length).toBeGreaterThanOrEqual(1);
      expect(marks.some((m) => m.textContent === 'Bible')).toBe(true);
    });

    it('handles Cyrillic search queries', () => {
      const note = createTestNote({
        id: 'note-search-4',
        title: 'Заметка о Библия', // Using exact word form
        content: 'Библия учит нас',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="ru"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Библия"
        />
      );

      // Title should have highlight
      const marks = screen.getAllByRole('mark');
      expect(marks.length).toBeGreaterThanOrEqual(1);
    });

    it('highlights tags when searchQuery matches', () => {
      const note = createTestNote({
        id: 'note-search-5',
        title: 'Test Note',
        content: 'Some content',
        tags: ['faith', 'grace', 'hope'],
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={true}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="faith"
        />
      );

      // Tag should be highlighted
      const marks = screen.getAllByRole('mark');
      expect(marks.some((m) => m.textContent === 'faith')).toBe(true);
    });

    it('highlights scripture references when searchQuery matches', () => {
      const note = createTestNote({
        id: 'note-search-6',
        title: 'Test Note',
        content: 'Some content',
        scriptureRefs: [
          { id: 'ref-1', book: 'Genesis', chapter: 1, fromVerse: 1 },
        ],
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={true}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Genesis"
        />
      );

      // Scripture reference should be highlighted
      const marks = screen.getAllByRole('mark');
      expect(marks.some((m) => m.textContent === 'Genesis')).toBe(true);
    });

    it('displays matching tags and references in COLLAPSED view when searchQuery matches', () => {
      const note = createTestNote({
        id: 'note-search-collapsed-items',
        title: 'Collapsed Search Note',
        content: 'No match in content',
        tags: ['uniqueTag'],
        scriptureRefs: [
          { id: 'ref-coll', book: 'Exodus', chapter: 20, fromVerse: 1 },
        ],
      });

      // 1. Search for TAG
      const { unmount } = render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false} // Collapsed!
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="uniqueTag"
        />
      );

      // Tag should be visible and highlighted
      const tagMark = screen.getByRole('mark');
      expect(tagMark).toHaveTextContent('uniqueTag');

      unmount();

      // 2. Search for REF
      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false} // Collapsed!
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Exodus"
        />
      );

      // Ref should be visible and highlighted
      const refMark = screen.getByRole('mark');
      expect(refMark).toHaveTextContent('Exodus');
    });

    it('shows match count badge for combined matches when collapsed', () => {
      const note = createTestNote({
        id: 'note-search-count',
        title: 'Genesis title',
        content: 'Genesis body content once.',
        tags: ['genesis-tag'],
        scriptureRefs: [{ id: 'ref-2', book: 'Genesis', chapter: 1, fromVerse: 1 }],
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Genesis"
        />
      );

      // 1 content snippet + 1 tag + 1 ref + 1 title match = 4 total signals
      expect(
        screen.getByText(/4.*(matchingNotes|matching notes)/i)
      ).toBeInTheDocument();
    });

    it('falls back to a content preview when only the title matches (no empty search box)', () => {
      const note = createTestNote({
        id: 'title-only-match',
        title: 'Unique Title',
        content: 'Body without search hits',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Unique"
        />
      );

      expect(screen.getByText(/Body without search hits/i)).toBeInTheDocument();
    });

    it('shows a no-match alert when nothing matches', () => {
      const note = createTestNote({
        id: 'no-match',
        title: 'Some title',
        content: 'Unrelated content',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="missing"
        />
      );

      expect(
        screen.getByText(/studiesWorkspace\.noSearchMatches|No match found/i)
      ).toBeInTheDocument();
    });
  });

  describe('Copy functionality', () => {
    it('shows copy button in collapsed state', () => {
      const note = createTestNote({
        title: 'Test Title',
        content: 'Test content',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          onAnalyze={jest.fn()}
        />
      );

      // Check that copy button exists
      const copyButtons = screen.getAllByRole('button').filter(
        button => button.querySelector('svg') // Has icon
      );
      expect(copyButtons.length).toBeGreaterThan(0);
    });

    it('shows copy button in expanded state', () => {
      const note = createTestNote({
        title: 'Test Title',
        content: 'Test content',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={true}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          onAnalyze={jest.fn()}
        />
      );

      // Check that copy button exists in expanded state
      const copyButtons = screen.getAllByRole('button').filter(
        button => button.querySelector('svg') // Has icon
      );
      expect(copyButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Share link icon styling', () => {
    it('shows gray share link icon when hasShareLink is false (default)', () => {
      const onShare = jest.fn();
      const note = createTestNote({
        title: 'Test Title',
        content: 'Test content',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          onShare={onShare}
          hasShareLink={false}
        />
      );

      const shareButton = screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.shareButton' });
      expect(shareButton).toHaveClass('text-gray-400');
      expect(shareButton).toHaveClass('hover:bg-gray-100');
      expect(shareButton).toHaveClass('hover:text-gray-600');
      expect(shareButton).toHaveClass('dark:hover:bg-gray-700');
      expect(shareButton).toHaveClass('dark:hover:text-gray-200');
    });

    it('shows emerald share link icon when hasShareLink is true', () => {
      const onShare = jest.fn();
      const note = createTestNote({
        title: 'Test Title',
        content: 'Test content',
      });

      render(
        <StudyNoteCard
          note={note}
          bibleLocale="en"
          isExpanded={false}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          onShare={onShare}
          hasShareLink={true}
        />
      );

      const shareButton = screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.shareButton' });
      expect(shareButton).toHaveClass('text-emerald-600');
      expect(shareButton).toHaveClass('hover:bg-emerald-50');
      expect(shareButton).toHaveClass('hover:text-emerald-700');
      expect(shareButton).toHaveClass('dark:text-emerald-400');
      expect(shareButton).toHaveClass('dark:hover:bg-emerald-900/30');
      expect(shareButton).toHaveClass('dark:hover:text-emerald-300');
    });
  });
});
