import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { resetMinePrefsForTests, saveMinePrefs } from '@/components/bible/minePrefs';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { badgeLabel, entriesAt, useBookUsage } from '@/components/bible/useBookUsage';
import MineSettings from '@/components/settings/MineSettings';

import type { BookText } from '@/utils/bibleText';
import type { BookUsageEntry } from '@/utils/scriptureUsage';

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
const mockWatched: Array<string | null> = [];
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
  useDataCollection: (name: string | null) => (mockWatched.push(name), {
    state: name ? { documents: mockRows[name] ?? [], complete: mockComplete, freshness: 'server' } : null,
    loading: false, error: null, refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
// The comment's window reads and writes through the notes' engine door; here it reads the rows above.
jest.mock('@/hooks/useStudyNotesEngine', () => ({
  useStudyNotesEngine: () => ({
    uid: 'owner',
    notes: (mockRows.studyNotes ?? []).map((stored) => ({ id: stored.resource.id, tags: [], scriptureRefs: [], createdAt: '', updatedAt: '', isDraft: false, ...stored.value })),
    createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn(),
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
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone() { return this; }, headers: new Headers({ 'content-type': 'application/json' }) });

const row = (id: string, value: Record<string, unknown>, extra: Partial<Row> = {}): Row => ({ resource: { id }, value: { userId: 'owner', updatedAt: '', ...value }, ...extra });
const sermon = (id: string, verse: string, title = id) => row(id, { title, verse, thoughts: [], date: '' });
const note = (id: string, content: string, title = id, refs: unknown[] = []) => row(id, { title, content, scriptureRefs: refs, tags: [] });
const group = (id: string, refs: string[]) => row(id, { title: id, templates: [{ id: 'b', title: 'Чтение', content: '', scriptureRefs: refs }], flow: [] });
const order = (id: string, refs: string[]) => row(id, { title: id, steps: [{ id: 's', title: 'Чтение', body: '', scriptureRefs: refs }], rank: 1 });

beforeEach(() => {
  mockRows = {};
  mockComplete = true;
  mockPush.mockClear();
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
