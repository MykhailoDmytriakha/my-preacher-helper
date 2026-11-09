import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { StudyNote } from '@/models/models';
import { draftKey } from '@/utils/durableDraft';
import { __resetConnectivityForTests, getConnectivityStatus, reportServerReachable } from '@/utils/connectivity';
import { STUDIES_ACTION } from '@/utils/themeColors';

import StudiesPage from '../page';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { toast } from 'sonner';

// The archive has its own real-component tests; this suite owns list/search behavior.
jest.mock('../components/UnassignedNoteRecordings', () => ({ __esModule: true, default: () => null }));
const mockPush = jest.fn();
jest.mock('sonner', () => ({
  ...jest.requireActual('sonner'),
  toast: Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn(), message: jest.fn() }),
}));
jest.mock('../StudyAnalysisWindow', () => ({
  ...jest.requireActual('../StudyAnalysisWindow'),
  StudyAnalysisWindow: ({ note, editing, onClose }: { note: { id: string }; editing: boolean; onClose: () => void }) => (
    <div data-testid="analysis-window" data-id={note.id} data-editing={String(editing)}>
      <button type="button" onClick={onClose}>close-analysis</button>
    </div>
  ),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
  }),
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

// The comment's window and the place picker have their own suites; here only what the page hands them matters.
jest.mock('@/components/CommentDialog', () => ({
  CommentDialog: ({ target, placePicker }: { target: { kind: string; reference?: { book: string; chapter?: number } | null }; placePicker?: (window: { requestClose: () => void }) => React.ReactNode }) => (
    <div data-testid="comment-window">
      <p data-testid="comment-place">{target.kind === 'new' && target.reference ? `${target.reference.book} ${target.reference.chapter}` : 'none'}</p>
      {placePicker?.({ requestClose: () => undefined })}
    </div>
  ),
}));
// The analysis's own screen has its suite (the analysis editor's); here only what the list hands it matters.
jest.mock('../StudyAnalysisWindow', () => ({
  ...jest.requireActual('../StudyAnalysisWindow'),
  StudyAnalysisWindow: ({ note, editing, onClose }: { note: { id: string }; editing: boolean; onClose: () => void }) => (
    <div data-testid="analysis-window" data-id={note.id} data-editing={String(editing)}>
      <button type="button" onClick={onClose}>close-analysis</button>
    </div>
  ),
}));
jest.mock('../ScriptureRefPicker', () => ({
  __esModule: true,
  default: ({ onConfirm }: { onConfirm: (picked: { id: string; book: string; chapter: number }) => void }) => (
    <button type="button" onClick={() => onConfirm({ id: 'p', book: 'Psalms', chapter: 23 })}>pick-psalm-23</button>
  ),
}));

jest.mock('@/utils/bibleBooks', () => ({
  // The real module underneath, so nothing the page (or the shared reference formatter it now
  // uses) reaches for can silently vanish — the trap the old comment here warned about.
  ...jest.requireActual('@/utils/bibleBooks'),
  getBooksForDropdown: jest.fn().mockReturnValue([]),
  getLocalizedBookName: jest.fn().mockImplementation((book) => book),
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
  noteDelivery: new Map(),
  observeTitle: jest.fn(),
  observeTagBasis: jest.fn(),
  captureActionTime: jest.fn(),
  notePresence: () => ({ kind: 'unknown', source: null, snapshot: null }),
  confirmedDictationSources: new Map(),
  confirmedCreationIds: new Set(),
  commentCollectionReady: true,
  loading: false,
  checking: false,
  error: null,
  refetch: jest.fn(),
  recoverAnalysisCreation: jest.fn(),
  releaseAnalysisCreation: jest.fn(),
  combineAnalysisCreation: jest.fn(),
  createNote: jest.fn(),
  reshapeNotes: jest.fn(),
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

describe('StudiesPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    (toast as unknown as jest.Mock).mockClear();
    for (const key of Object.keys(mockQueryState)) delete mockQueryState[key];
    mockUseStudyNotes.mockReturnValue(baseUseStudyNotesValue());
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
      updateTag: jest.fn(), observeColor: jest.fn(), captureActionTime: jest.fn(),
    });
  });

  it('shows each unfinished note with its own continue link after the list opens', () => {
    localStorage.clear();
    const put = (owner: string, id: string) => localStorage.setItem(`draft:v1:${owner}:new~${id}:note`, JSON.stringify({ savedAt: 1, creationTargetId: id,
      value: { title: `Title ${id}`, content: `Words ${id}`, tags: [], scriptureRefs: [], type: 'note' } }));
    put('mock-user', 'A'); put('mock-user', 'B'); put('other-owner', 'private');
    const view = render(<StudiesPage />);
    try {
      expect(screen.getByRole('link', { name: /Title A/ })).toHaveAttribute('href', '/studies/new?draft=new~A&draftOwner=mock-user&draftCopy=draft%3Av1%3Amock-user%3Anew~A%3Anote');
      expect(screen.getByRole('link', { name: /Title B/ })).toHaveAttribute('href', '/studies/new?draft=new~B&draftOwner=mock-user&draftCopy=draft%3Av1%3Amock-user%3Anew~B%3Anote');
      expect(screen.queryByText('Words private')).not.toBeInTheDocument();
      expect(screen.getByText('Words A')).toBeInTheDocument();
      expect(screen.getByText('Words B')).toBeInTheDocument();
    } finally { view.unmount(); localStorage.clear(); }
  });

  it('shows the actual note once and keeps differing backup words after its creation is confirmed', () => {
    localStorage.clear();
    const key = 'draft:v1:mock-user:new~A:note';
    localStorage.setItem(key, JSON.stringify({ savedAt: 1, creationTargetId: 'A', value: { title: 'Uncreated title', content: 'Kept words', tags: [], scriptureRefs: [], type: 'note' } }));
    mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'A', title: 'Captured title' })] });
    const view = render(<StudiesPage />);
    try {
      expect(screen.queryByRole('link', { name: /Uncreated title/ })).not.toBeInTheDocument();
      expect(localStorage.getItem(key)).not.toBeNull();
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'A', title: 'Captured title' })], confirmedCreationIds: new Set(['A']) });
      view.rerender(<StudiesPage />);
      expect(localStorage.getItem(key)).not.toBeNull();
      expect(screen.queryByRole('link', { name: /Uncreated title/ })).not.toBeInTheDocument();
    } finally { view.unmount(); localStorage.clear(); }
  });

  it('links a confirmed precreate copy to its created note while keeping the source copy', async () => {
    localStorage.clear();
    const key = draftKey('mock-user', 'new~A', 'note');
    const kept = { title: 'Created but unfinished', content: 'Keep these words', tags: [], scriptureRefs: [], type: 'note' };
    const raw = JSON.stringify({ value: kept, savedAt: 1, creationTargetId: 'A' });
    localStorage.setItem(key, raw);
    mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [], confirmedCreationIds: new Set(['A']) });
    const view = render(<StudiesPage />);
    try {
      const link = await screen.findByRole('link', { name: /Created but unfinished/ });
      expect(link).toHaveAttribute('href', `/studies/A?draftCopy=${encodeURIComponent(key)}`);
      expect(localStorage.getItem(key)).toBe(raw);
    } finally { view.unmount(); localStorage.clear(); }
  });

  describe('a list that failed to load, with the phone flag saying offline', () => {
    const setPhoneFlag = (value: boolean) =>
      Object.defineProperty(navigator, 'onLine', { configurable: true, value });
    beforeEach(() => {
      __resetConnectivityForTests();
      setPhoneFlag(false);
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), error: new Error('load failed') });
    });
    afterEach(() => {
      setPhoneFlag(true);
      __resetConnectivityForTests();
    });

    it('says there is no network while nothing has reached the server', () => {
      render(<StudiesPage />);
      expect(screen.getByText('studiesWorkspace.loadOffline')).toBeInTheDocument();
    });

    it('says the load failed once a request has reached the server, though the flag is stuck (BUG-20261011-raw-phone-flag-in-read-paths)', () => {
      getConnectivityStatus();
      reportServerReachable();
      render(<StudiesPage />);
      expect(screen.getByText('studiesWorkspace.loadError')).toBeInTheDocument();
    });
  });

  describe('failed read presentation', () => {
    it('keeps the failure and ordinary creation without a first-note invitation', () => {
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), error: new Error('Read refused') });
      render(<StudiesPage />);
      expect(screen.getByText('studiesWorkspace.loadError')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'studiesWorkspace.newNote' })).toBeEnabled();
      expect(screen.queryByText('studiesWorkspace.noNotes')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'studiesWorkspace.createFirstNote' })).not.toBeInTheDocument();
    });

    it('does not report failed notes as zero in the summary, tabs or result count', () => {
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), error: new Error('Read refused') });
      render(<StudiesPage />);
      expect(screen.queryByText('0 studiesWorkspace.stats.notesLabel')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^studiesWorkspace.tabs.all/ })).not.toHaveTextContent('(0)');
      expect(screen.queryByText('studiesWorkspace.allNotes')).not.toBeInTheDocument();
    });

    it('does not call an unknown filtered list a no-match result', () => {
      mockQueryState.search = 'missing';
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), error: new Error('Read refused') });
      render(<StudiesPage />);
      expect(screen.getByText('studiesWorkspace.loadError')).toBeInTheDocument();
      expect(screen.queryByText('studiesWorkspace.noMatchingNotes')).not.toBeInTheDocument();
    });

    it('keeps available local notes visible after a read fails', () => {
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), error: new Error('Read refused'), notes: [createMockNote({ id: 'kept', title: 'Kept local note' })] });
      render(<StudiesPage />);
      expect(screen.getByText('Kept local note')).toBeInTheDocument();
      expect(screen.getByText('studiesWorkspace.loadError')).toBeInTheDocument();
    });

    it('keeps the first-note invitation for a successfully read empty list', () => {
      render(<StudiesPage />);
      expect(screen.getByRole('button', { name: 'studiesWorkspace.createFirstNote' })).toBeEnabled();
      expect(screen.getByText('0 studiesWorkspace.stats.notesLabel')).toBeInTheDocument();
    });
  });

  it('shows the stats badge and new note button text', () => {
    render(<StudiesPage />);

    expect(screen.getByText('0 studiesWorkspace.stats.notesLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'studiesWorkspace.newNote' })).toBeInTheDocument();
  });

  // BUG-20260902-note-card-chevron-navigates-instead-of-expanding: folding one card was
  // not wired at all — the only way to see a note without leaving the list was to unfold
  // every card at once.
  describe('Folding cards', () => {
    const seedTwoNotes = () => {
      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes: [
          createMockNote({ id: 'n1', title: 'First note' }),
          createMockNote({ id: 'n2', title: 'Second note' }),
        ],
      });
    };

    it('folds a single card open and shut, leaving the other one alone', async () => {
      seedTwoNotes();
      render(<StudiesPage />);

      const [firstToggle, secondToggle] = screen.getAllByRole('button', {
        name: 'common.expand',
      });

      await userEvent.click(firstToggle);

      expect(
        screen.getByRole('button', { name: 'common.collapse' })
      ).toBeInTheDocument();
      expect(secondToggle).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(screen.getByRole('button', { name: 'common.collapse' }));

      expect(
        screen.queryByRole('button', { name: 'common.collapse' })
      ).not.toBeInTheDocument();
    });

    it('stops offering "collapse all" as soon as one card is folded shut', async () => {
      seedTwoNotes();
      render(<StudiesPage />);

      await userEvent.click(
        screen.getByRole('button', { name: /studiesWorkspace.expandAll/ })
      );
      expect(
        screen.getByRole('button', { name: /studiesWorkspace.collapseAll/ })
      ).toBeInTheDocument();

      // Fold one card shut by hand: the bulk button must stop claiming everything is open.
      await userEvent.click(screen.getAllByRole('button', { name: 'common.collapse' })[0]);

      expect(
        screen.getByRole('button', { name: /studiesWorkspace.expandAll/ })
      ).toBeInTheDocument();
    });
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

    it('counts analyses in their own tab «Разборы» and in «Все», never in «Заметки»', () => {
      // The owner, 02.11: «Изучение, вкладка „Разборы“»; Codex, 30.10: «Все» counts what it shows.
      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes: [createMockNote({ id: '1', type: 'note' }), createMockNote({ id: 'a1', type: 'analysis' }), createMockNote({ id: 'a2', type: 'analysis' })],
      });
      render(<StudiesPage />);
      expect(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.all/i })).toHaveTextContent('(3)');
      expect(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.analyses/i })).toHaveTextContent('(2)');
      expect(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.notes/i })).toHaveTextContent('(1)');
    });

    it('opens an analysis over the list in its own screen, for reading; closed, the list stands as it was', async () => {
      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes: [createMockNote({ id: '1', title: 'Обычная заметка', type: 'note' }), createMockNote({ id: 'a1', title: 'Разбор · Еф 1:3–14', type: 'analysis' })],
      });
      render(<StudiesPage />);
      await userEvent.click(screen.getByRole('button', { name: /studiesWorkspace\.tabs\.analyses/i }));
      expect(screen.queryByText('Обычная заметка')).not.toBeInTheDocument();
      await userEvent.click(screen.getByText('Разбор · Еф 1:3–14'));
      const window = screen.getByTestId('analysis-window');
      expect(window).toHaveAttribute('data-id', 'a1');
      expect(window).toHaveAttribute('data-editing', 'false');
      expect(mockPush).not.toHaveBeenCalled();
      await userEvent.click(screen.getByText('close-analysis'));
      expect(screen.queryByTestId('analysis-window')).not.toBeInTheDocument();
      expect(screen.getByText('Разбор · Еф 1:3–14')).toBeInTheDocument();
    });

    it('offers no share link for an analysis: a share page shows a note\'s words', () => {
      mockUseStudyNotes.mockReturnValue({
        ...baseUseStudyNotesValue(),
        notes: [createMockNote({ id: 'a1', title: 'Разбор · Еф 1:3–14', type: 'analysis' }), createMockNote({ id: '1', title: 'Обычная заметка', type: 'note' })],
      });
      render(<StudiesPage />);
      const card = (title: string) => screen.getByText(title).closest('article') as HTMLElement;
      expect(within(card('Обычная заметка')).getByRole('button', { name: 'studiesWorkspace.shareLinks.shareButton' })).toBeInTheDocument();
      expect(within(card('Разбор · Еф 1:3–14')).queryByRole('button', { name: 'studiesWorkspace.shareLinks.shareButton' })).not.toBeInTheDocument();
    });

    it('opens the analysis the address names again after a reload, in the mode it was in', () => {
      window.history.replaceState(null, '', '/studies?tab=analyses&analysis=a1&mode=edit');
      try {
        mockUseStudyNotes.mockReturnValue({
          ...baseUseStudyNotesValue(),
          notes: [createMockNote({ id: 'a1', title: 'Разбор · Еф 1:3–14', type: 'analysis' })],
        });
        render(<StudiesPage />);
        expect(screen.getByTestId('analysis-window')).toHaveAttribute('data-editing', 'true');
      } finally {
        window.history.replaceState(null, '', '/');
      }
    });

    it('says an analysis the address names that this device does not hold, forgets it, and never opens it later', () => {
      // Codex, 02.11, two rounds: waiting for it opened it late over whatever the person had turned to, and a deleted
      // one stayed in the address for good. The person opens it from the list once it is there.
      window.history.replaceState(null, '', '/studies?tab=analyses&analysis=a1&mode=view');
      try {
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: '1', type: 'note' })] });
        const { rerender } = render(<StudiesPage />);
        expect(toast).toHaveBeenCalledWith('studiesWorkspace.analysisNotHere');
        expect(window.location.search).not.toContain('analysis=');
        mockUseStudyNotes.mockReturnValue({
          ...baseUseStudyNotesValue(),
          notes: [createMockNote({ id: '1', type: 'note' }), createMockNote({ id: 'a1', title: 'Разбор · Еф 1:3–14', type: 'analysis' })],
        });
        rerender(<StudiesPage />);
        expect(screen.queryByTestId('analysis-window')).not.toBeInTheDocument();
        expect(screen.getByText('Разбор · Еф 1:3–14')).toBeInTheDocument();
      } finally {
        window.history.replaceState(null, '', '/');
      }
    });

    it('opened at an analysis from the Bible («Все разборы»), brings its card into sight and lights it for a moment, once', () => {
      // The owner, 03.11: «был в Библии… нашел какой-то разбор… могу выйти туда к изучению». The address lets the way in
      // go once it is taken: a reload or the list coming again does not scroll back to it.
      jest.useFakeTimers();
      const scroll = jest.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scroll;
      window.history.replaceState(null, '', '/studies?tab=analyses&at=a2');
      mockQueryState.tab = 'analyses';
      try {
        const notes = [createMockNote({ id: 'a1', title: 'Разбор · Рим 8', type: 'analysis' }), createMockNote({ id: 'a2', title: 'Разбор · Еф 1:3–14', type: 'analysis' })];
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes });
        const { rerender } = render(<StudiesPage />);
        act(() => { jest.advanceTimersByTime(100); });
        const card = (title: string) => screen.getByText(title).closest('article') as HTMLElement;
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll.mock.contexts[0]).toBe(card('Разбор · Еф 1:3–14'));
        expect(card('Разбор · Еф 1:3–14')).toHaveAttribute('data-lit', 'true');
        expect(card('Разбор · Рим 8')).not.toHaveAttribute('data-lit');
        expect(window.location.search).toBe('?tab=analyses');
        // The keyboard and a screen reader arrive with the eye: the card's row holds the focus.
        expect(document.activeElement).toBe(card('Разбор · Еф 1:3–14').querySelector('[role="button"][tabindex="0"]'));
        expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [...notes] });
        rerender(<StudiesPage />);
        act(() => { jest.advanceTimersByTime(3000); });
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(card('Разбор · Еф 1:3–14')).not.toHaveAttribute('data-lit');
      } finally {
        Element.prototype.scrollIntoView = original;
        jest.useRealTimers();
        window.history.replaceState(null, '', '/');
      }
    });

    it('opened at an analysis the list on this device has not got yet, waits a few seconds for it and brings it then', () => {
      // Codex, 04.11, twice: the address let the way in go before the server's answer, whose analysis was then never brought
      // into sight — the list's cache comes first with no check under way. A device that asks for less motion is brought
      // there without the glide.
      jest.useFakeTimers();
      const scroll = jest.fn();
      const original = Element.prototype.scrollIntoView;
      const originalMedia = window.matchMedia;
      Element.prototype.scrollIntoView = scroll;
      window.matchMedia = jest.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: jest.fn(), removeEventListener: jest.fn() })) as never;
      window.history.replaceState(null, '', '/studies?tab=analyses&at=a2');
      mockQueryState.tab = 'analyses';
      try {
        const first = [createMockNote({ id: 'a1', title: 'Разбор · Рим 8', type: 'analysis' })];
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: first, checking: false } as never);
        const { rerender } = render(<StudiesPage />);
        act(() => { jest.advanceTimersByTime(3000); });
        expect(scroll).not.toHaveBeenCalled();
        expect(window.location.search).toBe('?tab=analyses&at=a2');
        const notes = [...first, createMockNote({ id: 'a2', title: 'Разбор · Еф 1:3–14', type: 'analysis' })];
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes, checking: false } as never);
        rerender(<StudiesPage />);
        act(() => { jest.advanceTimersByTime(100); });
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
        expect(screen.getByText('Разбор · Еф 1:3–14').closest('article')).toHaveAttribute('data-lit', 'true');
        expect(window.location.search).toBe('?tab=analyses');
      } finally {
        Element.prototype.scrollIntoView = original;
        window.matchMedia = originalMedia;
        jest.useRealTimers();
        window.history.replaceState(null, '', '/');
      }
    });

    it('opened at an analysis that does not come, lets it go after the wait and never jumps to it later', () => {
      jest.useFakeTimers();
      const scroll = jest.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scroll;
      window.history.replaceState(null, '', '/studies?tab=analyses&at=a2');
      mockQueryState.tab = 'analyses';
      try {
        const first = [createMockNote({ id: 'a1', title: 'Разбор · Рим 8', type: 'analysis' })];
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: first });
        const { rerender } = render(<StudiesPage />);
        act(() => { jest.advanceTimersByTime(10_500); });
        expect(window.location.search).toBe('?tab=analyses');
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [...first, createMockNote({ id: 'a2', title: 'Разбор · Еф 1:3–14', type: 'analysis' })] });
        rerender(<StudiesPage />);
        act(() => { jest.advanceTimersByTime(3000); });
        expect(scroll).not.toHaveBeenCalled();
        expect(screen.getByText('Разбор · Еф 1:3–14').closest('article')).not.toHaveAttribute('data-lit');
      } finally {
        Element.prototype.scrollIntoView = original;
        jest.useRealTimers();
        window.history.replaceState(null, '', '/');
      }
    });

    it('closed, the analysis leaves the address too, so a reload does not open it again', async () => {
      // Codex, 02.11: a book that could not be read closed the window and left `analysis=` behind.
      window.history.replaceState(null, '', '/studies?tab=analyses&analysis=a1&mode=view');
      try {
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'a1', title: 'Разбор · Еф 1:3–14', type: 'analysis' })] });
        render(<StudiesPage />);
        await userEvent.click(screen.getByText('close-analysis'));
        expect(window.location.search).not.toContain('analysis=');
        expect(window.location.search).not.toContain('mode=');
      } finally {
        window.history.replaceState(null, '', '/');
      }
    });

    it('in «Разборы» starts a new analysis in the Bible, and says where analyses begin while there are none', async () => {
      mockQueryState.tab = 'analyses';
      mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: '1', type: 'note' })] });
      render(<StudiesPage />);
      expect(screen.getByText('studiesWorkspace.analysesEmptyTitle')).toBeInTheDocument();
      // Studies' own emerald, dark enough for its white words (Codex UX, 04.11).
      expect(screen.getByRole('button', { name: /studiesWorkspace\.newAnalysis/ })).toHaveClass(...STUDIES_ACTION.split(' '));
      await userEvent.click(screen.getByRole('button', { name: /studiesWorkspace\.newAnalysis/ }));
      expect(mockPush).toHaveBeenCalledWith('/bible');
      // Codex UX, 04.11: the Bible opened with no word of what to do there once the list had analyses and no invitation.
      expect(toast).toHaveBeenCalledWith('studiesWorkspace.newAnalysisHint');
    });

    it('keeps the tab the list is on in view where the row is wider than the screen', () => {
      // A phone: five tabs of 110px in a 300px row. Opened on «Разборы», the row showed the first three tabs and none lit.
      const widths = jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'BUTTON' ? 110 : 0; });
      const lefts = jest.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'BUTTON' && this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * 110 : 0;
      });
      const room = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 300);
      try {
        mockQueryState.tab = 'analyses';
        render(<StudiesPage />);
        const tab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.analyses/ });
        expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'true')).toEqual([tab]);
        expect(tab.parentElement!.scrollLeft).toBe(4 * 110 - (300 - 110) / 2);
      } finally {
        widths.mockRestore();
        lefts.mockRestore();
        room.mockRestore();
      }
    });

    it('keeps the open tab in view when the counts arrive after it and widen the tabs', () => {
      let width = 60;
      const widths = jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'BUTTON' ? width : 0; });
      const lefts = jest.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'BUTTON' && this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * width : 0;
      });
      const room = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 300);
      try {
        mockQueryState.tab = 'analyses';
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [], loading: true });
        const { rerender } = render(<StudiesPage />);
        width = 110;
        mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'a1', type: 'analysis' })] });
        rerender(<StudiesPage />);
        const tab = screen.getByRole('button', { name: /studiesWorkspace\.tabs\.analyses/ });
        expect(tab.parentElement!.scrollLeft).toBe(4 * 110 - (300 - 110) / 2);
      } finally {
        widths.mockRestore();
        lefts.mockRestore();
        room.mockRestore();
      }
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

  // BUG-20260927-study-search-drops-by-short-reference: the pre-filter built the reference text by
  // hand (full book name only) and dropped a note before the shared rule could match its short form.
  it('finds a note by its reference written as the card shows it, short or long', async () => {
    const ref = { id: 'ref-luke', book: 'Luke', chapter: 5, fromVerse: 17 };
    mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'luke', title: 'Healing the paralytic', scriptureRefs: [ref] })] });
    render(<StudiesPage />);
    const searchInput = screen.getByPlaceholderText(/studiesWorkspace\.searchPlaceholder/i);

    for (const style of ['short', 'long'] as const) {
      fireEvent.change(searchInput, { target: { value: formatScriptureReference(ref, { locale: 'en', style }) } });
      await waitFor(() => expect(screen.getByRole('heading', { name: /Healing the paralytic/i })).toBeInTheDocument());
    }
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

    it('clears the search query and results when Escape is pressed', async () => {
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
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });

      await waitFor(() => {
        const visibleCards = screen.getAllByRole('article');
        expect(visibleCards).toHaveLength(1);
        expect(visibleCards[0]).toHaveTextContent(/Alpha note/i);
      });

      fireEvent.keyDown(searchInput, { key: 'Escape' });

      await waitFor(() => expect(searchInput).toHaveValue(''));
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it('initializes the search from the URL query param and filters on mount', async () => {
      mockQueryState.search = 'Alpha';

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
      expect(searchInput).toHaveValue('Alpha');

      await waitFor(() => {
        const visibleCards = screen.getAllByRole('article');
        expect(visibleCards).toHaveLength(1);
        expect(visibleCards[0]).toHaveTextContent(/Alpha note/i);
      });
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

  it('opens an available note share window without claiming access is off after the link read fails', () => {
    mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'known-note', title: 'Known note' })] });
    mockUseStudyNoteShareLinks.mockReturnValue({ ...baseUseStudyNoteShareLinksValue(), error: new Error('Store unavailable') });
    render(<StudiesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.shareButton' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('studiesWorkspace.shareLinks.accessOff')).not.toBeInTheDocument();
    expect(dialog.queryByText('studiesWorkspace.shareLinks.inviteText')).not.toBeInTheDocument();
    expect(dialog.getByText('dataSync.backgroundFailure')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'studiesWorkspace.shareLinks.createButton' })).toBeDisabled();
    expect(screen.getAllByText('Known note').length).toBeGreaterThan(0);
  });

  it('keeps a new comment\'s chosen place while another is picked, so a reload then still has it with the words', async () => {
    mockQueryState.tab = 'comments';
    render(<StudiesPage />);
    await userEvent.click(screen.getByRole('button', { name: /studiesWorkspace.newComment/ }));
    expect(screen.getByTestId('comment-place')).toHaveTextContent('none');
    await userEvent.click(screen.getByRole('button', { name: 'pick-psalm-23' }));
    expect(screen.getByTestId('comment-place')).toHaveTextContent('Psalms 23');
    await userEvent.click(screen.getByRole('button', { name: 'comment.changePlace' }));
    // The picker is open again, and the place stays the comment's until another is confirmed.
    expect(screen.getByRole('button', { name: 'pick-psalm-23' })).toBeInTheDocument();
    expect(screen.getByTestId('comment-place')).toHaveTextContent('Psalms 23');
  });

  it('counts the comments tab as comments and offers no «expand all» where nothing folds', () => {
    mockQueryState.tab = 'comments';
    mockUseStudyNotes.mockReturnValue({ ...baseUseStudyNotesValue(), notes: [createMockNote({ id: 'c1', type: 'comment', title: '', content: 'Мысль.' }), createMockNote({ id: 'n1' })] });
    render(<StudiesPage />);
    expect(screen.getByText(/studiesWorkspace.tabs.comments:/)).toBeInTheDocument();
    expect(screen.queryByText('studiesWorkspace.allNotes', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /studiesWorkspace.expandAll/ })).not.toBeInTheDocument();
  });
});
