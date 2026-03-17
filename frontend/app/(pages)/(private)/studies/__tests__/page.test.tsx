import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useStudyNoteBranchStates } from '@/hooks/useStudyNoteBranchStates';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { StudyNote } from '@/models/models';
import { createStudyNoteBranchStateRecord } from '../components/studyNoteBranchIdentity';
import { parseStudyNoteOutline } from '../components/studyNoteOutline';

import StudiesPage from '../page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
  }),
  usePathname: () => '/studies',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('nuqs', () => {
  const React = require('react');
  return {
    useQueryState: jest.fn((key: string, options: any) => {
      const defaultValue = options?.defaultValue || '';
      const [state, setState] = React.useState(defaultValue);
      return [state, setState];
    }),
  };
});

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

jest.mock('@/hooks/useStudyNoteBranchStates', () => ({
  useStudyNoteBranchStates: jest.fn(),
}));

jest.mock('@/hooks/useStudyNoteShareLinks', () => ({
  useStudyNoteShareLinks: jest.fn(),
}));

jest.mock('@/hooks/useTags', () => ({
  useTags: jest.fn(),
}));

jest.mock('../bibleData', () => ({
  getBooksForDropdown: jest.fn().mockReturnValue([]),
  getLocalizedBookName: jest.fn().mockImplementation((book) => book),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;
const mockUseStudyNoteBranchStates = useStudyNoteBranchStates as jest.MockedFunction<typeof useStudyNoteBranchStates>;
const mockUseStudyNoteShareLinks = useStudyNoteShareLinks as jest.MockedFunction<typeof useStudyNoteShareLinks>;
const mockUseTags = useTags as jest.MockedFunction<typeof useTags>;

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

const baseUseStudyNoteBranchStatesValue = (): ReturnType<typeof useStudyNoteBranchStates> => ({
  uid: 'mock-user',
  branchStates: [],
  loading: false,
  error: null,
  refetch: jest.fn(),
});

const baseUseStudyNoteShareLinksValue = (): ReturnType<typeof useStudyNoteShareLinks> => ({
  uid: 'mock-user',
  shareLinks: [],
  loading: false,
  error: null,
  refetch: jest.fn(),
  createShareLink: jest.fn(),
  deleteShareLink: jest.fn(),
});

describe('StudiesPage', () => {
  beforeEach(() => {
    mockUseStudyNotes.mockReturnValue(baseUseStudyNotesValue());
    mockUseStudyNoteBranchStates.mockReturnValue(baseUseStudyNoteBranchStatesValue());
    mockUseStudyNoteShareLinks.mockReturnValue(baseUseStudyNoteShareLinksValue());
    mockUseTags.mockReturnValue({
      tags: { requiredTags: [], customTags: [] },
      requiredTags: [],
      customTags: [],
      allTags: [],
      loading: false,
      error: null,
      refreshTags: jest.fn(),
      addCustomTag: jest.fn(),
      removeCustomTag: jest.fn(),
      updateTag: jest.fn(),
    });
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

      const notesTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.notes/i });
      fireEvent.click(notesTab);

      // Should show only notes
      expect(screen.getByRole('heading', { name: 'Regular Note 1' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Regular Note 2' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Question 1' })).not.toBeInTheDocument();
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

      const questionsTab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.questions/i });
      fireEvent.click(questionsTab);

      // Should show only questions
      expect(screen.getByRole('heading', { name: 'My Question' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Regular Note' })).not.toBeInTheDocument();
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
      expect(screen.getByRole('heading', { name: 'Regular Note' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'My Question' })).toBeInTheDocument();
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
      expect(screen.getByRole('heading', { name: 'Genesis question' })).toBeInTheDocument();
      // Verify the note is filtered out by tab
      expect(screen.queryByRole('heading', { name: 'Genesis study' })).not.toBeInTheDocument();

      // Type search query
      const searchInput = screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i);
      fireEvent.change(searchInput, { target: { value: 'Genesis' } });

      // Should show only the Genesis question (not the Genesis note or Exodus question)
      // Using waitFor to ensure filtering applies (waiting for item to disappear)
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Exodus question' })).not.toBeInTheDocument();
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
      await waitFor(() => expect(screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i)).toHaveValue(value));
    };

    it('shows a clear search button and resets the query and results', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Alpha note' }),
        createMockNote({ id: '2', title: 'Beta note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });

      render(<StudiesPage />);

      const searchInput = screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i);
      expect(
        screen.queryByRole('button', { name: /clear search|studiesWorkspace\.clearSearch/i })
      ).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'Alpha' } });

      const clearButton = await screen.findByRole('button', {
        name: /clear search|studiesWorkspace\.clearSearch/i,
      });

      await waitFor(() => {
        const visibleCards = screen.getAllByRole('article');
        expect(visibleCards).toHaveLength(1);
        expect(visibleCards[0]).toHaveTextContent(/Alpha note/i);
      });

      await userEvent.click(clearButton);

      await waitFor(() => expect(screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i)).toHaveValue(''));

      const allCards = screen.getAllByRole('article');
      expect(allCards).toHaveLength(2);
    });

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

  describe('Branch metadata workspace surfaces', () => {
    it('filters notes by workspace branch kind metadata', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Evidence Note' }),
        createMockNote({ id: '2', title: 'Question Note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: '1',
            noteId: '1',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-1',
                title: 'Evidence',
                titleSlug: 'evidence',
                parentSlugChain: [],
                bodyHash: '1',
                subtreeHash: '1',
                subtreeContentHash: '1',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'evidence',
                branchStatus: 'confirmed',
                semanticLabel: 'Theme',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
          {
            id: '2',
            noteId: '2',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-2',
                title: 'Question',
                titleSlug: 'question',
                parentSlugChain: [],
                bodyHash: '2',
                subtreeHash: '2',
                subtreeContentHash: '2',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'question',
                branchStatus: 'tentative',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      fireEvent.change(screen.getByTestId('studies-branch-kind-filter'), {
        target: { value: 'evidence' },
      });

      await waitFor(() => {
        const visibleCards = screen.getAllByRole('article');
        expect(visibleCards).toHaveLength(1);
      });

      expect(screen.getByRole('heading', { name: 'Evidence Note' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Question Note' })).not.toBeInTheDocument();
      expect(screen.getByText(/studiesWorkspace\.branchMetadata\.notesWithMetadata/i)).toHaveTextContent('2');
    });

    it('filters notes by labeled branches only', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Labeled Note' }),
        createMockNote({ id: '2', title: 'Unlabeled Note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: '1',
            noteId: '1',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-1',
                title: 'Main',
                titleSlug: 'main',
                parentSlugChain: [],
                bodyHash: '1',
                subtreeHash: '1',
                subtreeContentHash: '1',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                semanticLabel: 'Theme',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
          {
            id: '2',
            noteId: '2',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-2',
                title: 'Main',
                titleSlug: 'main',
                parentSlugChain: [],
                bodyHash: '2',
                subtreeHash: '2',
                subtreeContentHash: '2',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      await userEvent.click(screen.getByTestId('studies-branch-label-filter'));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Unlabeled Note' })).not.toBeInTheDocument();
      });

      expect(screen.getByRole('heading', { name: 'Labeled Note' })).toBeInTheDocument();
    });

    it('uses review cards and top labels as retrieval shortcuts', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Evidence Note' }),
        createMockNote({ id: '2', title: 'Grace Note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: '1',
            noteId: '1',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-1',
                title: 'Evidence',
                titleSlug: 'evidence',
                parentSlugChain: [],
                bodyHash: '1',
                subtreeHash: '1',
                subtreeContentHash: '1',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'evidence',
                branchStatus: 'confirmed',
                semanticLabel: 'Grace',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
          {
            id: '2',
            noteId: '2',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-2',
                title: 'Grace',
                titleSlug: 'grace',
                parentSlugChain: [],
                bodyHash: '2',
                subtreeHash: '2',
                subtreeContentHash: '2',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'insight',
                semanticLabel: 'Grace',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      await userEvent.click(screen.getByTestId('studies-metadata-review-card-evidence'));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Grace Note' })).not.toBeInTheDocument();
      });
      expect(screen.getByRole('heading', { name: 'Evidence Note' })).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('studies-top-label-Grace'));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i)).toHaveValue('Grace');
      });
    });

    it('builds relation review surfaces and preserves the active relation lens in branch links', async () => {
      const sourceContent = [
        '## Source Branch',
        'See [Target Branch](#branch=branch-target "supports").',
      ].join('\n');
      const targetContent = [
        '## Target Branch',
        'Target body',
      ].join('\n');
      const targetOutline = parseStudyNoteOutline(targetContent);
      const targetRecord = createStudyNoteBranchStateRecord(targetOutline.branches, '1', 'branch-target');
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Source Note', content: sourceContent }),
        createMockNote({ id: '2', title: 'Target Note', content: targetContent }),
      ];

      expect(targetRecord).not.toBeNull();

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: '2',
            noteId: '2',
            userId: 'mock-user',
            branchRecords: [targetRecord!],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      await userEvent.click(screen.getByTestId(`studies-top-relation-${encodeURIComponent('supports')}`));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Source Note' })).toBeInTheDocument();
      });
      expect(screen.getByRole('heading', { name: 'Target Note' })).toBeInTheDocument();
      expect(screen.getByText('studiesWorkspace.branchMetadata.relationReviewTitle')).toBeInTheDocument();

      const relationLink = screen.getByTestId(`studies-relation-item-${encodeURIComponent('supports')}-branch-target`);
      expect(relationLink).toHaveAttribute('href', '/studies/2?branchRelation=supports#branch=branch-target');
      expect(relationLink).toHaveTextContent('Source Branch');
      expect(relationLink).toHaveTextContent('Target Branch');
    });

    it('builds scope-aware synthesis lanes from visible notes while keeping broader relation context', async () => {
      const questionContent = [
        '## Open Question',
        'Question body',
      ].join('\n');
      const evidenceContent = [
        '## Confirmed Evidence',
        'Supports [Open Question](#branch=question-branch "supports").',
      ].join('\n');
      const questionOutline = parseStudyNoteOutline(questionContent);
      const questionRecord = createStudyNoteBranchStateRecord(questionOutline.branches, '1', 'question-branch');

      expect(questionRecord).not.toBeNull();

      const notes: StudyNote[] = [
        createMockNote({ id: 'question-note', title: 'Primary Question', content: questionContent }),
        createMockNote({ id: 'evidence-note', title: 'Evidence Support', content: evidenceContent }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: 'question-note',
            noteId: 'question-note',
            userId: 'mock-user',
            branchRecords: [
              {
                ...questionRecord!,
                branchKind: 'question',
                branchStatus: 'tentative',
                semanticLabel: 'Grace',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
          },
          {
            id: 'evidence-note',
            noteId: 'evidence-note',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'evidence-branch',
                title: 'Confirmed Evidence',
                titleSlug: 'confirmed-evidence',
                parentSlugChain: [],
                bodyHash: '2',
                subtreeHash: '2',
                subtreeContentHash: '2',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'evidence',
                branchStatus: 'confirmed',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      fireEvent.change(screen.getByTestId('studies-branch-kind-filter'), {
        target: { value: 'question' },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Primary Question' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: 'Evidence Support' })).not.toBeInTheDocument();

      expect(screen.getByText('studiesWorkspace.branchMetadata.synthesisTitle')).toBeInTheDocument();
      expect(screen.getByTestId('studies-synthesis-card-openQuestions')).toHaveTextContent('1');
      expect(screen.getByTestId('studies-synthesis-lane-openQuestions')).toBeInTheDocument();
      expect(screen.getByTestId('studies-synthesis-item-openQuestions-question-branch')).toHaveTextContent('Open Question');
      expect(screen.getByTestId('studies-synthesis-item-openQuestions-question-branch')).toHaveTextContent('studiesWorkspace.outlinePilot.branchRelations.supports');
      expect(screen.getAllByText(/studiesWorkspace\.branchMetadata\.synthesisCards\.openQuestions/i).length).toBeGreaterThan(0);
    });

    it('keeps synthesis support badges when search narrows the visible notes but not the workspace relation graph', async () => {
      const questionContent = [
        '## Open Question',
        'Question body',
      ].join('\n');
      const evidenceContent = [
        '## Confirmed Evidence',
        'Supports [Open Question](#branch=question-branch "supports").',
      ].join('\n');
      const questionOutline = parseStudyNoteOutline(questionContent);
      const questionRecord = createStudyNoteBranchStateRecord(questionOutline.branches, '1', 'question-branch');

      expect(questionRecord).not.toBeNull();

      const notes: StudyNote[] = [
        createMockNote({ id: 'question-note', title: 'Primary Question', content: questionContent }),
        createMockNote({ id: 'evidence-note', title: 'Evidence Support', content: evidenceContent }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: 'question-note',
            noteId: 'question-note',
            userId: 'mock-user',
            branchRecords: [
              {
                ...questionRecord!,
                branchKind: 'question',
                branchStatus: 'tentative',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      fireEvent.change(screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i), {
        target: { value: 'Primary' },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Primary Question' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: 'Evidence Support' })).not.toBeInTheDocument();
      expect(screen.getByTestId('studies-synthesis-item-openQuestions-question-branch')).toHaveTextContent(
        'studiesWorkspace.outlinePilot.branchRelations.supports'
      );
    });

    it('renders question-centered synthesis clusters with hidden support and application branches from the wider workspace graph', async () => {
      const questionContent = [
        '## Open Question',
        'Question body',
      ].join('\n');
      const evidenceContent = [
        '## Confirmed Evidence',
        'Supports [Open Question](#branch=question-branch "supports").',
      ].join('\n');
      const applicationContent = [
        '## Application Step',
        'Applies [Open Question](#branch=question-branch "applies").',
      ].join('\n');
      const questionOutline = parseStudyNoteOutline(questionContent);
      const evidenceOutline = parseStudyNoteOutline(evidenceContent);
      const applicationOutline = parseStudyNoteOutline(applicationContent);
      const questionRecord = createStudyNoteBranchStateRecord(questionOutline.branches, '1', 'question-branch');
      const evidenceRecord = createStudyNoteBranchStateRecord(evidenceOutline.branches, '1', 'evidence-branch');
      const applicationRecord = createStudyNoteBranchStateRecord(applicationOutline.branches, '1', 'application-branch');

      expect(questionRecord).not.toBeNull();
      expect(evidenceRecord).not.toBeNull();
      expect(applicationRecord).not.toBeNull();

      const notes: StudyNote[] = [
        createMockNote({ id: 'question-note', title: 'Primary Question', content: questionContent }),
        createMockNote({ id: 'evidence-note', title: 'Evidence Support', content: evidenceContent }),
        createMockNote({ id: 'application-note', title: 'Application Guide', content: applicationContent }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: 'question-note',
            noteId: 'question-note',
            userId: 'mock-user',
            branchRecords: [
              {
                ...questionRecord!,
                branchKind: 'question',
                branchStatus: 'tentative',
                semanticLabel: 'Grace',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
          {
            id: 'evidence-note',
            noteId: 'evidence-note',
            userId: 'mock-user',
            branchRecords: [
              {
                ...evidenceRecord!,
                branchKind: 'evidence',
                branchStatus: 'confirmed',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
          {
            id: 'application-note',
            noteId: 'application-note',
            userId: 'mock-user',
            branchRecords: [
              {
                ...applicationRecord!,
                branchKind: 'application',
                branchStatus: 'active',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      fireEvent.change(screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i), {
        target: { value: 'Primary' },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Primary Question' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: 'Evidence Support' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Application Guide' })).not.toBeInTheDocument();

      expect(screen.getByTestId('studies-synthesis-clusters')).toBeInTheDocument();
      expect(screen.getByTestId('studies-synthesis-cluster-group-readyToApply')).toBeInTheDocument();
      expect(screen.getByTestId('studies-synthesis-cluster-question-branch')).toHaveTextContent('Open Question');

      const supportLink = screen.getByTestId(
        'studies-synthesis-cluster-link-question-branch-support-evidence-branch'
      );
      expect(supportLink).toHaveTextContent('Confirmed Evidence');
      expect(supportLink).toHaveAttribute('href', '/studies/evidence-note?search=Primary#branch=evidence-branch');

      const applicationLink = screen.getByTestId(
        'studies-synthesis-cluster-link-question-branch-application-application-branch'
      );
      expect(applicationLink).toHaveTextContent('Application Step');
      expect(applicationLink).toHaveAttribute('href', '/studies/application-note?search=Primary#branch=application-branch');

      fireEvent.click(screen.getByTestId('studies-synthesis-cluster-mode-theme'));
      expect(screen.getByTestId('studies-synthesis-cluster-group-grace')).toBeInTheDocument();

      const themedApplicationLink = screen.getByTestId(
        'studies-synthesis-cluster-link-question-branch-application-application-branch'
      );
      expect(themedApplicationLink).toHaveAttribute(
        'href',
        '/studies/application-note?search=Primary&synthesisGroup=theme#branch=application-branch'
      );
    });

    it('renders branch review lanes as a stable cross-note inventory and preserves the query lens in branch links', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Evidence Note' }),
        createMockNote({ id: '2', title: 'Question Note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: '1',
            noteId: '1',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-1',
                title: 'Evidence branch',
                titleSlug: 'evidence-branch',
                parentSlugChain: [],
                bodyHash: '1',
                subtreeHash: '1',
                subtreeContentHash: '1',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'evidence',
                branchStatus: 'confirmed',
                semanticLabel: 'Grace',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
          {
            id: '2',
            noteId: '2',
            userId: 'mock-user',
            branchRecords: [
              {
                branchId: 'branch-2',
                title: 'Question branch',
                titleSlug: 'question-branch',
                parentSlugChain: [],
                bodyHash: '2',
                subtreeHash: '2',
                subtreeContentHash: '2',
                subtreeOccurrenceIndex: 0,
                contextualOccurrenceIndex: 0,
                relaxedOccurrenceIndex: 0,
                contextualContentOccurrenceIndex: 0,
                relaxedContentOccurrenceIndex: 0,
                branchKind: 'question',
                branchStatus: 'tentative',
              },
            ],
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      fireEvent.change(screen.getByTestId('studies-branch-kind-filter'), {
        target: { value: 'evidence' },
      });

      expect(screen.getByTestId('studies-review-lane-evidence')).toBeInTheDocument();
      expect(screen.getByTestId('studies-review-lane-question')).toBeInTheDocument();
      expect(screen.getByText('studiesWorkspace.branchMetadata.reviewLanes.evidence')).toBeInTheDocument();

      const anchoredBranchLink = screen.getByTestId('studies-review-branch-evidence-branch-1');
      expect(anchoredBranchLink).toHaveAttribute('href', '/studies/1?branchKind=evidence#branch=branch-1');
      expect(anchoredBranchLink).toHaveTextContent('Evidence branch');
      expect(anchoredBranchLink).toHaveTextContent('Evidence Note');
      expect(anchoredBranchLink).toHaveTextContent('studiesWorkspace.branchMetadata.anchorNeedsRefresh');
    });

    it('allows expanding a review lane beyond the collapsed limit', async () => {
      const notes: StudyNote[] = [
        createMockNote({ id: '1', title: 'Evidence Note' }),
      ];

      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes,
      });
      mockUseStudyNoteBranchStates.mockReturnValue({
        ...baseUseStudyNoteBranchStatesValue(),
        branchStates: [
          {
            id: '1',
            noteId: '1',
            userId: 'mock-user',
            branchRecords: Array.from({ length: 5 }, (_, index) => ({
              branchId: `branch-${index + 1}`,
              title: `Evidence branch ${index + 1}`,
              titleSlug: `evidence-branch-${index + 1}`,
              parentSlugChain: [],
              bodyHash: `${index + 1}`,
              subtreeHash: `${index + 1}`,
              subtreeContentHash: `${index + 1}`,
              subtreeOccurrenceIndex: 0,
              contextualOccurrenceIndex: 0,
              relaxedOccurrenceIndex: 0,
              contextualContentOccurrenceIndex: 0,
              relaxedContentOccurrenceIndex: 0,
              branchKind: 'evidence',
            })),
            readFoldedBranchIds: [],
            previewFoldedBranchIds: [],
            createdAt: '2026-03-13T00:00:00.000Z',
            updatedAt: '2026-03-13T00:00:00.000Z',
          },
        ] as any,
      });

      render(<StudiesPage />);

      const evidenceLane = screen.getByTestId('studies-review-lane-evidence');

      expect(within(evidenceLane).getAllByRole('link')).toHaveLength(4);

      await userEvent.click(screen.getByTestId('studies-review-lane-toggle-evidence'));

      expect(within(evidenceLane).getAllByRole('link')).toHaveLength(5);
      expect(screen.getByText('studiesWorkspace.branchMetadata.showLessLaneItems')).toBeInTheDocument();
    });
  });
});
