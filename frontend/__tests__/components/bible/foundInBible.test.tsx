import { act, renderHook, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { closeFound, drawnAround, foundAt, foundInOrder, openedAlone, showFound, shownFor, useFoundSearch } from '@/components/bible/search/foundInBible';
import { FoundPanel } from '@/components/bible/search/FoundPanel';

import type { FoundVerses } from '@/components/bible/search/useFoundVerses';

const t = (key: string, options?: Record<string, unknown>) => (options && Object.keys(options).length ? `${key}${JSON.stringify(options)}` : key);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'ru' } }) }));

/*
 * «Поиск → Библия» (the owner's choice on the canvas «Путь в Библию», 30.10): the found verses beside the reader's text,
 * read in the Bible's order, the one the reading stands at framed, «К поиску» back to the same window.
 */
const hit = (book: string, chapter: number, verse: number) => ({ book, chapter, verse, text: `${book} ${chapter}:${verse} оживи меня` });

describe('the found verses in the Bible\'s order', () => {
  it('reads them book by book in the Bible\'s order, then by chapter and verse — not the window\'s order of forms', () => {
    // The window lists «оживи» first and its kin after: 118:107 before 118:50.
    const verses = foundInOrder([hit('Psalms', 118, 107), hit('Psalms', 118, 50), hit('Ezekiel', 37, 5), hit('Psalms', 29, 4)], ['Psalms', 'Ezekiel']);
    expect(verses.map((verse) => verse.key)).toEqual(['Psalms 29:4', 'Psalms 118:50', 'Psalms 118:107', 'Ezekiel 37:5']);
  });

  it('stands at the last found verse at or above the reading in this book, before the first at the first, none in another book', () => {
    const verses = foundInOrder([hit('Psalms', 118, 25), hit('Psalms', 118, 50), hit('Ezekiel', 37, 5)], ['Psalms', 'Ezekiel']);
    expect(foundAt(verses, 'Psalms', 118, 40)?.key).toBe('Psalms 118:25');
    expect(foundAt(verses, 'Psalms', 118, 50)?.key).toBe('Psalms 118:50');
    expect(foundAt(verses, 'Psalms', 1, 1)?.key).toBe('Psalms 118:25');
    expect(foundAt(verses, 'John', 3, 16)).toBeNull();
  });

  it('asks the window to show enough verses for the one stood at to be among them', () => {
    const order = Array.from({ length: 250 }, (_, index) => `Psalms 1:${index + 1}`);
    expect(shownFor(order, 'Psalms 1:5', 100)).toBe(100);
    expect(shownFor(order, 'Psalms 1:150', 100)).toBe(200);
    expect(shownFor(order, 'John 3:16', 100)).toBe(100);
  });

  // Codex review, 30.10: standing at the last of 6,855 drew every verse before it.
  it('draws the hundred that holds the verse read; the next hundred joins as the reading reaches it; a jump draws its own alone', () => {
    expect(drawnAround(null, -1, 100, 10000)).toEqual({ from: 0, to: 100 });
    expect(drawnAround(null, 6850, 100, 10000)).toEqual({ from: 6800, to: 6900 });
    const range = { from: 300, to: 400 };
    expect(drawnAround(range, 350, 100, 10000)).toBe(range);
    expect(drawnAround(range, -1, 100, 10000)).toBe(range);
    expect(drawnAround(range, 420, 100, 10000)).toEqual({ from: 300, to: 500 });
    expect(drawnAround(range, 250, 100, 10000)).toEqual({ from: 200, to: 400 });
    expect(drawnAround(range, 5000, 100, 10000)).toEqual({ from: 5000, to: 5100 });
    expect(drawnAround(range, 10, 100, 10000)).toEqual({ from: 0, to: 100 });
    // A list grown shorter than the range drawn starts again rather than draw nothing.
    expect(drawnAround(range, -1, 100, 50)).toEqual({ from: 0, to: 100 });
  });
});

// BUG-20261030-open-in-bible-shows-found-column: a verse opened alone is no request for the column, and of the same
// search it does not take the column away either.
describe('a verse of a search opened alone', () => {
  beforeEach(() => closeFound());

  it('keeps the found verses of the same search — whatever its case and spaces, in the same Bible — and puts away another search\'s', () => {
    showFound({ bible: 'rst', line: 'пс 118 ожив', asWords: false });
    const kept = renderHook(() => useFoundSearch());
    act(() => {
      openedAlone('rst', undefined);
      openedAlone('rst', { line: '  Пс  118 ОЖИВ ', asWords: false });
    });
    expect(kept.result.current).toEqual({ bible: 'rst', line: 'пс 118 ожив', asWords: false });
    act(() => openedAlone('rst', { line: 'пс 118 ожив', asWords: true }));
    expect(kept.result.current).toBeNull();
    act(() => showFound({ bible: 'rst', line: 'пс 118 ожив', asWords: false }));
    act(() => openedAlone('rst', { line: '"хлеб жизни"', asWords: false }));
    expect(kept.result.current).toBeNull();
    // The same words in another Bible are another search (Codex review of the fix).
    act(() => showFound({ bible: 'rst', line: 'Авраам', asWords: false }));
    act(() => openedAlone('ubio', { line: 'Авраам', asWords: false }));
    expect(kept.result.current).toBeNull();
  });
});

describe('the found verses beside the text', () => {
  // The found word marked as the search marks it: here, any word beginning «ожив».
  const piecesOf = (text: string) => text.split(/(ожив\S*)/).filter(Boolean).map((piece) => ({ text: piece, lit: piece.startsWith('ожив') }));
  const found: FoundVerses = {
    verses: [
      { key: 'Psalms 118:25', bookId: 'Psalms', chapter: 118, verse: 25, text: 'Душа моя повержена в прах; оживи меня' },
      { key: 'Psalms 118:50', bookId: 'Psalms', chapter: 118, verse: 50, text: 'слово Твое оживляет меня' },
    ],
    piecesOf,
    windowOrder: ['Psalms 118:25', 'Psalms 118:50'],
    loading: false,
  };
  const props = () => ({ onGo: jest.fn(), onBack: jest.fn(), onClose: jest.fn() });

  it('names the search and where the reading stands by its count, lights no row, and underlines the found words', () => {
    render(<FoundPanel line="пс 118 ожив" found={found} atKey="Psalms 118:50" locale="ru" {...props()} />);
    expect(screen.getByText('«пс 118 ожив»')).toBeInTheDocument();
    expect(screen.getByText(/bible\.found\.position\{"at":2,"count":2\}/)).toBeInTheDocument();
    const rows = Array.from(document.querySelectorAll('[data-found-row]'));
    // Said to a screen reader, not lit (the owner, 30.10: «здесь подсветку не нужно делать»).
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'location']);
    rows.forEach((row) => expect(row.className).not.toMatch(/ring-amber/));
    expect(within(rows[0] as HTMLElement).getByText('оживи')).toHaveClass('underline');
  });

  it('puts the text on a verse pressed, goes back to the search and closes — and offers no wider place: what was searched is shown', async () => {
    const handlers = props();
    render(<FoundPanel line="пс 118 ожив" found={found} atKey="Psalms 118:25" locale="ru" {...handlers} />);
    await userEvent.click(document.querySelectorAll<HTMLElement>('[data-found-row]')[1]);
    expect(handlers.onGo).toHaveBeenCalledWith(found.verses[1]);
    await userEvent.click(screen.getByRole('button', { name: 'bible.found.back' }));
    expect(handlers.onBack).toHaveBeenCalled();
    // The owner, 30.10: «мы видим то, по чём искали, что видели на экране, то и запустили».
    expect(screen.queryByRole('button', { name: /bible\.search\.wider/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.found.close' }));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  // Codex review, 30.10: «Господь» finds 6,855 verses, and the column drew every one of them on each step of the reading.
  const many = (count: number): FoundVerses => ({
    verses: Array.from({ length: count }, (_, index) => ({ key: `Psalms 1:${index + 1}`, bookId: 'Psalms', chapter: 1, verse: index + 1, text: 'оживи меня' })),
    piecesOf: jest.fn(piecesOf),
    windowOrder: [],
    loading: false,
  });
  const rows = () => Array.from(document.querySelectorAll('[data-found-row]')).map((row) => row.getAttribute('data-found-row'));

  it('draws a word found on every page a hundred at a time, as the search window does, and draws on as the reading reaches the end', async () => {
    const found250 = many(250);
    const view = render(<FoundPanel line="ожив" found={found250} atKey={null} locale="ru" {...props()} />);
    expect(rows()).toHaveLength(100);
    // The words are marked for the rows drawn, not for all the search found.
    expect(found250.piecesOf).toHaveBeenCalledTimes(100);
    expect(screen.queryByText(/bible\.found\.showEarlier/)).not.toBeInTheDocument();
    expect(screen.getByText(/bible\.search\.showMore\{"count":100\}/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/bible\.search\.showMore/));
    expect(rows()).toHaveLength(200);
    expect(screen.getByText(/bible\.search\.showMore\{"count":50\}/)).toBeInTheDocument();

    // Read on to the 230th: drawn to it; read back to the 1st: the list stays as long as it was.
    view.rerender(<FoundPanel line="ожив" found={found250} atKey="Psalms 1:230" locale="ru" {...props()} />);
    expect(rows()).toHaveLength(250);
    expect(screen.queryByText(/bible\.search\.showMore/)).not.toBeInTheDocument();
    view.rerender(<FoundPanel line="ожив" found={found250} atKey="Psalms 1:1" locale="ru" {...props()} />);
    expect(rows()).toHaveLength(250);
  });

  it('opened at a verse far down, draws the hundred around it, with the earlier ones a press away — never all before it', async () => {
    const lord = many(6855);
    const view = render(<FoundPanel line="Господь" found={lord} atKey="Psalms 1:6850" locale="ru" {...props()} />);
    expect(rows()).toHaveLength(55);
    expect(rows()[0]).toBe('Psalms 1:6801');
    expect(lord.piecesOf).toHaveBeenCalledTimes(55);
    expect(screen.getByText(/bible\.found\.showEarlier\{"count":100\}/)).toBeInTheDocument();
    expect(screen.queryByText(/bible\.search\.showMore/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/bible\.found\.showEarlier/));
    expect(rows()).toHaveLength(155);
    expect(rows()[0]).toBe('Psalms 1:6701');

    // A jump back to the start of the book: its own hundred, alone.
    view.rerender(<FoundPanel line="Господь" found={lord} atKey="Psalms 1:3" locale="ru" {...props()} />);
    expect(rows()).toHaveLength(100);
    expect(rows()[0]).toBe('Psalms 1:1');
    expect(screen.queryByText(/bible\.found\.showEarlier/)).not.toBeInTheDocument();
  });

  // Codex review, 30.10, live: opened in Revelation the list showed its first verses, 22:20 far out of sight.
  it('brings the verse arrived at into the list\'s middle when out of sight; reading on or a verse pressed in sight leaves it as scrolled; verses drawn above stay put', async () => {
    // Rows 40 px tall, the list 400 px: geometry jsdom does not lay out.
    const realRect = Element.prototype.getBoundingClientRect;
    const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 244, width: 244, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const items = (list: Element) => Array.from(list.children);
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.tagName === 'OL') return box(0, 400);
      const item = this.closest('li');
      const list = item?.parentElement;
      return list ? box(items(list).indexOf(item as Element) * 40 - list.scrollTop, 40) : realRect.call(this);
    };
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.tagName === 'OL' ? 400 : 0; } });
    Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get() { return this.tagName === 'OL' ? this.children.length * 40 : 0; } });
    try {
      const found300 = many(300);
      const panel = (atKey: string, arrived: { key: string; of: object }) => <FoundPanel line="ожив" found={found300} atKey={atKey} arrived={arrived} locale="ru" {...props()} />;
      const arrival = (key: string) => ({ key, of: {} });
      const first = arrival('Psalms 1:150');
      const view = render(panel('Psalms 1:150', first));
      const list = document.querySelector('[data-found-panel] ol') as HTMLElement;
      // 101–200 drawn under «выше»: 1:150 is the 51st item, 2000 px down — brought to the middle.
      expect(list.scrollTop).toBe(50 * 40 - (400 - 40) / 2);
      const middle = list.scrollTop;
      // Reading on: no arrival, the list stays — also when the person scrolled it away.
      view.rerender(panel('Psalms 1:152', first));
      expect(list.scrollTop).toBe(middle);
      list.scrollTop = 0;
      view.rerender(panel('Psalms 1:153', first));
      expect(list.scrollTop).toBe(0);
      // Arriving at 1:150 again is an arrival of its own: brought back (Codex review r3).
      view.rerender(panel('Psalms 1:150', arrival('Psalms 1:150')));
      expect(list.scrollTop).toBe(middle);
      // A verse pressed in sight: an arrival, already in sight.
      view.rerender(panel('Psalms 1:146', arrival('Psalms 1:146')));
      expect(list.scrollTop).toBe(middle);
      view.rerender(panel('Psalms 1:101', arrival('Psalms 1:101')));
      expect(list.scrollTop).toBe(0);

      // «Показать … выше» at the top: the hundred drawn over them, those in sight stay where they stood.
      await userEvent.click(screen.getByText(/bible\.found\.showEarlier/));
      expect(rows()).toHaveLength(200);
      expect(list.scrollTop).toBe(100 * 40 - 40);
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      if (scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight);
    }
  });

  it('draws again only the rows whose «here» changed as the reading moves', () => {
    const counted: FoundVerses = { ...found, piecesOf: jest.fn(piecesOf) };
    const onGo = jest.fn();
    const view = render(<FoundPanel line="ожив" found={counted} atKey="Psalms 118:25" locale="ru" onGo={onGo} onBack={jest.fn()} onClose={jest.fn()} />);
    expect(counted.piecesOf).toHaveBeenCalledTimes(2);
    view.rerender(<FoundPanel line="ожив" found={counted} atKey="Psalms 118:50" locale="ru" onGo={onGo} onBack={jest.fn()} onClose={jest.fn()} />);
    expect(counted.piecesOf).toHaveBeenCalledTimes(4);
    view.rerender(<FoundPanel line="ожив" found={counted} atKey="Psalms 118:50" locale="ru" onGo={onGo} onBack={jest.fn()} onClose={jest.fn()} />);
    expect(counted.piecesOf).toHaveBeenCalledTimes(4);
  });
});
