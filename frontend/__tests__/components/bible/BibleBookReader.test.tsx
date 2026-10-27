import { ReaderShell } from '../../../test-utils/reader-shell';
import { act, fireEvent, render as renderUI, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleBookReader, roomBelow } from '@/components/bible/BibleBookReader';
import { ChapterPicker, ReadingPill } from '@/components/bible/BiblePicker';
import { currentEntryId, saveEntryPlace } from '@/components/bible/lastPlace';
import { arriveOnTrail, changeTranslationOnTrail, readPlaceTrail, resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import { LONG_PRESS_MS } from '@/hooks/useLongPress';
import { verseCount } from '@/utils/versification';

const render = (ui: React.ReactNode, options?: Parameters<typeof renderUI>[1]) => renderUI(ui, { wrapper: ReaderShell, ...options });

// The reader's marks keep one form of the data engine per book; these tests mount no engine.
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));

// A book of the real shape: Ruth has four chapters, and the reader refuses a file that does not.
const book = {
  id: 'Ruth',
  chapters: [
    ['¶Павел, Апостол', 'Тимофею: <J>мир</J> <i>вам</i>'],
    ['¶Итак прежде всего'],
    ['¶Третья глава'],
    ['¶Четвёртая глава'],
  ],
};

const okResponse = () => ({ ok: true, status: 200, json: async () => book, clone() { return this; } });

// The chapter window as it is, its options kept: a test can say what the window says after it moved the page.
let mockWindowOptions: { onDrawn?: (moved: number) => void } | null = null;
jest.mock('@/components/bible/useChapterWindow', () => {
  const actual = jest.requireActual('@/components/bible/useChapterWindow');
  return {
    ...actual,
    useChapterWindow: (options: { onDrawn?: (moved: number) => void }) => {
      mockWindowOptions = options;
      return actual.useChapterWindow(options);
    },
  };
});

const scrollIntoView = jest.fn();

/**
 * A finger held on a button half a second, then lifted (`useLongPress`). jsdom has no PointerEvent, and
 * fireEvent.pointerDown would drop the pointer's type: a mouse event under the pointer's name, as `marks.test.tsx`.
 */
async function hold(target: Element) {
  const pointer = (type: 'pointerdown' | 'pointerup') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0 });
    Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } });
    fireEvent(target, event);
  };
  pointer('pointerdown');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 30)); });
  pointer('pointerup');
}
/** The button of a number in a window's grid: its text sits in a span above the hold's fill. */
const tile = (window_: HTMLElement, number: string) => within(window_).getByText(number, { selector: 'span' }).closest('button') as HTMLElement;

async function openBooks() {
  await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'bible.allBooks' }));
}

/** A computer (768 px and wider) or a phone: what `matchMedia` answers the reader. */
let screenWidth = 390;

beforeEach(() => {
  screenWidth = 390;
  window.matchMedia = jest.fn((query: string) => ({
    matches: query === '(hover: hover)' ? screenWidth >= 1024 : Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= screenWidth, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  // Every test starts on a fresh history entry: a place saved by one must not open the next.
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetPlaceTrailForTests();
  global.fetch = jest.fn(async () => okResponse()) as unknown as typeof fetch;
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

describe('BibleBookReader', () => {
  it('reads the whole book as one ribbon, marking added words and words of Jesus', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);

    expect(await screen.findByText('Павел, Апостол')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/bible-text/rst/v1/ruth.json', expect.objectContaining({ signal: expect.anything() }));
    expect(within(screen.getByTestId('reader-shell-header')).getByRole('button', { name: 'bible.navigate' })).toHaveTextContent('Ruth');
    expect(screen.getAllByRole('region', { name: 'bible.chapter' })).toHaveLength(4);
    expect(screen.getByText('Итак прежде всего')).toBeInTheDocument();
    expect(screen.getByText('мир')).toHaveClass('text-rose-800');
    expect(screen.getByText('вам')).toHaveClass('italic');
    await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
    const window_ = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
    expect(within(window_).getAllByRole('button', { name: 'bible.chapter' }).map((cell) => cell.textContent)).toEqual(['1', '2', '3', '4']);
    expect(screen.getByText('Павел, Апостол')).toHaveAttribute('lang', 'ru');
  });

  it('opens at the verse it was asked for', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} onOpenBook={jest.fn()} />);
    await screen.findByText('Итак прежде всего');
    expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-verse="1:2"]')]);
  });

  it('opens a chapter at its heading, so the chapter\'s name shows above its first verse', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 2, verse: 1 }} onOpenBook={jest.fn()} />);
    await screen.findByText('Итак прежде всего');
    const section = document.querySelector<HTMLElement>('[data-chapter="2"]');
    expect(scrollIntoView.mock.contexts).toEqual([section]);
    expect(section?.style.scrollMarginTop).toBe('var(--reading-top)');
    // The room above the chapter is outside its box: the chapter before ends 24 px above the reading
    // top, so it is not taken for the place (inside the box, Ps 118:1 read as Ps 117).
    expect(section).toHaveClass('mt-6');
    expect(section?.querySelector('h2')?.parentElement).not.toHaveClass('pt-6');
  });

  it('puts a verse it jumps to exactly where the place is measured from — under the measured nav — so a return does not drift up a verse', async () => {
    // The app's nav, 61 px high as on a phone; the reading area starts 16 px under it.
    const nav = document.createElement('nav');
    nav.getBoundingClientRect = () => ({ top: 0, bottom: 61, left: 0, right: 390, width: 390, height: 61, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.prepend(nav);
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 2, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Итак прежде всего');
      const row = document.querySelector<HTMLElement>('[data-verse="2:1"]');
      expect(row?.style.scrollMarginTop).toBe('var(--reading-top)');
      // jsdom does not read custom properties back through `style`; the attribute is what the browser gets.
      expect(row?.closest('[style*="--reading-top:"]')?.getAttribute('style')).toContain('--reading-top: 77px');
    } finally {
      nav.remove();
    }
  });

  it('takes the verse it opened at for the place until the page is moved, though a verse near the end cannot reach the top', async () => {
    // Rom 16:25 three verses before the end: the page stops short, and the top shows 16:15.
    const order = ['1:1', '1:2', '2:1', '3:1', '4:1'];
    let topRow = '1:1';
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const verse = this.dataset?.verse;
      if (!verse) return realRect.call(this);
      const top = 16 + (order.indexOf(verse) - order.indexOf(topRow)) * 40;
      return { top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    window.history.replaceState({ bibleEntry: 'entry-end' }, '');
    const entry = () => JSON.parse(window.sessionStorage.getItem('bible:entry:entry-end') ?? 'null');
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Итак прежде всего');
      window.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(entry()).toEqual({ chapter: 1, verse: 2, bible: 'rst' });

      // The person scrolls: from here the place is what the top shows.
      Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
      topRow = '2:1';
      window.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(entry()).toEqual({ chapter: 2, verse: 1, bible: 'rst' });
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      window.history.replaceState(null, '');
    }
  });

  it('names the place on the phone header button as a reference names it', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} onOpenBook={jest.fn()} />);
    await screen.findByText('Итак прежде всего');
    expect(screen.getByRole('button', { name: 'bible.navigate' })).toHaveTextContent('1:2');
  });

  it('lights the passage a link named, then lets it fade on its own', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const { container } = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} passageEnd={2} onOpenBook={jest.fn()} />);
      await screen.findByText('Итак прежде всего');
      const row = (key: string) => container.querySelector(`[data-verse="${key}"]`);
      expect(row('1:1')).toHaveAttribute('data-arrival', 'on');
      expect(row('1:2')).toHaveAttribute('data-arrival', 'on');
      expect(row('2:1')).not.toHaveAttribute('data-arrival');
      act(() => { jest.advanceTimersByTime(4900); });
      expect(row('1:1')).toHaveAttribute('data-arrival', 'on');
      act(() => { jest.advanceTimersByTime(100); });
      expect(row('1:1')).toHaveAttribute('data-arrival', 'off');
      act(() => { jest.advanceTimersByTime(3600); });
      expect(row('1:1')).not.toHaveAttribute('data-arrival');
    } finally {
      jest.useRealTimers();
      window.history.replaceState(null, '');
    }
  });

  it('lights the passage for the time left when the book is drawn anew, as in a Bible that arrives a moment late', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    window.history.replaceState(null, '');
    try {
      const link = { bible: 'rst', initialBible: 'rst', bookId: 'Ruth', initialPlace: { chapter: 1, verse: 1 }, passageEnd: 2 } as const;
      const first = render(<BibleBookReader {...link} onChangeBible={jest.fn()} onOpenBook={jest.fn()} />);
      await screen.findByText('Итак прежде всего');
      act(() => { jest.advanceTimersByTime(2000); });
      first.unmount();
      // The first reader kept this entry's place, so the new one is not a new arrival.
      saveEntryPlace(currentEntryId(), { chapter: 1, verse: 1, bible: 'rst' });
      const { container } = render(<BibleBookReader {...link} onChangeBible={jest.fn()} onOpenBook={jest.fn()} />);
      await screen.findByText('Итак прежде всего');
      const row = container.querySelector('[data-verse="1:2"]');
      expect(row).toHaveAttribute('data-arrival', 'on');
      act(() => { jest.advanceTimersByTime(2500); });
      expect(row).toHaveAttribute('data-arrival', 'on');
      act(() => { jest.advanceTimersByTime(600); });
      expect(row).toHaveAttribute('data-arrival', 'off');
    } finally {
      jest.useRealTimers();
      window.history.replaceState(null, '');
    }
  });

  // Codex review 2026-10-15: the timers of the passage before were cleared, its light was not — it stayed lit for good.
  it('takes the light from the passage before when another link opens in the same reader', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    window.history.replaceState(null, '');
    try {
      const props = { bible: 'rst', initialBible: 'rst', bookId: 'Ruth' } as const;
      const { container, rerender } = render(<BibleBookReader {...props} onChangeBible={jest.fn()} onOpenBook={jest.fn()} initialPlace={{ chapter: 1, verse: 1 }} passageEnd={2} />);
      await screen.findByText('Итак прежде всего');
      const row = (key: string) => container.querySelector(`[data-verse="${key}"]`);
      expect(row('1:2')).toHaveAttribute('data-arrival', 'on');
      rerender(<BibleBookReader {...props} onChangeBible={jest.fn()} onOpenBook={jest.fn()} initialPlace={{ chapter: 3, verse: 1 }} passageEnd={1} />);
      expect(row('3:1')).toHaveAttribute('data-arrival', 'on');
      expect(row('1:1')).not.toHaveAttribute('data-arrival');
      expect(row('1:2')).not.toHaveAttribute('data-arrival');
    } finally {
      jest.useRealTimers();
      window.history.replaceState(null, '');
    }
  });

  // A short book on a tall screen: the page measures as the window, and the first room fell short.
  it.each([1200, 3000])('gives a short book enough room for its last verse to reach the reading top, in a window %i px tall', async (windowHeight) => {
    const realHeight = window.innerHeight;
    const realRect = Element.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: windowHeight });
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset?.verse === '4:1') return { top: 500, bottom: 530, left: 0, right: 600, width: 600, height: 30, x: 0, y: 500, toJSON: () => ({}) } as DOMRect;
      return realRect.call(this);
    };
    const room = () => parseFloat(document.querySelector('article')?.style.marginBottom ?? '') || 0;
    // 800 px of content and the room under it — and never shorter than the window, as a browser measures.
    const scrollHeight = jest.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => Math.max(window.innerHeight, 800 + room()));
    // What counts is the room at the moment of the jump: later passes grew it, but the page had already stopped short.
    let scrollableAtJump = -1;
    scrollIntoView.mockImplementation(() => { scrollableAtJump = document.documentElement.scrollHeight - window.innerHeight; });
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 4, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Четвёртая глава');
      const readingTop = Number(/--reading-top: (\d+)px/.exec(document.querySelector('[style*="--reading-top:"]')?.getAttribute('style') ?? '')?.[1] ?? 0);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(scrollableAtJump).toBeGreaterThanOrEqual(500 - readingTop);
    } finally {
      scrollIntoView.mockImplementation(() => undefined);
      scrollHeight.mockRestore();
      Element.prototype.getBoundingClientRect = realRect;
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: realHeight });
    }
  });

  // Codex review 2026-10-15: at the very end, a taller window clamped the page before the room grew, and the last verse slid down.
  it('keeps a reader at the very end of the book at the end when the window grows taller', async () => {
    const realHeight = window.innerHeight;
    const scrollHeight = jest.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(5000);
    try {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 963 });
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Четвёртая глава');
      Object.defineProperty(window, 'scrollY', { value: 5000 - 963, configurable: true });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      // The window grows; the browser has already clamped the page to its new end.
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1163 });
      Object.defineProperty(window, 'scrollY', { value: 5000 - 1163, configurable: true });
      jest.mocked(window.scrollTo).mockClear();
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(window.scrollTo).toHaveBeenCalledWith({ top: document.documentElement.scrollHeight - 1163 });

      // Read in the middle, a resize leaves the page where it is.
      Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      jest.mocked(window.scrollTo).mockClear();
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(window.scrollTo).not.toHaveBeenCalled();
    } finally {
      scrollHeight.mockRestore();
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: realHeight });
    }
  });

  it('lights nothing when the entry comes back to where it was read: Back is not a new arrival', async () => {
    window.history.replaceState({ bibleEntry: 'entry-back' }, '');
    saveEntryPlace('entry-back', { chapter: 1, verse: 2, bible: 'rst' });
    const { container } = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 1 }} passageEnd={2} onOpenBook={jest.fn()} />);
    await screen.findByText('Итак прежде всего');
    expect(container.querySelector('[data-arrival]')).toBeNull();
  });

  it('offers the way back to the screen a reference was tapped on', async () => {
    const push = jest.fn();
    // The module object itself: a wildcard import is a copy, and a spy on it never reaches the reader.
    const navigation = jest.requireMock<{ useRouter: () => unknown }>('next/navigation');
    const useRouter = jest.spyOn(navigation, 'useRouter').mockReturnValue({ push });
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} cameFrom="/studies/n1" onOpenBook={jest.fn()} />);
      await screen.findByText('Итак прежде всего');
      await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
      expect(push).toHaveBeenCalledWith('/studies/n1');
    } finally {
      useRouter.mockRestore();
    }
  });

  it('leaves room under the book for its last verse to come to the reading top, and no more', () => {
    // The last verse 4 863 px down the page, the reading top at 137 px, a window 963 px high.
    expect(roomBelow(4863, 137, 963, 5000)).toBe(690);
    // With that room the page scrolls to 4 726, and 4 726 + 137 is the last verse's top, a pixel over.
    expect(5000 + 690 - 963 + 137).toBe(4863 + 1);
    // A page already long enough under the last verse gets nothing.
    expect(roomBelow(1000, 137, 963, 3000)).toBe(0);
  });

  it('ignores a verse the book does not have and opens at the start', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 999, verse: 999 }} onOpenBook={jest.fn()} />);
    await screen.findByText('Итак прежде всего');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
    expect(screen.getByRole('button', { current: true })).toHaveTextContent('1');
  });

  it('lands where this history entry was read, before the link\'s verse — Back returns to the place', async () => {
    window.history.replaceState({ bibleEntry: 'entry-1' }, '');
    saveEntryPlace('entry-1', { chapter: 3, verse: 1, bible: 'rst' });
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 2, verse: 1 }} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
    window.history.replaceState(null, '');
  });

  it('says when the text cannot be opened, and tries again on request', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('bible.loadError');
    await userEvent.click(screen.getByRole('button', { name: 'bible.retry' }));
    expect(await screen.findByText('Павел, Апостол')).toBeInTheDocument();
  });

  it('keeps the place when the person opens another book from the middle of this one, and carries it as the way back', async () => {
    const order = ['1:1', '1:2', '2:1', '3:1', '4:1'];
    let topRow = '3:1';
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const verse = this.dataset?.verse;
      if (!verse) return realRect.call(this);
      // The row of topRow starts exactly at the reading top (16 px: no nav in the test page).
      const top = 16 + (order.indexOf(verse) - order.indexOf(topRow)) * 40;
      return { top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    window.history.replaceState({ bibleEntry: 'entry-2' }, '');
    const onOpenBook = jest.fn(() => {
      // What opening another book does next: the page goes to the top, and a scroll event follows.
      topRow = '1:1';
      window.dispatchEvent(new Event('scroll'));
    });
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      window.dispatchEvent(new Event('scroll'));
      // The book's button is in the line at the top: no scrolling up to reach it.
      await openBooks();
      await hold(screen.getByRole('button', { name: 'Jude' }));
      expect(onOpenBook).toHaveBeenCalledWith('jude', { chapter: 1, verse: 1 }, { slug: 'ruth', chapter: 3, verse: 1, bible: 'rst' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(JSON.parse(window.sessionStorage.getItem('bible:entry:entry-2') ?? 'null')).toEqual({ chapter: 3, verse: 1, bible: 'rst' });
      expect(JSON.parse(window.localStorage.getItem('bible:last-place') ?? 'null')).toEqual({ slug: 'ruth', chapter: 3, verse: 1, bible: 'rst' });
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
      window.history.replaceState(null, '');
    }
  });

  // The owner, 2026-10-20: the way back goes left along the trail of places — a swap between the last two
  // places never reached the third.
  it('offers the way back to the trail\'s link before this book, opens that book at its place and lights the link', async () => {
    arriveOnTrail({ book: 'Romans', chapter: 5, verse: 9, bible: 'rst' });
    const onOpenBook = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
    await screen.findByText('Третья глава');
    expect(readPlaceTrail()).toEqual(expect.objectContaining({ at: 1 }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
    expect(onOpenBook).toHaveBeenCalledWith('romans', { chapter: 5, verse: 9 }, expect.objectContaining({ slug: 'ruth' }));
    expect(readPlaceTrail().at).toBe(0);
    expect(readPlaceTrail().links).toHaveLength(2);
  });

  it('offers no way back to a book opened from the list', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    expect(screen.queryByRole('button', { name: 'bible.backToLabel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'bible.allBooks' })).not.toBeInTheDocument();
  });

  it('on a computer keeps the book and the chapter in a line above the text, which scrolls in its own pane beside the minimap', async () => {
    // A page coasting under the finger took a finger put on the minimap nested in it (iPad): the
    // page stands still, and the text and the minimap are sibling panes.
    screenWidth = 1024;
    const { container } = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    const line = screen.getByRole('heading', { level: 1, name: 'Ruth' }).closest('header');
    expect(line).not.toHaveClass('sticky');
    expect(within(line as HTMLElement).getByRole('button', { name: 'bible.changeChapter' })).toBeInTheDocument();
    expect(within(line as HTMLElement).getByRole('button', { name: 'bible.changeTranslation' })).toBeInTheDocument();
    expect(container.querySelector('[data-reader-panes]')).toContainElement(line as HTMLElement);
    const pane = screen.getByText('Третья глава').closest('article')?.parentElement as HTMLElement;
    expect(pane).toHaveClass('overflow-y-auto');
    expect(pane.contains(screen.getByTestId('bible-minimap'))).toBe(false);
    expect(pane.parentElement).toContainElement(screen.getByTestId('bible-minimap'));
  });

  it('on a phone reads with the page itself, no pane of its own', async () => {
    const { container } = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    expect(container.querySelector('[data-reader-panes]')).toBeNull();
    expect(screen.getByText('Третья глава').closest('article')?.parentElement).not.toHaveClass('overflow-y-auto');
  });

  it('leads on at the end of the book in the Synodal order, and back to the book before', async () => {
    const onOpenBook = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
    await screen.findByText('Третья глава');
    expect(screen.getByText('bible.endOfBook')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.nextBook' }));
    expect(onOpenBook).toHaveBeenLastCalledWith('1-samuel', { chapter: 1, verse: 1 }, expect.objectContaining({ slug: 'ruth' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.previousBook' }));
    expect(onOpenBook).toHaveBeenLastCalledWith('judges', { chapter: 1, verse: 1 }, expect.objectContaining({ slug: 'ruth' }));
  });

  it('goes to a reference typed in the book window: another book by a new entry, its own by a jump', async () => {
    const onOpenBook = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
    await screen.findByText('Третья глава');
    await openBooks();
    const line = screen.getByRole('combobox');
    // A chapter the book does not have is said, with the way to fix it, and opens nothing.
    await userEvent.type(line, 'Ин 30{Enter}');
    expect(await screen.findByText('bible.search.badChapterTitle')).toBeInTheDocument();
    expect(onOpenBook).not.toHaveBeenCalled();
    await userEvent.clear(line);
    await userEvent.type(line, 'Пс 22{Enter}');
    expect(onOpenBook).toHaveBeenCalledWith('psalms', { chapter: 22, verse: 1 }, expect.objectContaining({ slug: 'ruth' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    scrollIntoView.mockClear();
    await openBooks();
    await userEvent.type(screen.getByRole('combobox'), 'Руф 3{Enter}');
    expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
    expect(onOpenBook).toHaveBeenCalledTimes(1);
  });

  it('has a search of its own in the book\'s line: it opens empty, and «3» there opens a chapter of this book', async () => {
    const onOpenBook = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
    await screen.findByText('Третья глава');
    // The owner, 2026-10-23: «кнопку поиска нужно, когда книгу читаешь, чтобы было видно».
    await userEvent.click(screen.getAllByRole('button', { name: 'bible.search.openSearch' })[0]);
    const line = screen.getByRole('combobox');
    expect(line).toHaveValue('');
    scrollIntoView.mockClear();
    await userEvent.type(line, '3{Enter}');
    expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenBook).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the search window: the reader\'s buttons behind it are out of reach (Codex review, 2026-10-23)', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    await userEvent.click(screen.getAllByRole('button', { name: 'bible.search.openSearch' })[0]);
    const dialog = screen.getByRole('dialog');
    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // The window opens on «Как искать» (nothing searched yet): one Escape closes it, not only the help.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the phone text card keeps the existing translation picker usable', async () => {
    const onChangeBible = jest.fn();
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={onChangeBible} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Text size' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
    const choices = screen.getByRole('dialog', { name: 'bible.chooseTranslation' });
    await userEvent.click(within(choices).getByText('bible.translations.kjv.name'));
    expect(onChangeBible).toHaveBeenCalledWith('kjv');
  });

  describe('another Bible', () => {
    // The King James Psalter: 150 psalms of their own lengths, the reader's check of a book file.
    const kjvPsalms = { id: 'Psalms', chapters: Array.from({ length: 150 }, (_, index) => Array.from({ length: verseCount('kjv', 'Psalms', index + 1) }, (__, verse) => `¶Psalm ${index + 1}:${verse + 1}`)) };
    const servePsalms = () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => kjvPsalms, clone() { return this; } })) as unknown as typeof fetch;
    };

    it('is chosen at the right edge of the wide line, and the page is asked to read the same place in it', async () => {
      screenWidth = 768;
      const onChangeBible = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={onChangeBible} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeTranslation' }));
      const choices = screen.getByRole('dialog', { name: 'bible.chooseTranslation' });
      expect(within(choices).getByRole('button', { current: true })).toHaveTextContent('bible.translations.rst.name');
      await userEvent.click(within(choices).getByText('bible.translations.kjv.name'));
      expect(onChangeBible).toHaveBeenCalledWith('kjv');
    });

    it('opens the place this entry was read in the Synodal at the same psalm of the King James', async () => {
      servePsalms();
      window.history.replaceState({ bibleEntry: 'entry-ps' }, '');
      // Psalm 22 of the Synodal is Psalm 23 of the King James: "The LORD is my shepherd".
      saveEntryPlace('entry-ps', { chapter: 22, verse: 1, bible: 'rst' });
      render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Psalm 23:1');
      expect(global.fetch).toHaveBeenCalledWith('/bible-text/kjv/v1/psalms.json', expect.anything());
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="23"]')]);
      expect(document.querySelector('[data-verse="23:1"] [data-verse-text]')).toHaveAttribute('lang', 'en');
      window.history.replaceState(null, '');
    });

    // Codex review, 2026-10-27 (two rounds): the reader opened again for a change of translation put the place read on
    // the trail; the change is said by the reader that asks for it, never guessed from a place's stored Bible.
    it('the same place opened for a change of translation adds nothing to the trail', async () => {
      servePsalms();
      window.history.replaceState({ bibleEntry: 'entry-switch' }, '');
      saveEntryPlace('entry-switch', { chapter: 22, verse: 5, bible: 'rst' });
      arriveOnTrail({ book: 'Psalms', chapter: 22, verse: 1, bible: 'rst' });
      changeTranslationOnTrail('Psalms');
      render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Psalm 23:4');
      expect(readPlaceTrail().links).toEqual([{ book: 'Psalms', chapter: 22, verse: 1, bible: 'rst' }]);
      window.history.replaceState(null, '');
    });

    it('Back to a place read in another Bible, with no change of translation, is an arrival', async () => {
      servePsalms();
      window.history.replaceState({ bibleEntry: 'entry-back' }, '');
      saveEntryPlace('entry-back', { chapter: 22, verse: 5, bible: 'rst' });
      arriveOnTrail({ book: 'Psalms', chapter: 22, verse: 1, bible: 'rst' });
      render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Psalm 23:4');
      expect(readPlaceTrail()).toEqual({ links: [{ book: 'Psalms', chapter: 22, verse: 1, bible: 'rst' }, { book: 'Psalms', chapter: 23, verse: 5, bible: 'kjv' }], at: 1 });
      window.history.replaceState(null, '');
    });

    it('keeps the place as it was read in the other Bible while the person stays where it opened, so switching back finds the very verse', async () => {
      servePsalms();
      let topRow = '51:1';
      const realRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
        const verse = this.dataset?.verse;
        if (!verse) return realRect.call(this);
        const order = Array.from(document.querySelectorAll<HTMLElement>('[data-verse]')).map((row) => row.dataset.verse);
        const top = 16 + (order.indexOf(verse) - order.indexOf(topRow)) * 40;
        return { top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      };
      window.history.replaceState({ bibleEntry: 'entry-switch' }, '');
      // "Have mercy upon me, O God" is 50:3 of the Synodal, after a title of two verses; the King
      // James keeps the title within 51:1, which holds all three — and leads back to the first.
      saveEntryPlace('entry-switch', { chapter: 50, verse: 3, bible: 'rst' });
      const entry = () => JSON.parse(window.sessionStorage.getItem('bible:entry:entry-switch') ?? 'null');
      try {
        render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={null} onOpenBook={jest.fn()} />);
        await screen.findByText('Psalm 51:1');
        window.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(entry()).toEqual({ chapter: 50, verse: 3, bible: 'rst' });
        // "Continue" on the list keeps it too.
        expect(JSON.parse(window.localStorage.getItem('bible:last-place') ?? 'null')).toEqual({ slug: 'psalms', chapter: 50, verse: 3, bible: 'rst' });

        Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
        topRow = '51:4';
        window.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(entry()).toEqual({ chapter: 51, verse: 4, bible: 'kjv' });
        expect(JSON.parse(window.localStorage.getItem('bible:last-place') ?? 'null')).toEqual({ slug: 'psalms', chapter: 51, verse: 4, bible: 'kjv' });
      } finally {
        Element.prototype.getBoundingClientRect = realRect;
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
        window.history.replaceState(null, '');
      }
    });

    it('opens a link numbered in another Bible at its place in this one', async () => {
      servePsalms();
      render(<BibleBookReader bible="kjv" initialBible="rst" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={{ chapter: 50, verse: 12 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Psalm 51:10');
      // "A clean heart": Synodal 50:12 is King James 51:10.
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-verse="51:10"]')]);
    });

    it('keeps a link numbered in another Bible as it named the place, so that Bible opens the very verse', async () => {
      servePsalms();
      window.history.replaceState({ bibleEntry: 'entry-link' }, '');
      try {
        // Synodal 50:3 is in King James 51:1, which holds the title too: back in the Synodal, 50:1.
        render(<BibleBookReader bible="kjv" initialBible="rst" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={{ chapter: 50, verse: 3 }} onOpenBook={jest.fn()} />);
        await screen.findByText('Psalm 51:1');
        expect(JSON.parse(window.sessionStorage.getItem('bible:entry:entry-link') ?? 'null')).toEqual({ chapter: 50, verse: 3, bible: 'rst' });
      } finally {
        window.history.replaceState(null, '');
      }
    });
  });

  // A link opened on a phone landed hundreds to thousands of pixels above its verse: the links' chips and
  // a late font arrive after the jump and grow the text above it, and Safari before 27 does not keep the
  // verse in place (2026-10-16, measured). Until the person scrolls, the verse jumped to is kept at the top.
  describe('the verse a jump came to, while the text above it grows', () => {
    let fire: () => void = () => undefined;
    beforeEach(() => {
      const callbacks = new Set<() => void>();
      fire = () => callbacks.forEach((callback) => callback());
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        constructor(private callback: () => void) { callbacks.add(() => this.callback()); }
        observe() { return undefined; }
        disconnect() { return undefined; }
      };
    });
    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      document.documentElement.style.overflowAnchor = '';
    });

    // BUG-20261020-ipad-arrival-place-verse-early, traced live on an iPad-wide screen: the chips arriving
    // on the verses above grew the text, the browser kept what it showed by scrolling the page itself
    // (scroll anchoring), and that scroll was taken for the person's — the place was let go a verse early
    // before the jump could be made again. While the verse holds, the browser does not move the page; the
    // person's scroll gives it back.
    it('keeps the browser from moving the page while the verse holds, and gives that back once the person scrolls', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 3, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      expect(document.documentElement.style.overflowAnchor).toBe('none');
      Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      expect(document.documentElement.style.overflowAnchor).toBe('');
    });

    it('is jumped to again until the person scrolls, and then left where the person put it', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 3, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      const target = document.querySelector('[data-chapter="3"]');
      expect(scrollIntoView.mock.contexts).toEqual([target]);
      // The chips arrive: the text above grows.
      act(() => { fire(); });
      expect(scrollIntoView.mock.contexts).toEqual([target, target]);
      // The person scrolls; what grows after that moves nothing back.
      Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      scrollIntoView.mockClear();
      act(() => { fire(); });
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    // BUG-20261016-bible-deeplink-lands-early-verse, traced live 2026-10-17: a link to Synodal Ps 22:1 read
    // in the King James stood at 23:1; the chapters drawn above it moved the page by the window's own
    // correction, which missed by four verses, and the move was taken for the person's scroll — the place
    // was let go at 22:27. A move of the window's while the verse holds is not the person's.
    it('is jumped to again when the chapters drawn around it moved the page, and let go once the person scrolls', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 3, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      const target = document.querySelector('[data-chapter="3"]');
      scrollIntoView.mockClear();
      // The window drew chapters above and moved the page by 120 to keep what was on the line.
      Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
      act(() => { mockWindowOptions?.onDrawn?.(120); });
      expect(scrollIntoView.mock.contexts).toEqual([target]);
      // Its own scroll event comes after: the verse still holds, nothing is let go.
      act(() => { window.dispatchEvent(new Event('scroll')); });
      act(() => { fire(); });
      expect(scrollIntoView.mock.contexts).toEqual([target, target]);
      // The person scrolls: from here the window's moves bring nothing back.
      Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      scrollIntoView.mockClear();
      act(() => { mockWindowOptions?.onDrawn?.(80); });
      act(() => { fire(); });
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    // Codex, 2026-10-17: the person scrolled, and the window's rest came before the scroll's own event.
    // Taking the whole distance for the window's undid the person's scroll.
    it('is let go, not jumped to, when the person scrolled before the window moved the page', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 3, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      scrollIntoView.mockClear();
      // The person scrolled by 300; before its event the window moved the page by 40 more.
      Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
      act(() => { mockWindowOptions?.onDrawn?.(40); });
      act(() => { fire(); });
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  // The owner's iPad, 2026-10-16: a new text size or a turn of the iPad restyled every element of the
  // Psalter. A big book is drawn around the place read; the other chapters stand as boxes.
  describe('a big book', () => {
    const kjvPsalms = { id: 'Psalms', chapters: Array.from({ length: 150 }, (_, index) => Array.from({ length: verseCount('kjv', 'Psalms', index + 1) }, (__, verse) => `¶Psalm ${index + 1}:${verse + 1}`)) };
    const servePsalms = () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => kjvPsalms, clone() { return this; } })) as unknown as typeof fetch;
    };

    it('draws only the psalms around the place read; the others stand as boxes with their heading', async () => {
      servePsalms();
      render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={{ chapter: 100, verse: 3 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Psalm 100:3');
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-verse="100:3"]')]);
      expect(document.querySelector('[data-verse="1:1"]')).toBeNull();
      expect(document.querySelector('[data-verse="150:1"]')).toBeNull();
      expect(document.querySelector('section[data-chapter="1"]')).toHaveAttribute('data-box');
      expect(document.querySelector('section[data-chapter="100"]')).not.toHaveAttribute('data-box');
      // Every psalm keeps its place in the book, a box or drawn.
      expect(document.querySelectorAll('section[data-chapter]')).toHaveLength(150);
      expect(document.querySelectorAll('[data-verse]').length).toBeLessThan(250);
    });

    it('draws a psalm far from the place before it jumps there', async () => {
      servePsalms();
      render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={{ chapter: 100, verse: 1 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Psalm 100:1');
      scrollIntoView.mockClear();
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      await hold(tile(screen.getByRole('dialog', { name: 'bible.chooseChapter' }), '3'));
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
      expect(document.querySelector('section[data-chapter="3"]')).not.toHaveAttribute('data-box');
      expect(screen.getByText('Psalm 3:1')).toBeInTheDocument();
      expect(document.querySelector('[data-verse="100:1"]')).toBeNull();
    });

    it('lights the passage a link named in a psalm far from the start', async () => {
      servePsalms();
      window.history.replaceState({ bibleEntry: 'entry-lit' }, '');
      try {
        render(<BibleBookReader bible="kjv" initialBible="kjv" onChangeBible={jest.fn()} bookId="Psalms" initialPlace={{ chapter: 120, verse: 2 }} passageEnd={3} onOpenBook={jest.fn()} />);
        await screen.findByText('Psalm 120:2');
        expect(document.querySelector('[data-verse="120:2"]')).toHaveAttribute('data-arrival', 'on');
        expect(document.querySelector('[data-verse="120:3"]')).toHaveAttribute('data-arrival', 'on');
        // The psalm leaves the page and comes back within the light's time: lit as it was (Codex, 2026-10-16).
        await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
        await hold(tile(screen.getByRole('dialog', { name: 'bible.chooseChapter' }), '3'));
        expect(document.querySelector('[data-verse="120:2"]')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
        await hold(tile(screen.getByRole('dialog', { name: 'bible.chooseChapter' }), '120'));
        expect(document.querySelector('[data-verse="120:2"]')).toHaveAttribute('data-arrival', 'on');
      } finally {
        window.history.replaceState(null, '');
      }
    });
  });

  describe('choosing a chapter and a book in a window', () => {
    // The owner, 2026-10-23: a press goes one step on — book, chapter, verse — and a hold opens at once.
    it('shows every chapter ten to a row; a chapter pressed shows its verses, and a verse pressed jumps there lit and closes', async () => {
      const { container } = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      const chapters = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(within(chapters).getByRole('button', { current: true })).toHaveTextContent('1');
      expect(within(chapters).getByRole('button', { name: 'bible.chapter', current: true }).parentElement).toHaveClass('grid-cols-10');

      await userEvent.click(tile(chapters, '3'));
      const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
      expect(within(verses).getAllByRole('button', { name: 'bible.verseNumber' })).toHaveLength(verseCount('rst', 'Ruth', 3));
      expect(within(verses).getByText('bible.verseCount')).toBeInTheDocument();
      scrollIntoView.mockClear();
      await userEvent.click(tile(verses, '1'));
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
      expect(container.querySelector('[data-verse="3:1"]')).toHaveAttribute('data-arrival', 'on');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens a chapter held half a second at its start, unlit, and closes', async () => {
      const { container } = render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      scrollIntoView.mockClear();
      await hold(tile(screen.getByRole('dialog'), '3'));
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
      expect(container.querySelector('[data-arrival]')).toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('fills the verse being read among its chapter\'s verses, and goes back to the chapters', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 1, verse: 2 }} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      await userEvent.click(tile(screen.getByRole('dialog'), '1'));
      const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
      expect(within(verses).getByRole('button', { current: true })).toHaveTextContent('2');
      expect(within(verses).getByRole('button', { current: true })).toHaveFocus();
      await userEvent.click(within(verses).getByRole('button', { name: 'bible.chaptersBack' }));
      expect(screen.getByRole('dialog', { name: 'bible.chooseChapter' })).toBeInTheDocument();
    });

    it('goes on to the verses from the keyboard too: nothing is reached by a hold alone', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      // The window gives the focus to the chapter being read; Enter is its press.
      expect(within(screen.getByRole('dialog')).getByRole('button', { current: true })).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('dialog', { name: 'bible.chooseVerse' })).toBeInTheDocument();
      scrollIntoView.mockClear();
      await userEvent.keyboard('{Enter}');
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="1"]')]);
    });

    it('closes on Escape without choosing', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens another book at the chapter held in the book window, or at the verse pressed there, lit', async () => {
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await openBooks();
      const books = screen.getByRole('dialog', { name: 'bible.chooseBook' });
      expect(within(books).getByRole('button', { current: true })).toHaveTextContent('Ruth');
      expect(within(books).getByText('bible.holdBookHint')).toBeInTheDocument();

      await userEvent.click(within(books).getByRole('button', { name: 'Psalms' }));
      const psalms = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(within(psalms).getAllByRole('button', { name: 'bible.psalm' })).toHaveLength(150);
      await hold(tile(psalms, '23'));
      expect(onOpenBook).toHaveBeenLastCalledWith('psalms', { chapter: 23, verse: 1 }, { slug: 'ruth', chapter: 1, verse: 1, bible: 'rst' });

      await openBooks();
      await userEvent.click(screen.getByRole('button', { name: 'Psalms' }));
      await userEvent.click(tile(screen.getByRole('dialog'), '22'));
      const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
      expect(within(verses).getByRole('button', { name: 'bible.psalmsBack' })).toBeInTheDocument();
      await userEvent.click(tile(verses, '2'));
      expect(onOpenBook).toHaveBeenLastCalledWith('psalms', { chapter: 22, verse: 2, toVerse: 2 }, { slug: 'ruth', chapter: 1, verse: 1, bible: 'rst' });
    });

    it('shows a book of one chapter at its verses, goes back to the books from there, and opens it when held', async () => {
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await openBooks();
      await userEvent.click(screen.getByRole('button', { name: 'Jude' }));
      const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
      expect(within(verses).getAllByRole('button', { name: 'bible.verseNumber' })).toHaveLength(verseCount('rst', 'Jude', 1));
      expect(onOpenBook).not.toHaveBeenCalled();

      await userEvent.click(within(verses).getByRole('button', { name: 'bible.allBooks' }));
      expect(screen.getByRole('dialog', { name: 'bible.chooseBook' })).toBeInTheDocument();
      await hold(screen.getByRole('button', { name: 'Jude' }));
      expect(onOpenBook).toHaveBeenCalledWith('jude', { chapter: 1, verse: 1 }, { slug: 'ruth', chapter: 1, verse: 1, bible: 'rst' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('moves inside the open book without a new history entry when its own chapter is held in the book window', async () => {
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await openBooks();
      await userEvent.click(screen.getByRole('button', { name: 'Ruth' }));
      scrollIntoView.mockClear();
      await hold(tile(screen.getByRole('dialog'), '2'));
      expect(onOpenBook).not.toHaveBeenCalled();
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="2"]')]);
    });

    it('offers no chapter window for a book of one chapter', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'Jude', chapters: [['¶Иуда, раб Иисуса Христа']] }), clone() { return this; } })) as unknown as typeof fetch;
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Jude" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Иуда, раб Иисуса Христа');
      expect(screen.queryByRole('button', { name: 'bible.changeChapter' })).not.toBeInTheDocument();
      // No button, but the place still named as a reference names it.
      expect(screen.getByRole('button', { name: 'bible.navigate' })).toHaveTextContent('Jude 1');
    });

    it('opens, on a phone, the chapters of the book being read from its pill, says what a hold does, and every book from there', async () => {
      const onOpen = jest.fn();
      render(<ReadingPill bookId="Ruth" bible="rst" currentChapter={3} currentVerse={1} text={{ id: 'Ruth', chapters: book.chapters }} locale="en" onOpen={onOpen} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      const sheet = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(within(sheet).getByRole('button', { current: true })).toHaveTextContent('3');
      expect(within(sheet).getByText('bible.holdChapterHint')).toBeInTheDocument();
      // A phone: no keyboard over the chapters until the line is tapped.
      expect(within(sheet).getByRole('combobox')).not.toHaveFocus();
      await hold(tile(sheet, '2'));
      expect(onOpen).toHaveBeenCalledWith('Ruth', { chapter: 2, verse: 1 });
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      await userEvent.click(tile(screen.getByRole('dialog'), '4'));
      expect(screen.getByRole('dialog', { name: 'bible.chooseVerse' })).toBeInTheDocument();
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'bible.chaptersBack' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'bible.allBooks' }));
      expect(screen.getByRole('dialog', { name: 'bible.chooseBook' })).toBeInTheDocument();
    });

    it('opens, on a phone, a book of one chapter at its verses from the pill', async () => {
      render(<ReadingPill bookId="Jude" bible="rst" currentChapter={1} currentVerse={3} text={{ id: 'Jude', chapters: [['¶Иуда, раб Иисуса Христа']] }} locale="en" onOpen={jest.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      const verses = screen.getByRole('dialog', { name: 'bible.chooseVerse' });
      expect(within(verses).getByRole('button', { current: true })).toHaveTextContent('3');
      expect(within(verses).getByRole('button', { name: 'bible.allBooks' })).toBeInTheDocument();
    });

    it('places a computer window under its button as the button stood before the page was held still', async () => {
      // Holding the page makes the body a scroll box, and a button in a sticky line drops back to
      // the top of the book — 5 000 px above the screen. The window must not follow it there.
      const realRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.getAttribute('aria-haspopup') !== 'dialog') return realRect.call(this);
        const top = document.body.style.overflow === 'hidden' ? -5000 : 70;
        return { top, bottom: top + 44, left: 300, right: 420, width: 120, height: 44, x: 300, y: top, toJSON: () => ({}) } as DOMRect;
      };
      try {
        render(<ChapterPicker bookId="Ruth" bible="rst" current={1} verse={1} text={{ id: 'Ruth', chapters: book.chapters }} locale="en" wide onOpen={jest.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
        expect(screen.getByRole('dialog')).toHaveStyle({ top: '122px' });
      } finally {
        Element.prototype.getBoundingClientRect = realRect;
      }
    });

    it('tells a finger on a wide screen (an iPad) nothing about pointing at a verse', async () => {
      // `matchMedia` answers no to every query here: wide by the prop, and no hover — an iPad.
      render(<ChapterPicker bookId="Ruth" bible="rst" current={1} verse={1} text={{ id: 'Ruth', chapters: book.chapters }} locale="en" wide onOpen={jest.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
      await userEvent.click(tile(screen.getByRole('dialog'), '1'));
      expect(screen.getByRole('dialog', { name: 'bible.chooseVerse' })).toBeInTheDocument();
      expect(screen.queryByText('bible.verseHint')).not.toBeInTheDocument();
    });

    it('opens a computer window above its button when there is no room under it', async () => {
      const realRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.getAttribute('aria-haspopup') !== 'dialog') return realRect.call(this);
        const top = window.innerHeight - 68;
        return { top, bottom: top + 44, left: 300, right: 390, width: 90, height: 44, x: 300, y: top, toJSON: () => ({}) } as DOMRect;
      };
      try {
        render(<ChapterPicker bookId="Romans" bible="rst" current={8} verse={1} text={null} locale="en" wide onOpen={jest.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
        // 68 px from the bottom: the window stands on the button's top edge, as high as the room above it.
        expect(screen.getByRole('dialog')).toHaveStyle({ bottom: '76px', maxHeight: `${window.innerHeight - 68 - 8 - 16}px` });
        expect(screen.getByRole('dialog').style.top).toBe('');
      } finally {
        Element.prototype.getBoundingClientRect = realRect;
      }
    });

    it('keeps a window of ten numbers a row inside the screen when its button stands far right (an iPad with the trail in the line)', async () => {
      const realRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.getAttribute('aria-haspopup') !== 'dialog') return realRect.call(this);
        return { top: 70, bottom: 114, left: 700, right: 790, width: 90, height: 44, x: 700, y: 70, toJSON: () => ({}) } as DOMRect;
      };
      try {
        render(<ChapterPicker bookId="Romans" bible="rst" current={8} verse={1} text={null} locale="en" wide onOpen={jest.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
        await userEvent.click(tile(screen.getByRole('dialog'), '6'));
        // Ten verses a row: the window is that wide, and its right edge stays 16 px inside the screen.
        expect(screen.getByRole('dialog')).toHaveStyle({ width: '536px', left: `${window.innerWidth - 16 - 536}px` });
      } finally {
        Element.prototype.getBoundingClientRect = realRect;
      }
    });

    it('sizes a computer window of numbers by its row in the page\'s own font: a short book stays compact, a larger font keeps ten whole', async () => {
      const { unmount } = render(<ChapterPicker bookId="Ruth" bible="rst" current={1} verse={1} text={{ id: 'Ruth', chapters: book.chapters }} locale="en" wide onOpen={jest.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
      // Four chapters: no wider than the line under them needs.
      expect(screen.getByRole('dialog')).toHaveStyle({ width: '380px' });
      unmount();

      document.documentElement.style.fontSize = '20px';
      try {
        render(<ChapterPicker bookId="Romans" bible="rst" current={8} verse={1} text={null} locale="en" wide onOpen={jest.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
        // (10 × 2.75 + 9 × 0.375 + 2 × 1.25) rem at 20 px, and the border: 669.5 → 670.
        expect(screen.getByRole('dialog')).toHaveStyle({ width: '670px' });
      } finally {
        document.documentElement.style.fontSize = '';
      }
    });

    it('says on a computer how the chapter under the pointer begins, what a hold does, and what the verse under it says', async () => {
      screenWidth = 1024;
      const text = { id: 'Ruth', chapters: book.chapters };
      render(<ChapterPicker bookId="Ruth" bible="rst" current={1} verse={1} text={text} locale="en" wide onOpen={jest.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
      // Four chapters make a row of four on a computer, not a row of ten with six empty places.
      expect(tile(screen.getByRole('dialog'), '1').parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(4, 2.75rem)' });
      expect(screen.getByText('bible.holdChapterHint')).toBeInTheDocument();
      await userEvent.hover(tile(screen.getByRole('dialog'), '2'));
      expect(screen.getByText('bible.chapterStartsWith')).toBeInTheDocument();

      await userEvent.click(tile(screen.getByRole('dialog'), '1'));
      expect(screen.getByText('bible.verseHint')).toBeInTheDocument();
      await userEvent.hover(tile(screen.getByRole('dialog'), '2'));
      expect(screen.getByText('bible.verseLine')).toBeInTheDocument();
    });
  });
});
