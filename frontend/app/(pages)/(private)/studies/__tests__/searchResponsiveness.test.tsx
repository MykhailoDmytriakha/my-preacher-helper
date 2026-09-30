import { render, screen, waitFor } from '@testing-library/react';

import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { StudyNote } from '@/models/models';

import StudiesPage from '../page';

// Every card render, with the query it was drawn for.
const mockCardRenders: string[] = [];
jest.mock('../StudyNoteCard', () => ({
  __esModule: true,
  default: ({ note, searchQuery }: { note: { title: string }; searchQuery?: string }) => {
    mockCardRenders.push(searchQuery ?? '');
    return <div data-testid="card">{note.title}</div>;
  },
}));

// One router for the page's lifetime, as Next's is: a fresh object per call would rebuild every memo that uses it.
const mockRouter = { push: jest.fn(), refresh: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/studies',
  useSearchParams: () => new URLSearchParams(),
}));

// Seedable store so tests can simulate an initial URL param (e.g. ?search=…),
// mirroring how nuqs reads the query string on mount.
const mockQueryState: Record<string, string> = {};

jest.mock('nuqs', () => {
  const React = require('react');
  return {
    useQueryState: jest.fn((key: string, options: any) => {
      const initial = mockQueryState[key] ?? options?.defaultValue ?? '';
      const [state, setState] = React.useState(initial);
      return [
        state,
        (next: string) => {
          mockQueryState[key] = next;
          setState(next);
          return Promise.resolve(next);
        },
      ];
    }),
  };
});

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

jest.mock('@/hooks/useStudyNoteShareLinks', () => ({
  useStudyNoteShareLinks: jest.fn(),
}));

jest.mock('@/hooks/useTags', () => ({
  useTags: jest.fn(),
}));

jest.mock('../bibleData', () => ({
  // The real module underneath, so nothing the page (or the shared reference formatter it now
  // uses) reaches for can silently vanish — the trap the old comment here warned about.
  ...jest.requireActual('../bibleData'),
  getBooksForDropdown: jest.fn().mockReturnValue([]),
  getLocalizedBookName: jest.fn().mockImplementation((book) => book),
  resolveBibleLocale: jest.fn().mockReturnValue('en'),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;
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

const baseUseStudyNoteShareLinksValue = (): ReturnType<typeof useStudyNoteShareLinks> => ({
  uid: 'mock-user',
  shareLinks: [],
  loading: false,
  error: null,
  refetch: jest.fn(),
  createShareLink: jest.fn(),
  deleteShareLink: jest.fn(),
});

/**
 * BUG-20260809-studies-search-lag: filtering, snippets and highlighting of every card ran inside the
 * keystroke itself, so with a few hundred notes each letter froze the field. The keystroke must
 * update the field at once and leave the list to a later, interruptible render.
 */
describe('StudiesPage search responsiveness', () => {
  const typeWithoutAct = (input: HTMLInputElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    for (const key of Object.keys(mockQueryState)) delete mockQueryState[key];
    mockUseStudyNotes.mockReturnValue({
      ...baseUseStudyNotesValue(),
      notes: Array.from({ length: 30 }, (_, i) => createMockNote({ id: `n${i}`, title: `Note ${i}`, content: `grace ${i}` })),
    });
    mockUseStudyNoteShareLinks.mockReturnValue(baseUseStudyNoteShareLinksValue());
    mockUseTags.mockReturnValue({
      tags: { requiredTags: [], customTags: [] }, requiredTags: [], customTags: [], allTags: [],
      loading: false, error: null, refreshTags: jest.fn(), addCustomTag: jest.fn(), removeCustomTag: jest.fn(), updateTag: jest.fn(),
    });
  });

  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('shows the letter at once and draws the list for it afterwards', async () => {
    render(<StudiesPage />);
    const input = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    mockCardRenders.length = 0;

    // A real keystroke: no act() around it, so React schedules work the way the browser does.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    typeWithoutAct(input, 'g');

    expect(input.value).toBe('g');
    // Not a single card in the keystroke itself — neither for the new query nor redrawn for the old one.
    expect(mockCardRenders).toHaveLength(0);
    // Until the list catches up it says so, and bulk actions wait for it.
    expect(screen.getByTestId('study-results')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: /studiesWorkspace\.expandAll/ })).toBeDisabled();

    await waitFor(() => expect(mockCardRenders.filter((query) => query === 'g')).toHaveLength(30));
    await waitFor(() => expect(screen.getByTestId('study-results')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByRole('button', { name: /studiesWorkspace\.expandAll/ })).toBeEnabled();
  });
});
