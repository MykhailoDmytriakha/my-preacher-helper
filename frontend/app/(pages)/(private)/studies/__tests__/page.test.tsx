import { render, screen } from '@testing-library/react';
import StudiesPage from '../page';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useMediaQuery } from '@/hooks/useMediaQuery';

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: jest.fn(),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;
const mockUseMediaQuery = useMediaQuery as jest.MockedFunction<typeof useMediaQuery>;

const baseUseStudyNotesValue = (): ReturnType<typeof useStudyNotes> => ({
  uid: 'mock-user',
  notes: [],
  loading: false,
  error: null,
  refetch: jest.fn(),
  createNote: jest.fn(),
  updating: false,
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
});

describe('StudiesPage', () => {
  beforeEach(() => {
    mockUseStudyNotes.mockReturnValue(baseUseStudyNotesValue());
    mockUseMediaQuery.mockReturnValue(false); // Default to desktop view
  });

  it('shows the stats badge and new note button text', () => {
    render(<StudiesPage />);

    expect(screen.getByText('0 studiesWorkspace.stats.notesLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'studiesWorkspace.newNote' })).toBeInTheDocument();
  });
});
