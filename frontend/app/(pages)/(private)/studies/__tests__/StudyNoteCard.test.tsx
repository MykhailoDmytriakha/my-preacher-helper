import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudyNoteCard from '../StudyNoteCard';
import { StudyNote } from '@/models/models';

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
        onToggleExpand={onToggleExpand}
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
        onToggleExpand={jest.fn()}
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

  it('calls onToggleExpand when the header is clicked', async () => {
    const onToggleExpand = jest.fn();
    const noteWithTitle = createTestNote({ id: 'note-3', title: 'Header Note' });

    render(
      <StudyNoteCard
        note={noteWithTitle}
        bibleLocale="en"
        isExpanded={false}
        onToggleExpand={onToggleExpand}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAnalyze={jest.fn()}
      />
    );

    const heading = screen.getByRole('heading', { name: 'Header Note' });
    const headerButton = heading.closest('button');
    expect(headerButton).not.toBeNull();
    await userEvent.click(headerButton as HTMLButtonElement);

    expect(onToggleExpand).toHaveBeenCalled();
  });

  it('applies responsive classes to the title', () => {
    const note = createTestNote({ id: 'note-4', title: 'A very long title that should wrap' });

    render(
      <StudyNoteCard
        note={note}
        bibleLocale="en"
        isExpanded={false}
        onToggleExpand={jest.fn()}
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
        onToggleExpand={jest.fn()}
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
        onToggleExpand={jest.fn()}
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
        onToggleExpand={jest.fn()}
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
          onToggleExpand={jest.fn()}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Bible"
        />
      );

      const mark = screen.getByRole('mark');
      expect(mark).toHaveTextContent('Bible');
      expect(mark).toHaveClass('bg-yellow-200');
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
          onToggleExpand={jest.fn()}
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
          onToggleExpand={jest.fn()}
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
          onToggleExpand={jest.fn()}
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
          onToggleExpand={jest.fn()}
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
          onToggleExpand={jest.fn()}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
          searchQuery="Genesis"
        />
      );

      // Scripture reference should be highlighted
      const marks = screen.getAllByRole('mark');
      expect(marks.some((m) => m.textContent === 'Genesis')).toBe(true);
    });
  });
});
