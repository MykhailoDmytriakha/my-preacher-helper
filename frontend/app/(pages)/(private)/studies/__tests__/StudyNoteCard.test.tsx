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
});
