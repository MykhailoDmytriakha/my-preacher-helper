import { fireEvent, render, screen } from '@testing-library/react';

import { useStudyNotes } from '@/hooks/useStudyNotes';

import WikilinkPicker from '../WikilinkPicker';

import type { StudyNote } from '@/models/models';

jest.mock('@/hooks/useStudyNotes');

function makeNote(id: string, title: string, content: string): StudyNote {
  return {
    id,
    title,
    content,
    tags: [],
    scriptureRefs: [],
    userId: 'user-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    isDraft: false,
    type: 'note',
  };
}

const notes = [
  makeNote('current', 'Current note', 'Hidden'),
  makeNote('romans', 'Romans study', 'Grace and faith'),
  makeNote('john', 'John study', 'Light and life'),
];

describe('WikilinkPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useStudyNotes as jest.Mock).mockReturnValue({
      notes,
      loading: false,
    });
  });

  it('renders searchable notes and excludes the current note', () => {
    render(
      <WikilinkPicker
        open
        currentNoteId="current"
        onPick={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Search notes...')).toBeInTheDocument();
    expect(screen.getByText('Current note is hidden from this list')).toBeInTheDocument();
    expect(screen.queryByText('Current note')).not.toBeInTheDocument();
    expect(screen.getByText('Romans study')).toBeInTheDocument();
    expect(screen.getByText('John study')).toBeInTheDocument();
  });

  it('filters notes by title and content', () => {
    render(
      <WikilinkPicker
        open
        onPick={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search notes...'), {
      target: { value: 'light' },
    });

    expect(screen.queryByText('Romans study')).not.toBeInTheDocument();
    expect(screen.getByText('John study')).toBeInTheDocument();
  });

  it('picks a note id and closes the picker', () => {
    const onPick = jest.fn();
    const onClose = jest.fn();

    render(
      <WikilinkPicker
        open
        onPick={onPick}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Romans study/ }));

    expect(onPick).toHaveBeenCalledWith('romans');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
