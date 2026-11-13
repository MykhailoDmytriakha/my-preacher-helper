import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler } from 'react';

import { BookRibbon, type RibbonSigns } from '@/components/bible/BookRibbon';
import { MarkedElsewhereSheet } from '@/components/bible/marks/MarkedElsewhereSheet';
import { markedElsewhere, versesElsewhere } from '@/utils/bibleMarks';
import { fetchBookText, type BookText } from '@/utils/bibleText';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';

jest.mock('@/utils/bibleText', () => ({
  ...jest.requireActual('@/utils/bibleText'),
  fetchBookText: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { verse?: number }) => (options?.verse ? `${key}:${options.verse}` : key) }),
}));

/*
 * 2.9.3: a verse marked in another Bible carries a sign here, and the sign opens the verse there whole,
 * in its own words, painted as it is painted there.
 */
const synodal: BookText = { id: 'Isaiah', chapters: [[], [], [], ['Уповайте на Господа вовеки, ибо Господь Бог есть твердыня вечная:']] };

/** The page in sight or behind another tab, as the browser tells it. */
function showPage(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('a verse marked in another Bible', () => {
  beforeEach(() => {
    __resetConnectivityForTests();
    showPage(true);
    jest.mocked(fetchBookText).mockReset().mockResolvedValue(synodal);
  });

  it('carries a sign of its colours beside the number, which opens it', () => {
    const onOpen = jest.fn();
    const signs: RibbonSigns = { at: new Map([['1:2', ['#e5484d', '#8b8f98']]]), label: (verse) => `sign ${verse}`, onOpen };
    render(<BookRibbon text={{ id: 'Isaiah', chapters: [['First words.', 'Second words.']] }} lang="en" chapterWord={(c) => `Chapter ${c}`} signs={signs} />);
    expect(screen.queryByTestId('marked-elsewhere-1:1')).toBeNull();
    const sign = screen.getByRole('button', { name: 'sign 2' });
    expect([...sign.querySelectorAll('span span')].map((stripe) => (stripe as HTMLElement).style.backgroundColor)).toEqual(['rgb(229, 72, 77)', 'rgb(139, 143, 152)']);
    fireEvent.click(sign);
    expect(onOpen).toHaveBeenCalledWith(1, 2);
  });

  it('opens whole, in the words of the translation where it was marked, painted as there', async () => {
    const elsewhere = markedElsewhere('kjv', 'Isaiah', [{ bible: 'rst', marks: { '4:1': { m: [[0, 3, 'orange'], [5, 9, 'red']], p: [[5, 6, 'gray']] } } }]);
    const onOpenBible = jest.fn();
    render(
      <MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="ru" entries={versesElsewhere(elsewhere, '4:1')} onClose={jest.fn()} onOpenBible={onOpenBible} />
    );
    const there = screen.getByTestId('marked-in-rst');
    const verse = await within(there).findByText('Уповайте');
    const words = [...verse.closest('p')!.querySelectorAll('[data-word]')];
    expect(words.map((word) => word.textContent).join(' ')).toBe('Уповайте на Господа вовеки, ибо Господь Бог есть твердыня вечная:');
    const painted = (word: string) => words.find((element) => element.textContent === word)!.className;
    // The marker's colour is the band of the run around the word (one band per run, rounded as in the reader).
    const band = (word: string) => words.find((element) => element.textContent === word)!.closest('[data-run]')?.className ?? '';
    expect(band('Уповайте')).toContain('bg-[var(--mark-fill-orange)]');
    expect(band('Уповайте')).toBe(band('Господа'));
    expect(band('ибо')).toBe('');
    expect(band('Господь')).toContain('bg-[var(--mark-fill-red)]');
    expect(band('Господь')).toContain('rounded');
    expect(painted('Господь')).toContain('decoration-[#8b8f98]');
    expect(fetchBookText).toHaveBeenCalledWith('Isaiah', 'rst');
    fireEvent.click(within(there).getByRole('button', { name: 'bible.marks.openThere' }));
    expect(onOpenBible).toHaveBeenCalledWith('rst');
  });

  // BUG-20261112-link-texts-stay-dots-after-reconnect, the same illness here: the words that did not come
  // are read again when the server is back in reach, while the window stays open.
  it('says the words could not be read, and shows them by itself when the server answers again', async () => {
    jest.mocked(fetchBookText).mockRejectedValueOnce(new Error('offline'));
    const elsewhere = markedElsewhere('kjv', 'Isaiah', [{ bible: 'rst', marks: { '4:1': { m: [[0, 3, 'orange']] } } }]);
    render(
      <MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="ru" entries={versesElsewhere(elsewhere, '4:1')} onClose={jest.fn()} onOpenBible={jest.fn()} />
    );
    const there = screen.getByTestId('marked-in-rst');
    expect(await within(there).findByText('bible.marks.elsewhereNoText')).toBeInTheDocument();
    act(() => reportServerUnreachable());
    act(() => reportServerReachable());
    expect(await within(there).findByText('Уповайте')).toBeInTheDocument();
    expect(fetchBookText).toHaveBeenCalledTimes(2);
  });

  // Codex review, 2026-11-12: the return of the server read every translation again — the one already shown too,
  // whose words a second failure then replaced with "no text", and the one still on its way.
  describe('marked in two other Bibles', () => {
    const inTwo = () => versesElsewhere(markedElsewhere('ubio', 'Isaiah', [
      { bible: 'rst', marks: { '4:1': { m: [[0, 0, 'orange']] } } },
      { bible: 'kjv', marks: { '4:1': { m: [[0, 0, 'orange']] } } },
    ]), '4:1');
    const readsOf = (bible: string) => jest.mocked(fetchBookText).mock.calls.filter(([, read]) => read === bible).length;
    const english: BookText = { id: 'Isaiah', chapters: [[], [], [], ['Trust ye in the LORD for ever']] };

    it('reads again only the translation that did not come, and keeps the words already shown', async () => {
      let back = false;
      jest.mocked(fetchBookText).mockImplementation(async (_book, bible) => {
        if (bible === 'rst' && !back) return synodal;
        if (bible === 'kjv' && back) return english;
        throw new Error('offline');
      });
      render(<MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="uk" entries={inTwo()} onClose={jest.fn()} onOpenBible={jest.fn()} />);
      const shown = screen.getByTestId('marked-in-rst');
      await within(shown).findByText('Уповайте');
      await within(screen.getByTestId('marked-in-kjv')).findByText('bible.marks.elsewhereNoText');

      back = true;
      act(() => reportServerUnreachable());
      act(() => reportServerReachable());
      await within(screen.getByTestId('marked-in-kjv')).findByText('Trust');
      expect(within(shown).getByText('Уповайте')).toBeInTheDocument();
      expect(readsOf('rst')).toBe(1);
      expect(readsOf('kjv')).toBe(2);
    });

    it('does not read a second time the translation still on its way', async () => {
      let arrive: (text: BookText) => void = () => undefined;
      jest.mocked(fetchBookText).mockImplementation((_book, bible) => (
        bible === 'rst' ? new Promise<BookText>((resolve) => { arrive = resolve; }) : Promise.reject(new Error('offline'))
      ));
      render(<MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="uk" entries={inTwo()} onClose={jest.fn()} onOpenBible={jest.fn()} />);
      await within(screen.getByTestId('marked-in-kjv')).findByText('bible.marks.elsewhereNoText');
      act(() => reportServerUnreachable());
      act(() => reportServerReachable());
      await waitFor(() => expect(readsOf('kjv')).toBe(2));
      expect(readsOf('rst')).toBe(1);
      await act(async () => { arrive(synodal); });
      expect(await within(screen.getByTestId('marked-in-rst')).findByText('Уповайте')).toBeInTheDocument();
    });
  });

  // Codex review, round 2, 2026-11-12: the person's own asking — the window opened again, another verse, the book
  // come back to — reads what did not come, whatever the server; only a pass the server's return began waits its turn.
  describe('the words that did not come', () => {
    const inRst = () => versesElsewhere(markedElsewhere('kjv', 'Isaiah', [{ bible: 'rst', marks: { '4:1': { m: [[0, 0, 'orange']] } } }]), '4:1');
    const sheet = (open: boolean, bookId = 'Isaiah') => (
      <MarkedElsewhereSheet at={open ? { chapter: 4, verse: 1 } : null} bookId={bookId} locale="ru" entries={inRst()} onClose={jest.fn()} onOpenBible={jest.fn()} />
    );

    it('are read again when the window is closed and opened again', async () => {
      jest.mocked(fetchBookText).mockRejectedValueOnce(new Error('offline'));
      const { rerender } = render(sheet(true));
      expect(await screen.findByText('bible.marks.elsewhereNoText')).toBeInTheDocument();
      rerender(sheet(false));
      rerender(sheet(true));
      expect(await screen.findByText('Уповайте')).toBeInTheDocument();
      expect(fetchBookText).toHaveBeenCalledTimes(2);
    });

    it('are read again when the person comes back to the book from another one', async () => {
      const other: BookText = { id: 'Ruth', chapters: [[], [], [], ['Слова Руфи']] };
      jest.mocked(fetchBookText).mockRejectedValueOnce(new Error('offline'));
      jest.mocked(fetchBookText).mockImplementation(async (book) => (book === 'Ruth' ? other : synodal));
      const { rerender } = render(sheet(true));
      expect(await screen.findByText('bible.marks.elsewhereNoText')).toBeInTheDocument();
      rerender(sheet(true, 'Ruth'));
      expect(await screen.findByText('Слова')).toBeInTheDocument();
      rerender(sheet(true));
      expect(await screen.findByText('Уповайте')).toBeInTheDocument();
    });

    // Codex review, round 3, 2026-11-12: the late death of a read nobody wants any more was kept as one that waits.
    it('wake nothing when their read dies after the window was closed', async () => {
      let refuse: () => void = () => undefined;
      jest.mocked(fetchBookText).mockImplementation(() => new Promise<BookText>((_, reject) => { refuse = () => reject(new Error('offline')); }));
      let draws = 0;
      const drawn = (open: boolean) => <Profiler id="marks" onRender={() => { draws += 1; }}>{sheet(open)}</Profiler>;
      const { rerender } = render(drawn(true));
      await waitFor(() => expect(fetchBookText).toHaveBeenCalledTimes(1));
      rerender(drawn(false));
      await act(async () => { refuse(); });
      const before = draws;
      for (let visit = 0; visit < 3; visit += 1) {
        act(() => showPage(false));
        act(() => showPage(true));
      }
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(draws).toBe(before);
      expect(fetchBookText).toHaveBeenCalledTimes(1);
    });

    it('are not read when the server comes back and at once goes out of reach again', async () => {
      jest.mocked(fetchBookText).mockRejectedValue(new Error('offline'));
      render(sheet(true));
      expect(await screen.findByText('bible.marks.elsewhereNoText')).toBeInTheDocument();
      act(() => { reportServerUnreachable(); reportServerReachable(); reportServerUnreachable(); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(fetchBookText).toHaveBeenCalledTimes(1);
    });
  });

  it('never shows the words of the book left under the next book: its texts are kept for one book', async () => {
    const ruth: BookText = { id: 'Ruth', chapters: [['Слова Руфи']] };
    jest.mocked(fetchBookText).mockImplementation((book) => (book === 'Ruth' ? Promise.resolve(ruth) : new Promise<BookText>(() => undefined)));
    const entries = versesElsewhere(markedElsewhere('kjv', 'Ruth', [{ bible: 'rst', marks: { '1:1': { m: [[0, 0, 'orange']] } } }]), '1:1');
    const window = (bookId: string, open: boolean) => (
      <MarkedElsewhereSheet at={open ? { chapter: 1, verse: 1 } : null} bookId={bookId} locale="ru" entries={entries} onClose={jest.fn()} onOpenBible={jest.fn()} />
    );
    const { rerender } = render(window('Ruth', true));
    expect(await screen.findByText('Слова')).toBeInTheDocument();
    rerender(window('Ruth', false));
    rerender(window('Esther', true));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Слова')).not.toBeInTheDocument();
  });

  it('opens nothing where no other Bible marked the verse', () => {
    render(<MarkedElsewhereSheet at={{ chapter: 4, verse: 1 }} bookId="Isaiah" locale="ru" entries={[]} onClose={jest.fn()} onOpenBible={jest.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
