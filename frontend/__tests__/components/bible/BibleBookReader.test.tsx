import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { ChapterPicker, ReadingPill } from '@/components/bible/BiblePicker';
import { saveEntryPlace } from '@/components/bible/lastPlace';
import { verseCount } from '@/utils/versification';

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

const scrollIntoView = jest.fn();
/** A computer (768 px and wider) or a phone: what `matchMedia` answers the reader. */
let wideScreen = false;

beforeEach(() => {
  wideScreen = false;
  window.matchMedia = jest.fn((query: string) => ({
    matches: wideScreen, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  // Every test starts on a fresh history entry: a place saved by one must not open the next.
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  window.localStorage.clear();
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
    expect(screen.getByRole('heading', { level: 1, name: 'Ruth' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'bible.chapter' })).toHaveLength(4);
    expect(screen.getByText('Итак прежде всего')).toBeInTheDocument();
    expect(screen.getByText('мир')).toHaveClass('text-rose-800');
    expect(screen.getByText('вам')).toHaveClass('italic');
    await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
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

  it('ignores a verse the book does not have and opens at the start', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={{ chapter: 999, verse: 999 }} onOpenBook={jest.fn()} />);
    await screen.findByText('Итак прежде всего');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
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
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
      await userEvent.click(screen.getByRole('button', { name: 'Jude' }));
      expect(onOpenBook).toHaveBeenCalledWith('jude', { chapter: 1, verse: 1 }, { slug: 'ruth', chapter: 3, verse: 1, bible: 'rst' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(JSON.parse(window.sessionStorage.getItem('bible:entry:entry-2') ?? 'null')).toEqual({ chapter: 3, verse: 1, bible: 'rst' });
      expect(JSON.parse(window.localStorage.getItem('bible:last-place') ?? 'null')).toEqual({ slug: 'ruth', chapter: 3, verse: 1, bible: 'rst' });
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
      window.history.replaceState(null, '');
    }
  });

  it('offers the way back to the book it was opened from, and going back offers this book in turn', async () => {
    window.history.replaceState({ bibleEntry: 'entry-3', bibleFrom: { slug: 'romans', chapter: 5, verse: 9 } }, '');
    const onOpenBook = jest.fn();
    try {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.backToLabel' }));
      expect(onOpenBook).toHaveBeenCalledWith('romans', { chapter: 5, verse: 9 }, expect.objectContaining({ slug: 'ruth' }));
    } finally {
      window.history.replaceState(null, '');
    }
  });

  it('offers no way back to a book opened from the list', async () => {
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    expect(screen.queryByRole('button', { name: 'bible.backToLabel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'bible.allBooks' })).not.toBeInTheDocument();
  });

  it('keeps the book and the chapter in a line that sticks under the nav on a computer', async () => {
    wideScreen = true;
    render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
    await screen.findByText('Третья глава');
    const line = screen.getByRole('heading', { level: 1, name: 'Ruth' }).closest('header');
    expect(line).toHaveClass('sticky');
    expect(within(line as HTMLElement).getByRole('button', { name: 'bible.changeChapter' })).toBeInTheDocument();
    expect(within(line as HTMLElement).getByRole('button', { name: 'bible.changeTranslation' })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
    const line = screen.getByRole('textbox');
    await userEvent.type(line, 'Ин 30');
    expect(screen.getByText('bible.goToNotFound')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bible.goTo' })).toBeDisabled();
    await userEvent.clear(line);
    await userEvent.type(line, 'Пс 22{Enter}');
    expect(onOpenBook).toHaveBeenCalledWith('psalms', { chapter: 22, verse: 1 }, expect.objectContaining({ slug: 'ruth' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    scrollIntoView.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
    await userEvent.type(screen.getByRole('textbox'), 'Руф 3{Enter}');
    expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
    expect(onOpenBook).toHaveBeenCalledTimes(1);
  });

  describe('another Bible', () => {
    // The King James Psalter: 150 psalms of their own lengths, the reader's check of a book file.
    const kjvPsalms = { id: 'Psalms', chapters: Array.from({ length: 150 }, (_, index) => Array.from({ length: verseCount('kjv', 'Psalms', index + 1) }, (__, verse) => `¶Psalm ${index + 1}:${verse + 1}`)) };
    const servePsalms = () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => kjvPsalms, clone() { return this; } })) as unknown as typeof fetch;
    };

    it('is chosen at the right edge of the line, and the page is asked to read the same place in it', async () => {
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
      expect(document.querySelector('[data-verse="23:1"] p')).toHaveAttribute('lang', 'en');
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

  describe('choosing a chapter and a book in a window', () => {
    it('shows every chapter ten to a row, jumps to the one chosen and closes', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
      const chapters = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(within(chapters).getByRole('button', { current: true })).toHaveTextContent('1');
      expect(within(chapters).getByRole('button', { name: 'bible.chapter', current: true }).parentElement).toHaveClass('grid-cols-10');
      scrollIntoView.mockClear();

      await userEvent.click(within(chapters).getByText('3'));
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="3"]')]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on Escape without choosing', async () => {
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens another book at the chapter chosen in the book window', async () => {
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
      const books = screen.getByRole('dialog', { name: 'bible.chooseBook' });
      expect(within(books).getByRole('button', { current: true })).toHaveTextContent('Ruth');

      await userEvent.click(within(books).getByRole('button', { name: 'Psalms' }));
      const psalms = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(within(psalms).getAllByRole('button', { name: 'bible.psalm' })).toHaveLength(150);
      await userEvent.click(within(psalms).getByText('23'));
      expect(onOpenBook).toHaveBeenCalledWith('psalms', { chapter: 23, verse: 1 }, { slug: 'ruth', chapter: 1, verse: 1, bible: 'rst' });
    });

    it('opens a book of one chapter at once, and goes back to the books from a book\'s chapters', async () => {
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
      await userEvent.click(screen.getByRole('button', { name: 'Genesis' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'bible.allBooks' }));
      await userEvent.click(screen.getByRole('button', { name: 'Jude' }));
      expect(onOpenBook).toHaveBeenCalledWith('jude', { chapter: 1, verse: 1 }, { slug: 'ruth', chapter: 1, verse: 1, bible: 'rst' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('moves inside the open book without a new history entry when its own chapter is chosen in the book window', async () => {
      const onOpenBook = jest.fn();
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Ruth" initialPlace={null} onOpenBook={onOpenBook} />);
      await screen.findByText('Третья глава');
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeBook' }));
      await userEvent.click(screen.getByRole('button', { name: 'Ruth' }));
      scrollIntoView.mockClear();
      await userEvent.click(within(screen.getByRole('dialog')).getByText('2'));
      expect(onOpenBook).not.toHaveBeenCalled();
      expect(scrollIntoView.mock.contexts).toEqual([document.querySelector('[data-chapter="2"]')]);
    });

    it('offers no chapter window for a book of one chapter', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'Jude', chapters: [['¶Иуда, раб Иисуса Христа']] }), clone() { return this; } })) as unknown as typeof fetch;
      render(<BibleBookReader bible="rst" initialBible="rst" onChangeBible={jest.fn()} bookId="Jude" initialPlace={null} onOpenBook={jest.fn()} />);
      await screen.findByText('Иуда, раб Иисуса Христа');
      expect(screen.queryByRole('button', { name: 'bible.changeChapter' })).not.toBeInTheDocument();
      expect(screen.getByText('bible.oneChapter')).toBeInTheDocument();
    });

    it('opens, on a phone, the chapters of the book being read from the pill at the bottom, and every book from there', async () => {
      const onOpen = jest.fn();
      render(<ReadingPill bookId="Ruth" bible="rst" currentChapter={3} text={{ id: 'Ruth', chapters: book.chapters }} locale="en" onOpen={onOpen} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      const sheet = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(within(sheet).getByRole('button', { current: true })).toHaveTextContent('3');
      // A phone: no keyboard over the chapters until the line is tapped.
      expect(within(sheet).getByRole('textbox')).not.toHaveFocus();
      await userEvent.click(within(sheet).getByText('2'));
      expect(onOpen).toHaveBeenCalledWith('Ruth', { chapter: 2, verse: 1 });
      await userEvent.click(screen.getByRole('button', { name: 'bible.navigate' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'bible.allBooks' }));
      expect(screen.getByRole('dialog', { name: 'bible.chooseBook' })).toBeInTheDocument();
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
        render(<ChapterPicker bookId="Ruth" bible="rst" bookName="Ruth" current={1} text={{ id: 'Ruth', chapters: book.chapters }} wide onPick={jest.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
        expect(screen.getByRole('dialog')).toHaveStyle({ top: '122px' });
      } finally {
        Element.prototype.getBoundingClientRect = realRect;
      }
    });

    it('says on a computer how the chapter under the pointer begins', async () => {
      const text = { id: 'Ruth', chapters: book.chapters };
      render(<ChapterPicker bookId="Ruth" bible="rst" bookName="Ruth" current={1} text={text} wide onPick={jest.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'bible.changeChapter' }));
      // Four chapters make a row of four on a computer, not a row of ten with six empty places.
      expect(within(screen.getByRole('dialog')).getByText('1').parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(4, 2.75rem)' });
      expect(screen.getByText('bible.chapterHint')).toBeInTheDocument();
      await userEvent.hover(within(screen.getByRole('dialog')).getByText('2'));
      expect(screen.getByText('bible.chapterStartsWith')).toBeInTheDocument();
    });
  });
});
