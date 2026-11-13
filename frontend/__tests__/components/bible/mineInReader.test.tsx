import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { choosableRun, versesNotChoosable } from '@/components/bible/ReaderCommentDialog';
import { resetMinePrefsForTests, saveMinePrefs } from '@/components/bible/minePrefs';
import { arriveOnTrail, readPlaceTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { analysedVerses, badgeLabel, entriesAt, useBookUsage } from '@/components/bible/useBookUsage';
import MineSettings from '@/components/settings/MineSettings';

import { verseWords, type BookText } from '@/utils/bibleText';
import type { BookUsageEntry } from '@/utils/scriptureUsage';

// Render only the real comment heading interpolation; keep the shared test translation behavior for every other key.
jest.mock('@locales/useTranslation', () => {
  const actual = jest.requireActual('@locales/useTranslation');
  const english = require('../../../locales/en/translation.json');
  return {
    ...actual,
    useTranslation: () => {
      const result = actual.useTranslation();
      return {
        ...result,
        t: (key: string, options?: { place?: string }) => (key === 'comment.title' || key === 'comment.titleParagraph'
          ? english.comment[key === 'comment.title' ? 'title' : 'titleParagraph'].replace('{{place}}', options?.place ?? '')
          : result.t(key, options)),
      };
    },
  };
});

/*
 * The person's own material in the Bible reader (case 2026-10-12-block-diagram, 2.2): their notes,
 * sermons, groups and service orders, from the engine's lists, as badges on the verses they name, a
 * badge by a chapter's heading for a whole chapter, and a list behind each badge. The text is the real
 * Synodal Ruth.
 */
type Row = { resource: { id: string }; value: Record<string, unknown> | null; deleting?: boolean };
let mockRows: Record<string, Row[]> = {};
// Whether the engine has read each whole list; a list still being read, or offered as a copy, is not complete.
let mockComplete = true;
let mockCollectionError: Error | null = null;
let mockCollectionReadOnly = false;
const mockWatched: Array<string | null> = [];
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
  useDataCollection: (name: string | null) => (mockWatched.push(name), {
    state: name ? { documents: mockRows[name] ?? [], complete: mockComplete, freshness: 'server' } : null,
    loading: false, error: mockCollectionError, readOnly: mockCollectionReadOnly, refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
// The comment's window reads and writes through the notes' engine door; here it reads the rows above, and what a save
// sends is kept to be looked at (it is never accepted: the window stays as it was sent).
const mockCreateNote = jest.fn((_note: unknown) => ({ acceptance: new Promise(() => undefined) }));
const mockUpdateNote = jest.fn((_change: unknown) => ({ acceptance: new Promise(() => undefined) }));
jest.mock('@/hooks/useStudyNotesEngine', () => ({
  useStudyNotesEngine: () => ({
    uid: 'owner',
    notes: (mockRows.studyNotes ?? []).map((stored) => ({ id: stored.resource.id, tags: [], scriptureRefs: [], createdAt: '', updatedAt: '', isDraft: false, ...stored.value })),
    createNote: mockCreateNote, updateNote: mockUpdateNote, deleteNote: jest.fn(),
    recoverAnalysisCreation: jest.fn().mockResolvedValue(null),
    releaseAnalysisCreation: jest.fn().mockResolvedValue(undefined),
    combineAnalysisCreation: jest.fn().mockResolvedValue('existing-analysis'),
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="comment-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/bible',
  useSearchParams: () => new URLSearchParams(),
}));

const ruthText: BookText = JSON.parse(readFileSync(join(__dirname, '../../../public/bible-text/rst/v1/ruth.json'), 'utf8'));
const romansText: BookText = JSON.parse(readFileSync(join(__dirname, '../../../public/bible-text/rst/v1/romans.json'), 'utf8'));
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });

const row = (id: string, value: Record<string, unknown>, extra: Partial<Row> = {}): Row => ({ resource: { id }, value: { userId: 'owner', updatedAt: '', ...value }, ...extra });
const sermon = (id: string, verse: string, title = id) => row(id, { title, verse, thoughts: [], date: '' });
const note = (id: string, content: string, title = id, refs: unknown[] = []) => row(id, { title, content, scriptureRefs: refs, tags: [] });
const group = (id: string, refs: string[]) => row(id, { title: id, templates: [{ id: 'b', title: 'Чтение', content: '', scriptureRefs: refs }], flow: [] });
const order = (id: string, refs: string[]) => row(id, { title: id, steps: [{ id: 's', title: 'Чтение', body: '', scriptureRefs: refs }], rank: 1 });

beforeEach(() => {
  mockRows = {};
  mockComplete = true;
  mockCollectionError = null;
  mockCollectionReadOnly = false;
  mockPush.mockClear();
  mockCreateNote.mockClear();
  mockUpdateNote.mockClear();
  window.matchMedia = jest.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetMinePrefsForTests();
  resetPlaceTrailForTests();
  global.fetch = jest.fn(async (url: string) => (url.startsWith('/bible-text/') ? answer(ruthText) : answer({ id: 'Ruth', chapters: [] }))) as unknown as typeof fetch;
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

// The list's window is named by its place alone, "Руфь 1:16" (the owner, 2026-10-21: no «Моё к»).
const MINE_WINDOW = /^\S+ \d+(:\d+)?$/;

const renderRuth = () => render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={jest.fn()} />);

const renderRomans = () => {
  global.fetch = jest.fn(async (url: string) => (url.startsWith('/bible-text/') ? answer(romansText) : answer({ id: 'Romans', chapters: [] }))) as unknown as typeof fetch;
  return render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Romans" initialPlace={{ chapter: 14, verse: 24 }} onOpenBook={jest.fn()} />);
};

describe('the person\'s own material on the Bible text', () => {
  it('puts a badge of each kind after the verse its stretch starts at, saying the verses, and one by a chapter\'s heading', async () => {
    mockRows = {
      sermons: [sermon('whither', 'Руфь 1:16-17')],
      studyNotes: [note('loyalty', 'Ключ: Руфь 1:16.'), note('loyalty-2', 'Ещё раз Руфь 1:16'), note('field', '', 'field', [{ bible: 'rst', book: 'Ruth', chapter: 2 }])],
      groups: [group('thursday', ['Руфь 3:9'])],
      serviceOrders: [order('wedding', ['Руфь 1:16'])],
    };
    renderRuth();
    expect(await screen.findByTestId('mine-1:16-sermon')).toHaveTextContent('1:16–17');
    // Two notes on one verse are one badge, the number on its corner; one document has no number.
    expect(screen.getByTestId('mine-1:16-note')).toHaveTextContent('1:16');
    expect(screen.getByTestId('mine-1:16-note-count')).toHaveTextContent('2');
    // The number is only seen on the corner: the badge's name says it.
    expect(screen.getByTestId('mine-1:16-note')).toHaveAccessibleName('bible.mine.badgeLabelMany');
    expect(screen.queryByTestId('mine-1:16-sermon-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('mine-1:16-order')).toHaveTextContent('1:16');
    expect(screen.getByTestId('mine-3:9-group')).toHaveTextContent('3:9');
    // A whole chapter says its first and last verse in this Bible: Ruth 2 has 23.
    expect(screen.getByTestId('mine-chapter-2-note')).toHaveTextContent('2:1–23');
    expect(screen.queryByTestId('mine-1:17-sermon')).not.toBeInTheDocument();
    // The badge's words name the kind, the place and what it is.
    expect(screen.getByTestId('mine-1:16-sermon')).toHaveAccessibleName('bible.mine.badgeLabel');
  });

  it('opens from a badge the list of what holds the verse, and a row goes to it once the window has closed', async () => {
    mockRows = { sermons: [sermon('whither', 'Руфь 1:16-17', 'Куда ты пойдёшь')], studyNotes: [note('book-plan', '', 'План', [{ bible: 'rst', book: 'Ruth', chapter: 1 }])] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-sermon'));
    const dialog = screen.getByRole('dialog', { name: MINE_WINDOW });
    expect(within(dialog).getByTestId('mine-entry-sermon-whither')).toHaveTextContent('Куда ты пойдёшь');
    // What names the whole chapter shows under the verse's own.
    expect(within(dialog).getByText('bible.mine.wholeChapter')).toBeInTheDocument();
    expect(within(dialog).getByTestId('mine-entry-note-book-plan')).toBeInTheDocument();
    // Several rows: the one under the pointer or the finger is lit (the owner, 2026-10-21).
    expect(within(dialog).getByTestId('mine-entry-sermon-whither')).toHaveClass('hover:bg-gray-50', 'active:bg-gray-100');
    expect(screen.queryByTestId('leaving-bar')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('mine-entry-sermon-whither'));
    expect(screen.queryByRole('dialog', { name: MINE_WINDOW })).not.toBeInTheDocument();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sermons/whither'));
    // Something happens at once, before the next screen has come: the line along the top.
    expect(screen.getByTestId('leaving-bar')).toBeInTheDocument();
  });

  it('opens a chapter\'s list from the badge by its heading', async () => {
    mockRows = { studyNotes: [note('field', '', 'В поле Вооза', [{ bible: 'rst', book: 'Ruth', chapter: 2 }])] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-chapter-2-note'));
    const dialog = screen.getByRole('dialog', { name: MINE_WINDOW });
    expect(within(dialog).getByTestId('mine-entry-note-field')).toHaveTextContent('В поле Вооза');
  });

  it('folds more than three badges on one verse into "+N", which opens the same list', async () => {
    mockRows = {
      sermons: [sermon('s', 'Руфь 1:16')], studyNotes: [note('n', 'Руфь 1:16')], groups: [group('g', ['Руфь 1:16'])], serviceOrders: [order('o', ['Руфь 1:16'])],
    };
    renderRuth();
    expect(await screen.findByTestId('mine-1:16-sermon')).toBeInTheDocument();
    expect(screen.getByTestId('mine-1:16-note')).toBeInTheDocument();
    expect(screen.queryByTestId('mine-1:16-group')).not.toBeInTheDocument();
    expect(screen.getByTestId('mine-1:16-more')).toHaveTextContent('+2');
    await userEvent.click(screen.getByTestId('mine-1:16-more'));
    expect(within(screen.getByRole('dialog', { name: MINE_WINDOW })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows only the person\'s own documents, and not one they are deleting', async () => {
    mockRows = { sermons: [sermon('mine', 'Руфь 1:16'), row('theirs', { title: 'x', verse: 'Руфь 2:1', userId: 'other' }), { ...sermon('gone', 'Руфь 3:1'), deleting: true }] };
    renderRuth();
    expect(await screen.findByTestId('mine-1:16-sermon')).toBeInTheDocument();
    expect(screen.queryByTestId('mine-2:1-sermon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mine-3:1-sermon')).not.toBeInTheDocument();
  });

  it('shows nothing of the person\'s while Settings → Bible says so, and everything again once switched back', async () => {
    mockRows = { sermons: [sermon('whither', 'Руфь 1:16-17')] };
    renderRuth();
    expect(await screen.findByTestId('mine-1:16-sermon')).toBeInTheDocument();
    act(() => saveMinePrefs({ show: false }));
    expect(screen.queryByTestId('mine-1:16-sermon')).not.toBeInTheDocument();
    act(() => saveMinePrefs({ show: true }));
    expect(screen.getByTestId('mine-1:16-sermon')).toBeInTheDocument();
  });

  it('counts a document once at a chapter its two ranges share, and lists it once', async () => {
    mockRows = { studyNotes: [note('ranges', '', 'Два диапазона', [{ bible: 'rst', book: 'Ruth', chapter: 1, toChapter: 2 }, { bible: 'rst', book: 'Ruth', chapter: 2, toChapter: 3 }])] };
    renderRuth();
    const chapterBadge = await screen.findByTestId('mine-chapter-2-note');
    expect(chapterBadge).toHaveTextContent('2:1–23');
    expect(screen.queryByTestId('mine-chapter-2-note-count')).not.toBeInTheDocument();
    await userEvent.click(chapterBadge);
    expect(within(screen.getByRole('dialog', { name: MINE_WINDOW })).getAllByTestId('mine-entry-note-ranges')).toHaveLength(1);
  });

  it('closes the list when the setting goes off, and does not bring it back when it comes on again', async () => {
    mockRows = { sermons: [sermon('whither', 'Руфь 1:16-17')] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-sermon'));
    expect(screen.getByRole('dialog', { name: MINE_WINDOW })).toBeInTheDocument();
    act(() => saveMinePrefs({ show: false }));
    expect(screen.queryByRole('dialog', { name: MINE_WINDOW })).not.toBeInTheDocument();
    act(() => saveMinePrefs({ show: true }));
    expect(await screen.findByTestId('mine-1:16-sermon')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: MINE_WINDOW })).not.toBeInTheDocument();
  });

  it('gives the minimap a mark for each place — a passage\'s first verse, a whole chapter — its kinds in the order of the badges', async () => {
    mockRows = {
      serviceOrders: [order('o', ['Руфь 1:16'])], sermons: [sermon('s', 'Руфь 1:1'), sermon('s2', 'Руфь 1:16-17')],
      studyNotes: [note('n', '', 'n', [{ bible: 'rst', book: 'Ruth', chapter: 2 }])],
    };
    const { result } = renderHook(() => useBookUsage('Ruth', 'rst', 'ru', true));
    await waitFor(() => expect(result.current.mapMarks).toEqual([
      { chapter: 1, verse: 1, kinds: ['sermon'] },
      { chapter: 1, verse: 16, kinds: ['sermon', 'order'] },
      { chapter: 2, verse: null, kinds: ['note'] },
    ]));
  });

  it('marks each chapter of a range of whole chapters, as each has its heading badge', async () => {
    mockRows = { studyNotes: [note('book-part', '', 'Руфь 1–3', [{ bible: 'rst', book: 'Ruth', chapter: 1, toChapter: 3 }])] };
    const { result } = renderHook(() => useBookUsage('Ruth', 'rst', 'ru', true));
    await waitFor(() => expect(result.current.mapMarks).toEqual([1, 2, 3].map((chapter) => ({ chapter, verse: null, kinds: ['note'] }))));
  });

  it('does not even watch the lists while switched off', () => {
    saveMinePrefs({ show: false });
    mockWatched.length = 0;
    renderHook(() => useBookUsage('Ruth', 'rst', 'ru', true));
    expect(mockWatched.length).toBeGreaterThan(0);
    expect(mockWatched.every((name) => name === null)).toBe(true);
  });

  it('lists a document once, on the verse, when it also names the verse\'s whole chapter', () => {
    const entry = (key: string, passage: BookUsageEntry['passage']): BookUsageEntry => ({ key, kind: 'note', id: 'psalm', title: 'Пс 9–10', href: '/studies/psalm', updatedAt: '', passage, excerpt: '' });
    // Synodal Ps 9:20-25 is King James 9:19-10:4; the same note names King James Psalm 10 whole.
    const both = [entry('a', { chapter: 9, toChapter: 10, fromVerse: 19, toVerse: 4 }), entry('b', { chapter: 10, toChapter: 10 })];
    expect(entriesAt(both, { chapter: 10, verse: 1 })).toEqual({ onVerse: [both[0]], wholeChapter: [] });
    expect(entriesAt(both, { chapter: 10, verse: null })).toEqual({ onVerse: [], wholeChapter: [both[1]] });
  });

  it('reads the library only once the text shows', async () => {
    mockRows = { sermons: [sermon('s', 'Руфь 1:1')] };
    const { result, rerender } = renderHook(({ ready }) => useBookUsage('Ruth', 'rst', 'ru', ready), { initialProps: { ready: false } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(result.current.ribbon).toBeUndefined();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.ribbon?.at.get('1:1')).toHaveLength(1));
  });
});

describe('comments on the text (case 2026-10-12-block-diagram, 3.2)', () => {
  const comment = (id: string, content: string, refs: unknown[]) => row(id, { type: 'comment', content, scriptureRefs: refs, tags: [] });
  const rows = () => ({ studyNotes: [
    comment('verse', 'Куда ты пойдёшь — туда и я.', [{ id: 'r', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }]),
    comment('chapters', 'Главы о верности.', [{ id: 'r2', bible: 'rst', book: 'Ruth', chapter: 1, toChapter: 2 }]),
  ] });

  it('stands as grey words under its verse and under every chapter heading it is written to, a badge when chosen', async () => {
    mockRows = rows();
    renderRuth();
    expect(await screen.findByTestId('comments-1:16')).toHaveTextContent('Куда ты пойдёшь — туда и я.');
    expect(screen.getByTestId('comments-chapter-1')).toHaveTextContent('Главы о верности.');
    expect(screen.getByTestId('comments-chapter-2')).toHaveTextContent('Главы о верности.');
    expect(screen.queryByTestId('mine-1:16-comment')).not.toBeInTheDocument();
    act(() => saveMinePrefs({ comments: 'badge' }));
    expect(await screen.findByTestId('mine-1:16-comment')).toBeInTheDocument();
    expect(screen.queryByTestId('comments-1:16')).not.toBeInTheDocument();
    expect(screen.getByTestId('mine-chapter-2-comment')).toBeInTheDocument();
  });

  it('opens the comment in its window from its words, and from a chapter heading — the chapter\'s own, or a new one', async () => {
    mockRows = rows();
    renderRuth();
    await userEvent.click(await screen.findByText('Куда ты пойдёшь — туда и я.'));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Куда ты пойдёшь — туда и я.');
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('comment-editor')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('chapter-comment-2'));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Главы о верности.');
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('comment-editor')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('chapter-comment-3'));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('');
  });

  it('offers no door to a comment until the whole list is read — a missing one would be taken for none — while a written one opens from its words', async () => {
    mockRows = rows();
    mockComplete = false;
    renderRuth();
    await userEvent.click(await screen.findByText('Куда ты пойдёшь — туда и я.'));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Куда ты пойдёшь — туда и я.');
    expect(screen.queryByTestId('chapter-comment-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chapter-comment-2')).not.toBeInTheDocument();
  });
});

describe('a reader comment opened at a translated run', () => {
  const commentRow = () => row('romans-comment', {
    type: 'comment', content: 'QA223 retained comment words.', tags: [],
    scriptureRefs: [{ id: 'qa223-ref', bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 }],
  });
  const openAndCheck = async (chapter: number, verse: number) => {
    mockRows = { studyNotes: [commentRow()] };
    renderRomans();
    const testId = chapter === 14 ? `paragraph-${chapter}:${verse}-romans-comment` : `comments-${chapter}:${verse}`;
    const edit = await screen.findByTestId(`${testId}-edit-romans-comment`);
    const rowElement = document.querySelector(`[data-verse="${chapter}:${verse}"] [data-verse-text]`);
    expect(rowElement).not.toBeNull();
    const expectedContext = verseWords(romansText.chapters[chapter - 1][verse - 1]);
    expect(rowElement).toHaveTextContent(expectedContext);
    await userEvent.click(edit);
    // The run 14:24–26 is drawn as a paragraph: its window says so (case 2026-11-06-comment-paragraph).
    const expectedTitle = chapter === 14 ? 'Paragraph · Rom 14:24–26' : 'Comment · Rom 16:24';
    const dialog = await screen.findByRole('dialog', { name: /^(Comment|Paragraph) · Rom / });
    expect(within(dialog).getByLabelText('comment-editor')).toHaveValue('QA223 retained comment words.');
    expect(dialog).toHaveTextContent(expectedContext);
    expect(within(dialog).getByRole('heading', { name: chapter === 14 ? /^Paragraph · Rom 14:24–26/ : expectedTitle })).toBeInTheDocument();
  };

  it('opens the comment from the later RST run at Romans 16:24', async () => {
    // Before the fix, the real title and context resolve from the first projected occurrence (14:24–26).
    await openAndCheck(16, 24);
  });

  it('keeps the first RST run at Romans 14:24 as a positive control', async () => {
    await openAndCheck(14, 24);
  });

  it('opens the badge-list row for the later RST run at Romans 16:24', async () => {
    mockRows = { studyNotes: [commentRow()] };
    act(() => saveMinePrefs({ comments: 'badge' }));
    renderRomans();
    await userEvent.click(await screen.findByTestId('mine-16:24-comment'));
    const rowElement = await screen.findByTestId('mine-entry-comment-romans-comment');
    expect(rowElement).toHaveTextContent('16:24');
    await userEvent.click(rowElement);
    const dialog = await screen.findByRole('dialog', { name: /^Comment · Rom / });
    expect(within(dialog).getByLabelText('comment-editor')).toHaveValue('QA223 retained comment words.');
    expect(within(dialog).getByText(verseWords(romansText.chapters[15][23]))).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Comment · Rom 16:24' })).toBeInTheDocument();
  });
});

describe('cached paragraphs in a comment destination', () => {
  const targetComment = (id: string, extra: Partial<Row> = {}) => row(id, {
    type: 'comment', content: `Words of ${id}`, tags: [],
    scriptureRefs: [{ id: `ref-${id}`, bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 }],
  }, extra);

  it('projects owned live destination comments in the reader Bible without subscribing again', () => {
    mockRows = { studyNotes: [targetComment('kept'), targetComment('deleting', { deleting: true }),
      { ...targetComment('foreign'), value: { ...targetComment('foreign').value, userId: 'someone-else' } }] };
    const { result } = renderHook(() => useBookUsage('Ruth', 'rst', 'en', true));
    const watchedBefore = mockWatched.length;
    const target = result.current.paragraphsForBook('Romans');
    expect(target?.laid).toHaveLength(1);
    expect(target?.laid[0]).toMatchObject({ owner: 'kept', first: '14:24', last: '14:26' });
    expect(target?.bodyOf(target.laid[0].id)).toBe('Words of kept');
    expect(target?.bodyOf('kept')).toBe('Words of kept');
    expect(mockWatched).toHaveLength(watchedBefore);
    expect(result.current.commentLaid).toEqual([]);
  });

  it('uses the same layout and words when the destination is the open book', () => {
    mockRows = { studyNotes: [targetComment('kept')] };
    const { result } = renderHook(() => useBookUsage('Romans', 'rst', 'en', true));
    const target = result.current.paragraphsForBook('Romans');
    expect(target?.laid).toBe(result.current.commentLaid);
    expect(target?.bodyOf).toBe(result.current.commentBody);
    expect(target?.laid[0]).toMatchObject({ owner: 'kept', first: '14:24', last: '14:26' });
  });

  it.each(['incomplete', 'read-error', 'read-only'] as const)('does not prove an empty destination when notes are %s', reason => {
    mockComplete = reason !== 'incomplete';
    mockCollectionError = reason === 'read-error' ? new Error('read refused') : null;
    mockCollectionReadOnly = reason === 'read-only';
    const { result } = renderHook(() => useBookUsage('Ruth', 'rst', 'en', true));
    expect(result.current.paragraphsForBook('Romans')).toBeNull();
    expect(result.current.paragraphsForBook('Ruth')).toBeNull();
  });
});

describe('paragraphs of comments (case 2026-10-12-block-diagram, phase 9)', () => {
  const comment = (id: string, content: string, ref: Record<string, unknown>) => row(id, { type: 'comment', content, scriptureRefs: [{ id: `r-${id}`, bible: 'rst', book: 'Ruth', ...ref }], tags: [] });
  const verseText = (key: string) => document.querySelector(`[data-verse="${key}"] [data-verse-text]`) as HTMLElement;
  const rowOf = (key: string) => document.querySelector(`[data-verse="${key}"]`) as HTMLElement;

  it('draws a comment on a run of verses as a paragraph — its words above the first verse — and one on a verse under it, against the right edge', async () => {
    mockRows = { studyNotes: [
      comment('outer', 'Руфь остаётся с Ноеминью', { chapter: 1, fromVerse: 16, toVerse: 22 }),
      comment('inner', 'Обещание Руфи', { chapter: 1, fromVerse: 16, toVerse: 18 }),
      comment('across', 'Жатва кончается', { chapter: 2, fromVerse: 22, toVerseChapter: 3, toVerse: 1 }),
      comment('crossing', 'Через край абзаца', { chapter: 1, fromVerse: 20, toVerseChapter: 2, toVerse: 3 }),
      comment('one', 'Сыновья умерли', { chapter: 1, fromVerse: 5 }),
    ] };
    renderRuth();
    const outer = await screen.findByText('Руфь остаётся с Ноеминью');
    const outerHead = outer.closest('[data-paragraph-head]') as HTMLElement;
    // Outer heading first, the inner one under it, then the verse; the inner heading set in a step.
    expect(outerHead.dataset.comment).toBe('outer');
    expect((outerHead.nextElementSibling as HTMLElement).dataset.comment).toBe('inner');
    expect(outerHead.nextElementSibling!.nextElementSibling).toBe(rowOf('1:16'));
    expect(outerHead.nextElementSibling).toHaveClass('md:pl-16');
    expect(screen.queryByTestId('comments-1:16')).not.toBeInTheDocument();
    // Room after the last verses: an inner paragraph's smaller.
    expect(rowOf('1:18').style.marginBottom).toBe('10px');
    expect(rowOf('1:22').style.marginBottom).toBe('18px');
    // Across «Глава 3»: a heading above 2:22, room after 3:1.
    expect((screen.getByText('Жатва кончается').closest('[data-paragraph-head]') as HTMLElement).nextElementSibling).toBe(rowOf('2:22'));
    expect(rowOf('3:1').style.marginBottom).toBe('18px');
    // A comment that would cross a paragraph is not lost: it stands under its last verse, with its place
    // (the owner, 2026-11-06: «комментарий на несколько стихов под последним стихом»).
    expect(screen.getByTestId('comments-2:3')).toHaveTextContent('Через край абзаца');
    expect(screen.getByTestId('comments-2:3')).toHaveTextContent('1:20–2:3');
    // A comment on one verse stands against the right edge.
    expect(within(screen.getByTestId('comments-1:5')).getByText('Сыновья умерли').closest('.justify-end')).not.toBeNull();
    // The line beside them is drawn over the text (Codex review r3: these tests stayed green with it gone).
    expect(screen.getByTestId('paragraph-lines').querySelectorAll('[data-piece="ring"]').length).toBeGreaterThan(0);
  });

  // The owner, 2026-11-06: «сначала выбирать стихи, а потом что с ними делать» — one choice of verses, no grips, and the
  // bar's «Комментарий» or «Абзац» writes what the person chose on verses in a row.
  it('chooses the verses first — a press adds one, Shift takes a run — and the bar\'s «Абзац» writes a paragraph on them', async () => {
    mockRows = { studyNotes: [] };
    renderRuth();
    await waitFor(() => expect(verseText('1:16')).toBeTruthy());
    fireEvent.contextMenu(verseText('1:16'), { clientX: 200, clientY: 300 });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'bible.copy.several' }));
    expect(await screen.findByRole('region', { name: 'Руф 1:16' })).toBeInTheDocument();
    expect(screen.queryByTestId('passage-grips')).not.toBeInTheDocument();
    // Not in a row: a copy may take them, a comment, a paragraph and an analysis wait.
    fireEvent.click(verseText('1:20'), { detail: 1 });
    const apart = screen.getByRole('region', { name: 'Руф 1:16, 20' });
    expect(within(apart).queryByRole('button', { name: 'bible.copy.writeParagraph' })).not.toBeInTheDocument();
    expect(within(apart).getByText('bible.copy.onlyInRow')).toBeInTheDocument();
    fireEvent.click(verseText('1:20'), { detail: 1 });
    fireEvent.click(verseText('1:20'), { detail: 1, shiftKey: true });
    const bar = screen.getByRole('region', { name: 'Руф 1:16–20' });
    await userEvent.click(within(bar).getByRole('button', { name: 'bible.copy.writeParagraph' }));
    expect(screen.getByRole('button', { name: 'comment.kind.paragraph' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(await screen.findByLabelText('comment-editor'), 'Верность');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockCreateNote).toHaveBeenCalledWith(expect.objectContaining({
      type: 'comment', paragraph: true, scriptureRefs: [expect.objectContaining({ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16, toVerse: 20 })],
    }));
  });

  // The owner, 2026-11-12: «три разных действия и, соответственно, три разных механики» — the verse's menu offers a comment,
  // a paragraph and an analysis apart, and «Комментарий» opens its window at once: no bar of chosen verses on the way.
  it('offers a comment, a paragraph and an analysis apart, and «Комментарий» opens its window at once on the verse', async () => {
    mockRows = { studyNotes: [] };
    renderRuth();
    await waitFor(() => expect(verseText('1:16')).toBeTruthy());
    fireEvent.contextMenu(verseText('1:16'), { clientX: 200, clientY: 300 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['comment.verseMenu', 'comment.verseMenuParagraph', 'analysis.verseMenu']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'comment.verseMenu' }));
    expect(await screen.findByRole('button', { name: 'comment.kind.comment' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Руф 1:16' })).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText('comment-editor'), 'Куда ты пойдёшь');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockCreateNote).toHaveBeenCalledWith(expect.objectContaining({
      type: 'comment', paragraph: false, scriptureRefs: [expect.objectContaining({ chapter: 1, fromVerse: 16 })],
    }));
    const [written] = (mockCreateNote.mock.calls.at(-1)?.[0] as { scriptureRefs: Array<Record<string, unknown>> }).scriptureRefs;
    expect(written.toVerse).toBeUndefined();
  });

  // A paragraph runs along verses: they are chosen from the verse first, under the paragraphs' rule, and the bar writes it.
  it('«Абзац» chooses the paragraph\'s verses from the verse first, and its bar writes a paragraph on them', async () => {
    mockRows = { studyNotes: [] };
    renderRuth();
    await waitFor(() => expect(verseText('1:16')).toBeTruthy());
    fireEvent.contextMenu(verseText('1:16'), { clientX: 200, clientY: 300 });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'comment.verseMenuParagraph' }));
    expect(screen.queryByLabelText('comment-editor')).not.toBeInTheDocument();
    fireEvent.click(verseText('1:20'), { detail: 1 });
    const bar = await screen.findByRole('region', { name: 'Руф 1:16–20' });
    // The bar is the paragraph's: no copy, no other writing on the way.
    expect(within(bar).queryByRole('button', { name: 'bible.copy.copy' })).not.toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'comment.pick.writeParagraph' }));
    expect(await screen.findByRole('button', { name: 'comment.kind.paragraph' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(await screen.findByLabelText('comment-editor'), 'Верность');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockCreateNote).toHaveBeenCalledWith(expect.objectContaining({
      type: 'comment', paragraph: true, scriptureRefs: [expect.objectContaining({ chapter: 1, fromVerse: 16, toVerse: 20 })],
    }));
  });

  // Each kind has its own door: a verse where a comment and a paragraph both start says so twice, and each opens its own.
  it('says «Изменить комментарий» and «Изменить абзац» at a verse where both start, each opening its own', async () => {
    mockRows = { studyNotes: [
      comment('par', 'Верность Руфи', { chapter: 1, fromVerse: 16, toVerse: 18 }),
      comment('one', 'Куда ты пойдёшь', { chapter: 1, fromVerse: 16 }),
    ] };
    renderRuth();
    await screen.findByText('Верность Руфи');
    fireEvent.contextMenu(verseText('1:16'), { clientX: 200, clientY: 300 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'comment.verseMenuEdit' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'comment.verseMenuEditParagraph' }));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Верность Руфи');
  });

  // Codex review, 2026-11-12: a paragraph that breaks the paragraphs' rule is drawn as a comment, yet its window opens it as
  // a paragraph — the menu names it as its window does, not as it is drawn.
  it('names a paragraph drawn as a comment as its window opens it: «Изменить абзац»', async () => {
    mockRows = { studyNotes: [
      comment('first', 'Путь Ноемини', { chapter: 1, fromVerse: 10, toVerse: 17 }),
      comment('crossing', 'Слово Руфи', { chapter: 1, fromVerse: 16, toVerse: 20 }),
    ] };
    renderRuth();
    await screen.findByText('Слово Руфи');
    fireEvent.contextMenu(verseText('1:16'), { clientX: 200, clientY: 300 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'comment.verseMenuEdit' })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'comment.verseMenuEditParagraph' }));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Слово Руфи');
    expect(screen.getByRole('button', { name: 'comment.kind.paragraph' })).toHaveAttribute('aria-pressed', 'true');
  });

  // BUG-20261107-jump-hides-paragraph-heading, measured on the stand: a jump put the verse on the reading line and the headings
  // of the paragraphs it starts above it, under the header (a phone) or the reader's panel (an iPad). The jump lands at the
  // topmost heading; the place read is the verse; a verse inside a paragraph is jumped to itself.
  it.each([
    [16, 'outer'],
    [17, null],
  ] as const)('a jump to 1:%s lands at the heading of the paragraphs it starts, and keeps the verse as the place', async (verse, heading) => {
    mockRows = { studyNotes: [
      comment('outer', 'Руфь остаётся с Ноеминью', { chapter: 1, fromVerse: 16, toVerse: 22 }),
      comment('inner', 'Обещание Руфи', { chapter: 1, fromVerse: 16, toVerse: 18 }),
    ] };
    // The headings come with the person's list, after the text: the text grows, and the reader's watch over it jumps again.
    const grown: Array<() => void> = [];
    const RealObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { grown.push(() => callback([], this as unknown as ResizeObserver)); }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse }} onOpenBook={jest.fn()} />);
      await screen.findByText('Руфь остаётся с Ноеминью');
      act(() => grown.forEach((grow) => grow()));
      const landed = (Element.prototype.scrollIntoView as jest.Mock).mock.contexts;
      const target = heading ? document.querySelector(`[data-paragraph-head][data-comment="${heading}"]`) : rowOf(`1:${verse}`);
      await waitFor(() => expect(landed.at(-1)).toBe(target));
      await waitFor(() => expect(JSON.parse(window.localStorage.getItem('bible:last-place') ?? 'null')).toEqual(expect.objectContaining({ chapter: 1, verse })));
    } finally {
      globalThis.ResizeObserver = RealObserver;
    }
  });

  // The owner, 2026-11-06: «и абзац для одного стиха, и комментарий для одного стиха… комментарий и для нескольких стихов».
  it('draws a paragraph on one verse as a heading, and a comment on a run of verses under its last verse with its place', async () => {
    mockRows = { studyNotes: [
      row('one', { type: 'comment', content: 'Решение Руфи', paragraph: true, scriptureRefs: [{ id: 'r-one', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }], tags: [] }),
      row('run', { type: 'comment', content: 'Путь в Вифлеем', paragraph: false, scriptureRefs: [{ id: 'r-run', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 19, toVerse: 21 }], tags: [] }),
    ] };
    renderRuth();
    const heading = (await screen.findByText('Решение Руфи')).closest('[data-paragraph-head]') as HTMLElement;
    expect(heading.nextElementSibling).toBe(rowOf('1:16'));
    expect(screen.queryByTestId('comments-1:19')).not.toBeInTheDocument();
    expect(screen.getByTestId('comments-1:21')).toHaveTextContent('Путь в Вифлеем');
    expect(screen.getByTestId('comments-1:21')).toHaveTextContent('1:19–21');
    expect(document.querySelector('[data-paragraph-head][data-comment="run"]')).toBeNull();
  });

  it('makes a written paragraph a comment from its window, writing only the kind', async () => {
    mockRows = { studyNotes: [comment('run', 'Обещание Руфи', { chapter: 1, fromVerse: 16, toVerse: 18 })] };
    renderRuth();
    await userEvent.click(await screen.findByText('Обещание Руфи'));
    // Never chosen, a comment on a run reads as a paragraph, as before.
    expect(await screen.findByRole('button', { name: 'comment.kind.paragraph' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'comment.kind.comment' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockUpdateNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'run', updates: { paragraph: false } }));
  });

  it('changes a written comment\'s verses from its window: the window steps aside while they are chosen, and comes back to move it on «Готово»', async () => {
    mockRows = { studyNotes: [comment('one', 'Куда ты пойдёшь', { chapter: 1, fromVerse: 16 })] };
    renderRuth();
    await userEvent.click(await screen.findByText('Куда ты пойдёшь'));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Куда ты пойдёшь');
    // Escape while the verses are chosen lets the choice go, not the window: it comes back with its words.
    await userEvent.click(screen.getByTestId('comment-choose-verses'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Руф 1:16' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('comment-editor')).toHaveValue('Куда ты пойдёшь');
    await userEvent.click(screen.getByTestId('comment-choose-verses'));
    // Stepped aside: no window over the text, the bar instead — and the text answers presses.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Руф 1:16' })).toBeInTheDocument();
    fireEvent.click(verseText('1:18'), { detail: 1 });
    await userEvent.click(within(screen.getByRole('region', { name: 'Руф 1:16–18' })).getByRole('button', { name: 'common.done' }));
    // Back, saying it will move, with the words as they were.
    expect(await screen.findByTestId('comment-moved')).toBeInTheDocument();
    expect(screen.getByLabelText('comment-editor')).toHaveValue('Куда ты пойдёшь');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.done' }));
    expect(mockUpdateNote).toHaveBeenCalledWith(expect.objectContaining({
      id: 'one', updates: expect.objectContaining({ scriptureRefs: [expect.objectContaining({ id: 'r-one', chapter: 1, fromVerse: 16, toVerse: 18 })] }),
    }));
  });

  // An analysis written before `toVerseChapter` kept its run past the chapter in `toChapter` (`analysisRun`).
  // Codex review r1, the owner 01.11: a heading pressed while the verses are chosen opened that comment, closing the first
  // with its words unasked. One window at a time: the one stepped aside stays, and its choice with it.
  it('keeps the window whose verses are chosen when another comment is pressed meanwhile', async () => {
    mockRows = { studyNotes: [
      comment('one', 'Куда ты пойдёшь', { chapter: 1, fromVerse: 16 }),
      comment('other', 'Конец пути в Моав', { chapter: 1, fromVerse: 20, toVerse: 22 }),
    ] };
    renderRuth();
    await userEvent.click(await screen.findByText('Куда ты пойдёшь'));
    await userEvent.click(await screen.findByTestId('comment-choose-verses'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByText('Конец пути в Моав'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Руф 1:16' });
    await userEvent.click(within(bar).getByRole('button', { name: 'common.done' }));
    expect(await screen.findByLabelText('comment-editor')).toHaveValue('Куда ты пойдёшь');
  });

  // Codex review r1: the list of places moved a paragraph across another, and «Готово» saved it.
  it('does not save a paragraph moved across another from the list of places', async () => {
    mockRows = { studyNotes: [
      comment('first', 'Обещание Руфи', { chapter: 1, fromVerse: 16, toVerse: 18 }),
      comment('second', 'Возвращение', { chapter: 1, fromVerse: 20, toVerse: 21 }),
    ] };
    renderRuth();
    await userEvent.click(await screen.findByText('Возвращение'));
    await userEvent.click(await screen.findByRole('button', { name: 'comment.move' }));
    const list = await screen.findByTestId('comment-place-list');
    const at15 = within(list).getAllByRole('button').find((button) => button.textContent?.startsWith('1:15'))!;
    await userEvent.click(at15);
    expect(await screen.findByTestId('comment-moved')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.done' }));
    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Codex review r2: the rule on save took one verse inside two paragraphs for a third level.
  it('saves a comment on one verse inside a paragraph inside a paragraph', async () => {
    mockRows = { studyNotes: [
      comment('outer', 'Руфь остаётся', { chapter: 1, fromVerse: 16, toVerse: 22 }),
      comment('inner', 'Обещание Руфи', { chapter: 1, fromVerse: 16, toVerse: 18 }),
    ] };
    renderRuth();
    await screen.findByText('Обещание Руфи');
    fireEvent.contextMenu(verseText('1:17'), { clientX: 200, clientY: 300 });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'comment.verseMenu' }));
    await userEvent.type(await screen.findByLabelText('comment-editor'), 'Слово клятвы');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockCreateNote).toHaveBeenCalledWith(expect.objectContaining({ paragraph: false, scriptureRefs: [expect.objectContaining({ chapter: 1, fromVerse: 17 })] }));
  });

  // Codex review r2: the list moved the comment as it was written, not with the verses just chosen.
  it('moves a comment from the list with the verses just chosen in its window', async () => {
    mockRows = { studyNotes: [comment('one', 'Куда ты пойдёшь', { chapter: 1, fromVerse: 16 })] };
    renderRuth();
    await userEvent.click(await screen.findByText('Куда ты пойдёшь'));
    await userEvent.click(await screen.findByTestId('comment-choose-verses'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(verseText('1:18'), { detail: 1 });
    await userEvent.click(within(screen.getByRole('region', { name: 'Руф 1:16–18' })).getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'comment.move' }));
    const list = await screen.findByTestId('comment-place-list');
    await userEvent.click(within(list).getAllByRole('button').find((button) => button.textContent?.startsWith('1:19'))!);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.done' }));
    expect(mockUpdateNote).toHaveBeenCalledWith(expect.objectContaining({
      updates: expect.objectContaining({ scriptureRefs: [expect.objectContaining({ chapter: 1, fromVerse: 19, toVerse: 21 })] }),
    }));
  });

  it('gives an analysis over a chapter\'s seam its bar to its last verse (BUG-20261031-verse-run-across-chapter-cut)', async () => {
    mockRows = { studyNotes: [row('across', { title: 'Разбор', content: '', tags: [], type: 'analysis', scriptureRefs: [{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 21, toChapter: 2, toVerse: 2 }] })] };
    renderRuth();
    expect(await screen.findByTestId('analysed-1:21')).toBeInTheDocument();
    expect(screen.getByTestId('analysed-1:22')).toBeInTheDocument();
    expect(screen.getByTestId('analysed-2:1')).toBeInTheDocument();
    expect(screen.getByTestId('analysed-2:2')).toBeInTheDocument();
    expect(screen.queryByTestId('analysed-2:3')).not.toBeInTheDocument();
  });

  // The owner, 06.11: on a phone the bar is gone; the passage's badge still names where the analysis runs.
  it('keeps an analysed passage\'s bar off a phone\'s narrow column', async () => {
    mockRows = { studyNotes: [row('narrow', { title: 'Разбор', content: '', tags: [], type: 'analysis', scriptureRefs: [{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16, toVerse: 17 }] })] };
    renderRuth();
    expect(await screen.findByTestId('analysed-1:16')).toHaveClass('max-md:hidden');
    expect(screen.getByTestId('analysed-1:17')).toHaveClass('max-md:hidden');
  });

  // Codex review r3: another book or Bible is a new reader on the page, and a window stepped aside went with the old one,
  // unasked. The translation's door takes the same hold (`useCommentHoldsReader`); this reader shows the book's doors.
  it('brings a stepped-aside window back instead of leaving for another book', async () => {
    mockRows = { studyNotes: [row('one', { type: 'comment', content: 'Original', scriptureRefs: [{ id: 'r-one', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }] })] };
    const onOpenBook = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={onOpenBook} />);
    await userEvent.click(await screen.findByText('Original'));
    fireEvent.change(await screen.findByLabelText('comment-editor'), { target: { value: 'Unsaved words' } });
    await userEvent.click(screen.getByTestId('comment-choose-verses'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'bible.nextBook' }));
    expect(onOpenBook).not.toHaveBeenCalled();
    expect(screen.getByLabelText('comment-editor')).toHaveValue('Unsaved words');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  describe('a window stepped aside holds the reader — every door out brings it back instead (Codex review r3)', () => {
    /** A computer: the book's line shows the translation and the way back, which a phone keeps in its header. */
    const onComputer = () => {
      window.matchMedia = jest.fn((query: string) => ({
        matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= 1440, media: query, onchange: null,
        addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
      })) as unknown as typeof window.matchMedia;
    };
    const stepAside = async () => {
      await userEvent.click(await screen.findByText('Original'));
      fireEvent.change(await screen.findByLabelText('comment-editor'), { target: { value: 'Unsaved words' } });
      await userEvent.click(screen.getByTestId('comment-choose-verses'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    };
    const original = () => row('one', { type: 'comment', content: 'Original', scriptureRefs: [{ id: 'r-one', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }] });

    it('to another translation', async () => {
      onComputer();
      mockRows = { studyNotes: [original()] };
      const onChangeBible = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={onChangeBible} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={jest.fn()} />);
      await stepAside();
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'bible.chooseTranslation' })).getByText('bible.translations.kjv.name'));
      expect(onChangeBible).not.toHaveBeenCalled();
      expect(screen.getByLabelText('comment-editor')).toHaveValue('Unsaved words');
    });

    it('back along the trail to another book, the trail\'s light unmoved', async () => {
      onComputer();
      arriveOnTrail({ book: 'Genesis', chapter: 1, verse: 1, bible: 'rst' });
      mockRows = { studyNotes: [original()] };
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} onOpenBook={onOpenBook} />);
      await stepAside();
      const at = readPlaceTrail().at;
      await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
      expect(onOpenBook).not.toHaveBeenCalled();
      expect(readPlaceTrail().at).toBe(at);
      expect(screen.getByLabelText('comment-editor')).toHaveValue('Unsaved words');
    });

    it('to a note from the list of a chapter\'s material', async () => {
      mockRows = { studyNotes: [original(), note('field', '', 'В поле Вооза', [{ bible: 'rst', book: 'Ruth', chapter: 2 }])] };
      renderRuth();
      await stepAside();
      await userEvent.click(await screen.findByTestId('mine-chapter-2-note'));
      await userEvent.click(within(screen.getByRole('dialog', { name: MINE_WINDOW })).getByTestId('mine-entry-note-field'));
      // The row leaves once its list has closed: wait for that, and a moment more, before saying it did not leave.
      await waitFor(() => expect(screen.queryByRole('dialog', { name: MINE_WINDOW })).not.toBeInTheDocument());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByLabelText('comment-editor')).toHaveValue('Unsaved words');
    });
  });

  describe('letting a grip go is no press on the text (the owner, 01.11, iPad: the first verse came off at the lift)', () => {
    /** jsdom has no PointerEvent: a mouse event that keeps the pointer's id. */
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    const realPointerEvent = window.PointerEvent;
    beforeEach(() => { window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent; });
    afterEach(() => { window.PointerEvent = realPointerEvent; });
    const nextFrame = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    const chooseOne = async () => {
      mockRows = { studyNotes: [] };
      renderRuth();
      await waitFor(() => expect(verseText('1:16')).toBeTruthy());
      // The grips stand where verses are chosen for an analysis (a comment's verses are chosen with the shared bar now).
      fireEvent.contextMenu(verseText('1:16'), { clientX: 200, clientY: 300 });
      await userEvent.click(await screen.findByRole('menuitem', { name: 'analysis.verseMenu' }));
      await screen.findByRole('region', { name: 'Руф 1:16' });
      return screen.getByTestId('passage-grips').querySelector<HTMLElement>('[data-passage-grip="last"]')!;
    };
    const pulledName = () => screen.getByRole('region', { name: /^Руф 1:/ }).getAttribute('aria-label') ?? '';

    it('takes the click after the lift for the pull\'s: the first verse stays', async () => {
      const last = await chooseOne();
      fireEvent.pointerDown(last, { pointerId: 2, clientY: 10 });
      fireEvent.pointerMove(last, { pointerId: 2, clientY: 50 });
      await nextFrame();
      fireEvent.pointerUp(last, { pointerId: 2, clientY: 50 });
      const pulled = pulledName();
      expect(pulled).not.toBe('Руф 1:16');
      fireEvent.click(verseText('1:16'), { detail: 1 });
      expect(pulledName()).toBe(pulled);
    });

    // The owner's report, 01.11: the click came 39 ms after the Pencil's lift, naming another pointer, counting no click.
    it('takes the browser\'s click after the lift whatever pointer it names', async () => {
      const last = await chooseOne();
      fireEvent.pointerDown(last, { pointerId: 7, clientY: 10 });
      fireEvent.pointerMove(last, { pointerId: 7, clientY: 50 });
      await nextFrame();
      fireEvent.pointerUp(last, { pointerId: 7, clientY: 50 });
      const pulled = pulledName();
      fireEvent(verseText('1:16'), new TestPointerEvent('click', { bubbles: true, cancelable: true, pointerId: 1, detail: 0 }));
      expect(pulledName()).toBe(pulled);
    });

    it('leaves a key\'s click and a new press their own: right after a pull they still act', async () => {
      const last = await chooseOne();
      fireEvent.pointerDown(last, { pointerId: 2, clientY: 10 });
      fireEvent.pointerMove(last, { pointerId: 2, clientY: 50 });
      await nextFrame();
      fireEvent.pointerUp(last, { pointerId: 2, clientY: 50 });
      const pulled = pulledName();
      // Any key on the text ends the wait (here an arrow), and the click after it is a press.
      fireEvent.keyDown(verseText('1:16'), { key: 'ArrowDown' });
      fireEvent.click(verseText('1:16'), { detail: 0 });
      expect(pulledName()).not.toBe(pulled);
      const shorter = pulledName();
      // A new press on the text, then its click: a press too.
      fireEvent.pointerDown(verseText('1:17'), { pointerId: 2, clientX: 40, clientY: 5 });
      fireEvent.pointerUp(verseText('1:17'), { pointerId: 2, clientX: 40, clientY: 5 });
      fireEvent.click(verseText('1:17'), { detail: 1 });
      expect(pulledName()).not.toBe(shorter);
    });

    it('leaves its own click to a second finger that pressed the text while the grip was held', async () => {
      const last = await chooseOne();
      fireEvent.pointerDown(last, { pointerId: 7, clientY: 10 });
      fireEvent.pointerMove(last, { pointerId: 7, clientY: 50 });
      await nextFrame();
      fireEvent.pointerDown(verseText('1:17'), { pointerId: 8, clientX: 40, clientY: 5 });
      fireEvent.pointerUp(last, { pointerId: 7, clientY: 50 });
      const pulled = pulledName();
      fireEvent.pointerUp(verseText('1:17'), { pointerId: 8, clientX: 40, clientY: 5 });
      fireEvent.click(verseText('1:17'), { detail: 1 });
      expect(pulledName()).not.toBe(pulled);
    });

    it('does not finish a hold another finger keeps on the first verse when the grip is let go', async () => {
      const last = await chooseOne();
      fireEvent.pointerDown(last, { pointerId: 2, clientY: 10 });
      fireEvent.pointerMove(last, { pointerId: 2, clientY: 50 });
      await nextFrame();
      const pulled = pulledName();
      fireEvent.pointerDown(verseText('1:16'), { pointerId: 3, clientX: 40, clientY: 5 });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
      fireEvent.pointerUp(last, { pointerId: 2, clientY: 50 });
      expect(pulledName()).toBe(pulled);
    });
  });

  // Codex review r3: Synodal Psalm 114 reads as King James 116:1–9, and «Изменить стихи» was offered on a chapter comment.
  it('offers a comment\'s verses to be chosen again only when it is on verses, one run in this book', () => {
    expect(choosableRun({ id: 'r', bible: 'rst', book: 'Psalms', chapter: 114 }, 'Psalms', 'kjv')).toBeNull();
    expect(choosableRun({ id: 'r', bible: 'rst', book: 'Psalms', chapter: 114, fromVerse: 2, toVerse: 4 }, 'Psalms', 'kjv')).toEqual(expect.objectContaining({ chapter: 116, fromVerse: 2 }));
    expect(choosableRun({ id: 'r', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }, 'Psalms', 'rst')).toBeNull();
  });

  // Where «Изменить стихи» is not offered, the place says why: King James Romans 16:23-25 is two pieces in the Synodal.
  it('says why a comment\'s verses are not chosen again here', () => {
    expect(versesNotChoosable({ id: 'r', bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 23, toVerse: 25 }, 'Romans', 'rst')).toBe('notOneRun');
    expect(versesNotChoosable({ id: 'r', bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 23, toVerse: 25 }, 'Romans', 'kjv')).toBeNull();
    expect(versesNotChoosable({ id: 'r', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }, 'Psalms', 'rst')).toBe('otherBook');
  });

  // Codex review r3: the paragraphs' rule is a comment's — a comment saved as a note was refused by it.
  it('saves as a note a comment moved over a paragraph\'s edge', async () => {
    mockRows = { studyNotes: [
      row('one', { type: 'comment', content: 'Existing paragraph', scriptureRefs: [{ id: 'r1', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16, toVerse: 18 }] }),
      row('two', { type: 'comment', content: 'Moving', scriptureRefs: [{ id: 'r2', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 20, toVerse: 21 }] }),
    ] };
    renderRuth();
    await userEvent.click(await screen.findByText('Moving'));
    await userEvent.click(await screen.findByRole('button', { name: 'comment.move' }));
    const list = await screen.findByTestId('comment-place-list');
    await userEvent.click(within(list).getAllByRole('button').find((button) => button.textContent?.startsWith('1:15'))!);
    fireEvent.change(screen.getByLabelText('comment-editor'), { target: { value: Array(70).fill('word').join(' ') } });
    fireEvent.change(screen.getByLabelText(/comment.noteTitle/), { target: { value: 'New note' } });
    await userEvent.click(screen.getByRole('button', { name: 'comment.toNote' }));
    expect(mockUpdateNote).toHaveBeenCalledWith(expect.objectContaining({ updates: expect.objectContaining({ type: 'note' }) }));
  });
});

describe('Settings → Bible: your material on the text', () => {
  it('shows comments as text or as badges, as chosen on this device', async () => {
    render(<MineSettings />);
    await userEvent.click(screen.getByRole('button', { name: 'settings.bible.mine.commentsBadge' }));
    expect(window.localStorage.getItem('bible:mine')).toContain('"comments":"badge"');
  });


  it('switches the badges off and on for this device', async () => {
    render(<MineSettings />);
    const toggle = screen.getByTestId('mine-settings-switch');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem('bible:mine')).toContain('false');
  });
});

describe('the bar beside an analysed passage (case 2026-10-12-block-diagram, 3.18)', () => {
  const analysis = (id: string, chapter: number, fromVerse: number | undefined, toChapter: number, toVerse?: number, kind: BookUsageEntry['kind'] = 'analysis') =>
    ({ kind, id, title: id, passage: { chapter, toChapter, fromVerse, toVerse } }) as BookUsageEntry;

  it('runs from an analysis\'s first verse to its last, across a chapter, and only for analyses of verses', () => {
    const verses = analysedVerses([
      analysis('a', 1, 16, 1, 18), analysis('across', 1, 21, 2, 2), analysis('note', 3, 1, 3, 4, 'note'), analysis('whole', 4, undefined, 4),
    ], 'rst', 'Ruth');
    expect([...verses.keys()]).toEqual(['1:16', '1:17', '1:18', '1:21', '1:22', '2:1', '2:2']);
    expect(verses.get('1:16')).toEqual({ top: true, bottom: false });
    expect(verses.get('1:17')).toEqual({ top: false, bottom: false });
    expect(verses.get('1:18')).toEqual({ top: false, bottom: true });
    expect(verses.get('2:1')).toEqual({ top: false, bottom: false });
    expect(verses.get('2:2')).toEqual({ top: false, bottom: true });
  });

  it('keeps a break between two analyses that only touch, and makes one bar of two that overlap', () => {
    const touching = analysedVerses([analysis('first', 1, 16, 1, 18), analysis('next', 1, 19, 1, 20)], 'rst', 'Ruth');
    expect(touching.get('1:18')).toEqual({ top: false, bottom: true });
    expect(touching.get('1:19')).toEqual({ top: true, bottom: false });
    const overlapping = analysedVerses([analysis('first', 1, 16, 1, 18), analysis('over', 1, 17, 1, 20)], 'rst', 'Ruth');
    expect(overlapping.get('1:17')).toEqual({ top: false, bottom: false });
    expect(overlapping.get('1:18')).toEqual({ top: false, bottom: false });
    expect(overlapping.get('1:20')).toEqual({ top: false, bottom: true });
  });

  it('stands beside the verses of an analysis in the reader, and goes with the badges when they are switched off', async () => {
    mockRows = { studyNotes: [row('ruth-16', { title: 'Разбор', content: '', tags: [], type: 'analysis', scriptureRefs: [{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16, toVerse: 18 }] })] };
    renderRuth();
    expect(await screen.findByTestId('analysed-1:16')).toBeInTheDocument();
    expect(screen.getByTestId('analysed-1:17')).toBeInTheDocument();
    expect(screen.getByTestId('analysed-1:18')).toBeInTheDocument();
    expect(screen.queryByTestId('analysed-1:15')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysed-1:19')).not.toBeInTheDocument();
    act(() => saveMinePrefs({ show: false }));
    await waitFor(() => expect(screen.queryByTestId('analysed-1:16')).not.toBeInTheDocument());
  });
});

describe('an analysis in the list of a verse (case 2026-10-12-block-diagram, 3.25)', () => {
  // Opened from its badge, the window is named by the analysis's passage (the owner, 30.10).
  const ANALYSIS_WINDOW = /^\S+ 1:16–18$/;
  const outline = (lines: number) => Array.from({ length: lines }, (_, n) => `${'  '.repeat(n % 3)}- часть ${n + 1}`).join('\n');
  const analysisRow = (content: string, more: Record<string, unknown> = {}) => row('ruth-16', { title: 'Разбор · Руфь 1:16–18', content, tags: [], type: 'analysis', scriptureRefs: [{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16, toVerse: 18 }], ...more });

  it('shows its structure — a part a line, each step deeper — instead of a title repeating the place', async () => {
    mockRows = { studyNotes: [analysisRow('- куда ты пойдешь,\n  - туда и я пойду,\n    - и где ты жить будешь,\n- народ твой будет моим народом')] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const dialog = screen.getByRole('dialog', { name: ANALYSIS_WINDOW });
    const drawn = within(dialog).getByTestId('analysis-outline');
    const steps = Array.from(drawn.querySelectorAll('[data-analysis-line]')) as HTMLElement[];
    expect(steps.map((step) => [step.textContent, step.style.paddingLeft])).toEqual([
      ['куда ты пойдешь,', '0px'], ['туда и я пойду,', '14px'], ['и где ты жить будешь,', '28px'], ['народ твой будет моим народом', '0px'],
    ]);
    expect(within(dialog).queryByText('Разбор · Руфь 1:16–18')).not.toBeInTheDocument();
    // The window's title says the place once, by the badge's circle: no row under it repeating «Разбор · Руфь 1:16–18»
    // (the owner, 30.10).
    expect(within(dialog).getAllByText(/1:16–18/)).toHaveLength(1);
    expect(within(dialog).queryByTestId('mine-entry-analysis-ruth-16')).not.toBeInTheDocument();
  });

  // Phase 7, case 1 (the owner's choice 30.10): from the Bible only a new sermon is made, by the analysis's name.
  it('carries the sermons made from it by its name: «Проповедь +» while none, each one\'s title then — a press opens it', async () => {
    mockRows = { studyNotes: [analysisRow('- куда ты пойдешь,')] };
    const first = renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    expect(within(screen.getByRole('dialog', { name: ANALYSIS_WINDOW })).getByRole('button', { name: 'analysis.sermon.newAria' })).toBeInTheDocument();
    first.unmount();

    mockRows = { studyNotes: [analysisRow('- куда ты пойдешь,')], sermons: [row('built', { title: 'Куда ты пойдёшь', verse: 'Руфь 1:16–18', thoughts: [], date: '2026-10-30', sourceNoteIds: ['ruth-16'] })] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const dialog = screen.getByRole('dialog', { name: ANALYSIS_WINDOW });
    expect(within(dialog).queryByRole('button', { name: 'analysis.sermon.newAria' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Куда ты пойдёшь')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'analysis.sermon.open' }));
    expect(screen.queryByRole('dialog', { name: ANALYSIS_WINDOW })).not.toBeInTheDocument();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sermons/built'));
  });

  it('opens from its badge a window named by its passage, without the verse\'s words above its structure', async () => {
    // The owner, 30.10: «тут нужно ссылку поправить, текст сплошной не нужно дублировать».
    mockRows = { studyNotes: [analysisRow('- куда ты пойдешь,\n- туда и я пойду,'), note('n1', 'Заметка', 'Заметка на стих', [{ bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16 }])] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const dialog = screen.getByRole('dialog', { name: ANALYSIS_WINDOW });
    expect(dialog.querySelector('p.font-serif')).toBeNull();
    // What stands behind that badge, not every document on the verse: the note has its own badge.
    expect(within(dialog).queryByText('Заметка на стих')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('analysis-outline')).toBeInTheDocument();
  });

  // The owner, 30.10: «сюда добавь стрелки уровней, а ссылки просто подкрась слова».
  const tiedRow = (cuts: number[]) => analysisRow('- куда ты пойдешь,\n  - туда и я пойду,\n- народ твой будет моим народом',
    { analysis: { bible: 'rst', words: 12, cuts, links: { 3: 8 }, relations: { '1-10': { dir: 'fwd', color: 'teal' } } } });

  it('draws a tie\'s arrow where the indent does not say it, and the two words of a link in its colour', async () => {
    // «туда и я пойду,» hangs on «твой» in the line below it: an arrow; «ты» and «моим» are linked by meaning.
    mockRows = { studyNotes: [tiedRow([3, 7])] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const drawn = within(screen.getByRole('dialog', { name: ANALYSIS_WINDOW })).getByTestId('analysis-outline');
    expect(drawn.querySelectorAll('svg')).toHaveLength(1);
    const coloured = Array.from(drawn.querySelectorAll('[data-word].text-teal-700')).map((word) => word.textContent);
    expect(coloured).toEqual(['ты', 'моим']);
  });

  it('draws the parts alone when its text and its ties no longer agree, never a tie on the wrong word', async () => {
    mockRows = { studyNotes: [tiedRow([5])] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const drawn = within(screen.getByRole('dialog', { name: ANALYSIS_WINDOW })).getByTestId('analysis-outline');
    expect(drawn.querySelectorAll('[data-analysis-line]')).toHaveLength(3);
    expect(drawn.querySelectorAll('svg')).toHaveLength(0);
    expect(drawn.querySelectorAll('[data-word].text-teal-700')).toHaveLength(0);
  });

  it('shows every step of a long one, the window growing to the screen\'s gaps and scrolling under its title; a press opens the analysis, the end of a selection does not', async () => {
    // The owner, 30.10: «вся эта секция, которая со скроллом была, она будет кликабельная. Нажал и перешёл».
    mockRows = { studyNotes: [analysisRow(outline(30))] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const dialog = screen.getByRole('dialog', { name: ANALYSIS_WINDOW });
    const drawn = within(dialog).getByTestId('analysis-outline');
    const steps = drawn.querySelectorAll('[data-analysis-line]');
    expect(steps).toHaveLength(30);
    expect(drawn).toHaveTextContent('часть 30');
    // The owner, 31.10: «сверху зазор, снизу зазор, и оно расширяется адаптивно» — the box keeps no height of its own,
    // the window grows to its limit and its list scrolls under the title that stays.
    expect(drawn).not.toHaveClass('max-h-[min(22rem,45vh)]');
    expect(drawn.closest('ul')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(dialog).toHaveClass('flex', 'flex-col', 'overflow-hidden', 'xl:max-h-[calc(100dvh-12rem)]', 'xl:mt-24');
    const selected = jest.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'часть 6' } as Selection);
    await userEvent.click(steps[5] as HTMLElement);
    expect(screen.getByRole('dialog', { name: ANALYSIS_WINDOW })).toBeInTheDocument();
    selected.mockRestore();
    await userEvent.click(steps[5] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ANALYSIS_WINDOW })).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'analysis.done' })).toBeInTheDocument();
  });

  it('opens from the keyboard too: the structure is one stop, named for what it opens', async () => {
    mockRows = { studyNotes: [analysisRow('- куда ты пойдешь,\n- туда и я пойду,')] };
    renderRuth();
    await userEvent.click(await screen.findByTestId('mine-1:16-analysis'));
    const card = within(screen.getByRole('dialog', { name: ANALYSIS_WINDOW })).getByRole('button', { name: 'bible.mine.openAnalysis' });
    card.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ANALYSIS_WINDOW })).not.toBeInTheDocument());
  });
});

describe('the words on a badge', () => {
  it('always say the place with its chapter, a whole chapter from its first verse to its last in this Bible', () => {
    expect(badgeLabel({ chapter: 3, toChapter: 3, fromVerse: 16, toVerse: 16 }, 'rst', 'John')).toBe('3:16');
    expect(badgeLabel({ chapter: 3, toChapter: 3, fromVerse: 16, toVerse: 18 }, 'rst', 'John')).toBe('3:16–18');
    expect(badgeLabel({ chapter: 3, toChapter: 4, fromVerse: 16, toVerse: 18 }, 'rst', 'John')).toBe('3:16–4:18');
    expect(badgeLabel({ chapter: 3, toChapter: 3 }, 'rst', 'John')).toBe('3:1–36');
    expect(badgeLabel({ chapter: 22, toChapter: 22 }, 'rst', 'Psalms')).toBe('22:1–6');
    expect(badgeLabel({ chapter: 23, toChapter: 23 }, 'kjv', 'Psalms')).toBe('23:1–6');
  });
});
