import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudiesPage from '../page';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { StudyNote } from '@/models/models';

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: jest.fn(),
}));

jest.mock('../bibleData', () => ({
  getBooksForDropdown: jest.fn().mockReturnValue([]),
  getLocalizedBookName: jest.fn().mockImplementation((book) => book),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;
const mockUseMediaQuery = useMediaQuery as jest.MockedFunction<typeof useMediaQuery>;

const createMockNote = (overrides: Partial<StudyNote> = {}): StudyNote => ({
  id: `note-${Math.random().toString(36).substr(2, 9)}`,
  userId: 'mock-user',
  content: 'Test content',
  title: 'Test note',
  scriptureRefs: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isDraft: false,
  type: 'note',
  ...overrides,
});

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

  describe('Type Tabs', () => {
    it('renders all three tabs', () => {
      render(<StudiesPage />);

      expect(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.all/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.notes/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.questions/i })).toBeInTheDocument();
    });

    it('shows correct counts on tabs', () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', type: 'note' }),
        createMockNote({ id: '2', type: 'note' }),
        createMockNote({ id: '3', type: 'question' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      // All tab should show total count (3)
      expect(screen.getByText('(3)')).toBeInTheDocument();
      // Notes tab should show 2
      expect(screen.getByText('(2)')).toBeInTheDocument();

      // Questions tab should show 1 in badge, but not in parentheses
      // We look for the questions tab button specifically
      const questionsTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.questions/i });
      expect(questionsTab).toBeInTheDocument();

      // Check that it does NOT contain "(1)"
      expect(questionsTab).not.toHaveTextContent('(1)');

      // Check that it contains "1" (in the badge)
      // Since "studiesWorkspace.tabs.questions" text is also there, checking for "1" might fail if we are strict about full text match on getByText against the button
      // But we can check specifically for the badge if we could identify it. 
      // Simplified check: button should contain "1"
      expect(questionsTab).toHaveTextContent('1');
    });

    it('filters to show only notes when Notes tab is clicked', () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Regular Note 1', type: 'note' }),
        createMockNote({ id: '2', title: 'Question 1', type: 'question' }),
        createMockNote({ id: '3', title: 'Regular Note 2', type: 'note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      // Click Notes tab
      const notesTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.notes/i });
      fireEvent.click(notesTab);

      // Should show only notes
      expect(screen.getByText('Regular Note 1')).toBeInTheDocument();
      expect(screen.getByText('Regular Note 2')).toBeInTheDocument();
      expect(screen.queryByText('Question 1')).not.toBeInTheDocument();
    });

    it('filters to show only questions when Questions tab is clicked', () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Regular Note', type: 'note' }),
        createMockNote({ id: '2', title: 'My Question', type: 'question' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      // Click Questions tab
      const questionsTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.questions/i });
      fireEvent.click(questionsTab);

      // Should show only questions
      expect(screen.getByText('My Question')).toBeInTheDocument();
      expect(screen.queryByText('Regular Note')).not.toBeInTheDocument();
    });

    it('shows all notes when All tab is clicked after filtering', () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Regular Note', type: 'note' }),
        createMockNote({ id: '2', title: 'My Question', type: 'question' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      // First click Questions tab
      const questionsTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.questions/i });
      fireEvent.click(questionsTab);

      // Then click All tab
      const allTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.all/i });
      fireEvent.click(allTab);

      // Should show all notes
      expect(screen.getByText('Regular Note')).toBeInTheDocument();
      expect(screen.getByText('My Question')).toBeInTheDocument();
    });



    it('combines tab filter with search', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Genesis study', type: 'note' }),
        createMockNote({ id: '2', title: 'Exodus question', type: 'question' }),
        createMockNote({ id: '3', title: 'Genesis question', type: 'question' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      // Click Questions tab
      const questionsTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.questions/i });
      fireEvent.click(questionsTab);

      // Verify the question is visible BEFORE searching
      expect(screen.getByText('Genesis question')).toBeInTheDocument();
      // Verify the note is filtered out by tab
      expect(screen.queryByText('Genesis study')).not.toBeInTheDocument();

      // Type search query
      const searchInput = screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i);
      fireEvent.change(searchInput, { target: { value: 'Genesis' } });

      // Should show only the Genesis question (not the Genesis note or Exodus question)
      // Using waitFor to ensure filtering applies (waiting for item to disappear)
      await waitFor(() => {
        expect(screen.queryByText('Exodus question')).not.toBeInTheDocument();
      });

      const visibleCards = screen.getAllByRole('article');
      expect(visibleCards).toHaveLength(1);
      expect(visibleCards[0]).toHaveTextContent(/Genesis question/i);
      expect(visibleCards[0]).not.toHaveTextContent(/Genesis study/i);
    });

    it('matches multi-word searches regardless of order', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Жертва Адама' }),
        createMockNote({ id: '2', title: 'Жертва' }),
        createMockNote({ id: '3', title: 'Адама и Каина' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      const searchInput = screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i);
      fireEvent.change(searchInput, { target: { value: 'адама жертва' } });

      await waitFor(() => {
        const visibleCards = screen.getAllByRole('article');
        expect(visibleCards).toHaveLength(1);
      });

      expect(screen.getByRole('heading', { name: /Жертва Адама/i })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /^Жертва$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Адама и Каина/i })).not.toBeInTheDocument();
    });
  });

  describe('Search rendering (snippets/tags/refs)', () => {
    const changeSearch = async (value: string) => {
      const searchInput = screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i);
      fireEvent.change(searchInput, { target: { value } });
      await waitFor(() => expect(searchInput).toHaveValue(value));
    };

    it('shows content snippet when content matches token', async () => {
      const notes: StudyNote[] = [
        createMockNote({
          id: 'content-match',
          title: 'Content Note',
          content: 'Lorem alpha ipsum dolor sit amet.',
        }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      await changeSearch('alpha');

      // Card remains visible
      expect(screen.getByRole('heading', { name: /Content Note/i })).toBeInTheDocument();
      // Snippet contains the token
      expect(screen.getByText(/alpha/i)).toBeInTheDocument();
    });

    it('shows tag chip when only tags match', async () => {
      const notes: StudyNote[] = [
        createMockNote({
          id: 'tag-match',
          title: 'Tag Note',
          content: 'No content hit here.',
          tags: ['alpha-tag'],
        }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      await changeSearch('alpha');

      expect(screen.getByRole('heading', { name: /Tag Note/i })).toBeInTheDocument();
      expect(screen.getByText(/alpha-tag/i)).toBeInTheDocument();
    });

    it('shows scripture ref chip when only refs match', async () => {
      const notes: StudyNote[] = [
        createMockNote({
          id: 'ref-match',
          title: 'Ref Note',
          content: 'No content hit here.',
          scriptureRefs: [
            { id: 'r1', book: 'Genesis', chapter: 1, fromVerse: 1 },
          ],
        }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      await changeSearch('Genesis 1:1');

      const card = await screen.findByRole('article');
      expect(within(card).getByRole('heading', { name: /Ref Note/i })).toBeInTheDocument();
      expect(within(card).getByText(/Genesis/i)).toBeInTheDocument();
      expect(within(card).getByText(/1:1/i)).toBeInTheDocument();
    });

    it('hides cards when nothing matches any field', async () => {
      const notes: StudyNote[] = [
        createMockNote({
          id: 'no-match',
          title: 'Some Note',
          content: 'Foo bar baz',
          tags: ['tag1'],
          scriptureRefs: [{ id: 'r1', book: 'Genesis', chapter: 1, fromVerse: 1 }],
        }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      await changeSearch('nomatch');

      // No cards should be visible
      expect(screen.queryAllByRole('article')).toHaveLength(0);

      // Header count should reflect zero matches
      const matchingNotesLabels = screen.getAllByText(/matchingNotes/i);
      expect(matchingNotesLabels[0]).toHaveTextContent('0');
    });
  });
});
