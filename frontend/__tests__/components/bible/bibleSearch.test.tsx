import fs from 'fs';
import path from 'path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleSearch } from '@/components/bible/search/BibleSearch';
import { resetLastSearchForTests } from '@/components/bible/search/lastSearch';
import { rememberSearch, resetSearchHistoryForTests } from '@/components/bible/searchHistoryStore';
import { resetSearchIndexesForTests } from '@/utils/bibleSearch/searchIndexStore';
import { bookSlug } from '@/utils/bibleText';

/*
 * The one line of the Bible (canvas v58, the owner 2026-10-23): a place opens with Enter; words are
 * found where the first words say, with the forms found and the wider places to look; «?» and the clock
 * open «Как искать» and the search history. The search runs over the real Synodal text.
 */
jest.mock('@/utils/bibleText', () => {
  const actual = jest.requireActual('@/utils/bibleText');
  const readBook = (bookId: string, bible: string) =>
    JSON.parse(jest.requireActual('fs').readFileSync(jest.requireActual('path').join(process.cwd(), 'public/bible-text', bible, 'v1', `${actual.bookSlug(bookId)}.json`), 'utf8'));
  return { ...actual, fetchBookText: jest.fn(async (bookId: string, bible: string) => readBook(bookId, bible)) };
});

// The words with what they were given: «bible.search.verses{"count":9}».
const t = (key: string, options?: Record<string, unknown>) => (options && Object.keys(options).length ? `${key}${JSON.stringify(options)}` : key);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'ru' } }) }));

beforeEach(() => {
  window.matchMedia = jest.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.localStorage.clear();
  resetSearchIndexesForTests();
  resetSearchHistoryForTests();
  resetLastSearchForTests();
});

// Many rows: the options are read from the page itself — a role query names each of a hundred rows and alone
// took seconds on the build machine (2026-10-23).
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const showMore = () => screen.getByText(/^bible\.search\.showMore/);

function renderLine(props: Partial<React.ComponentProps<typeof BibleSearch>> = {}) {
  const onOpen = jest.fn();
  render(<BibleSearch bible="rst" locale="ru" wide surface="page" onOpen={onOpen} {...props}><p>the books</p></BibleSearch>);
  return { onOpen, line: screen.getByRole('combobox') };
}

describe('the one line', () => {
  it('opens a place typed or said, with Enter', async () => {
    const { onOpen, line } = renderLine();
    await userEvent.type(line, 'Иоанна три шестнадцать{Enter}');
    expect(onOpen).toHaveBeenCalledWith({ bookId: 'John', chapter: 3, verse: 16, toVerse: 16 });
  });

  it('shows the place with its verse and «Открыть», and hides the page below while it holds words', async () => {
    const { line } = renderLine();
    expect(screen.getByText('the books')).toBeInTheDocument();
    await userEvent.type(line, 'Ин 3:16');
    expect(await screen.findByText(/так возлюбил Бог мир/)).toBeInTheDocument();
    // The place is the option itself; «Открыть ↵» on it shows what Enter does.
    expect(screen.getByRole('option', { name: /^От Иоанна 3:16/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('bible.search.open')).toBeInTheDocument();
    expect(screen.queryByText('the books')).not.toBeInTheDocument();
  });

  it('finds words where the first words say, with the forms and the wider places', async () => {
    const { line } = renderLine();
    await userEvent.type(line, 'Рим 4 вера');
    // 9 of «вера» and Rom 4:24 «верующим» — its kin, since 2026-10-27.
    expect(await screen.findByText('bible.search.verses{"count":10}')).toBeInTheDocument();
    expect(screen.getByText('bible.search.scopeChapter{"book":"К Римлянам","chapter":4}')).toBeInTheDocument();
    expect(screen.getByText('bible.search.formsFound')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(10);
    // A wider step writes its place into the line.
    await userEvent.click(screen.getByRole('button', { name: /bible\.search\.widerBook/ }));
    expect(line).toHaveValue('Рим вера');
    expect(await screen.findByText('bible.search.verses{"count":51}')).toBeInTheDocument();
  });

  // The owner, 2026-10-27: «нажал на стих — он пока что просто выделяется»; the search stays, to think over it.
  it('a verse pressed is only chosen; its own buttons copy it, with a tick, or open it in the Bible', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const { onOpen, line } = renderLine();
    await userEvent.type(line, '"хлеб жизни"');
    await screen.findByText('bible.search.verses{"count":2}');
    const [, second] = screen.getAllByRole('option');
    await userEvent.click(second);
    expect(onOpen).not.toHaveBeenCalled();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(line).toHaveValue('"хлеб жизни"');
    await userEvent.click(within(second).getByRole('button', { name: /bible\.copy\.copy/, hidden: true }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Ин 6:48: "Я есмь хлеб жизни/));
    expect(second.querySelector('[data-copied]')).not.toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(within(second).getByRole('button', { name: /bible\.search\.openInBible/, hidden: true }));
    expect(onOpen).toHaveBeenCalledWith({ bookId: 'John', chapter: 6, verse: 48, toVerse: 48 });
  });

  // Codex review, 2026-10-27: the buttons are for a mouse and a finger; the keyboard copies the chosen verse with
  // ⌘C / Ctrl+C while nothing is selected in the line, and a press keeps the line its keys in a narrow window too.
  it('copies the chosen verse from the keyboard, and a press in a narrow window keeps the line its keys', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const { line } = renderLine({ wide: false });
    await userEvent.type(line, '"хлеб жизни"');
    await screen.findByText('bible.search.verses{"count":2}');
    const [, second] = screen.getAllByRole('option');
    await userEvent.click(second);
    expect(line).toHaveFocus();
    await userEvent.keyboard('{Control>}c{/Control}');
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Ин 6:48: "/));
    expect(second.querySelector('[data-copied]')).not.toBeNull();
    // A selection in the line is the line's to copy.
    writeText.mockClear();
    (line as HTMLInputElement).setSelectionRange(1, 5);
    await userEvent.keyboard('{Control>}c{/Control}');
    expect(writeText).not.toHaveBeenCalledWith(expect.stringMatching(/^Ин /));
  });

  // Codex review, 2026-10-27: a screen reader on a touch screen reaches the chosen verse's Copy and Open outside the
  // list; an iPad's keyboard arrows light the verse they reach.
  it('gives the chosen verse its Copy and Open outside the list, and lights a verse the arrows reach on a touch screen', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse'), media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { onOpen, line } = renderLine();
      await userEvent.type(line, '"хлеб жизни"');
      await screen.findByText('bible.search.verses{"count":2}');
      const [first, second] = screen.getAllByRole('option');
      // On a touch screen the first row is chosen only for Enter: nothing is lit until a press or an arrow.
      expect(first).toHaveAttribute('aria-selected', 'false');
      await userEvent.keyboard('{ArrowDown}');
      expect(second).toHaveAttribute('aria-selected', 'true');
      const actions = screen.getByRole('group', { name: 'bible.copy.menu{"place":"Ин 6:48"}' });
      await userEvent.click(within(actions).getByRole('button', { name: 'bible.copy.copy' }));
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Ин 6:48: "/));
      await userEvent.click(within(actions).getByRole('button', { name: 'bible.search.openInBible' }));
      expect(onOpen).toHaveBeenCalledWith({ bookId: 'John', chapter: 6, verse: 48, toVerse: 48 });
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it('moves the choice with the arrows and opens it with Enter, lighting the verse', async () => {
    const { onOpen, line } = renderLine();
    await userEvent.type(line, '"хлеб жизни"');
    await screen.findByText('bible.search.verses{"count":2}');
    const [first, second] = screen.getAllByRole('option');
    expect(first).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(line).toHaveAttribute('aria-activedescendant', second.id);
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith({ bookId: 'John', chapter: 6, verse: 48, toVerse: 48 });
  });

  it('says where nothing was found, how much there is everywhere, and widens in one tap', async () => {
    const { line } = renderLine();
    await userEvent.type(line, 'Рим хлеб');
    expect(await screen.findByText('bible.search.notInBook{"book":"К Римлянам"}')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.searchBible' }));
    expect(line).toHaveValue('хлеб');
  });

  it('reads a book whose name is a word as the book, and searches the words on request', async () => {
    const { line } = renderLine();
    await userEvent.type(line, 'плач скрежет');
    await screen.findByText(/bible\.search\.wordLike/);
    await userEvent.click(screen.getByRole('button', { name: /bible\.search\.searchAsWords/ }));
    expect(await screen.findByText('bible.search.verses{"count":7}')).toBeInTheDocument();
    expect(screen.getByText('bible.search.asWords')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bible\.search\.searchInBook/ })).toBeInTheDocument();
  });

  it('clears with Escape', async () => {
    const { line } = renderLine();
    await userEvent.type(line, 'хлеб');
    await userEvent.keyboard('{Escape}');
    expect(line).toHaveValue('');
    expect(screen.getByText('the books')).toBeInTheDocument();
  });

  it('«?» opens «Как искать», and an example tapped is written into the line and searched', async () => {
    const { line } = renderLine();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.help' }));
    expect(screen.getByText('bible.search.sections.where')).toBeInTheDocument();
    // The way without typing is told where opening a verse is: a press a step, a hold at once.
    expect(screen.getByText('bible.search.byFingerNote')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.examples.rst.book' }));
    expect(line).toHaveValue('bible.search.examples.rst.book');
    expect(screen.queryByText('bible.search.sections.where')).not.toBeInTheDocument();
  });

  it('keeps a search a verse was opened from, and the clock brings it back', async () => {
    const { onOpen, line } = renderLine();
    await userEvent.type(line, 'Иоанна хлеб');
    await screen.findByText('bible.search.verses{"count":21}');
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith({ bookId: 'John', chapter: 6, verse: 5, toVerse: 5 });
    await userEvent.clear(line);
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.history' }));
    const history = screen.getByRole('region', { name: 'bible.search.history' });
    await userEvent.click(within(history).getByRole('button', { name: /^Иоанна хлеб/ }));
    expect(line).toHaveValue('Иоанна хлеб');
  });

  it('takes one search out of the history with its own named button', async () => {
    rememberSearch('пастырь мой', 'rst');
    rememberSearch('Иоанна хлеб', 'rst');
    renderLine();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.historyRemove{"line":"пастырь мой"}' }));
    expect(screen.queryByText('пастырь мой')).not.toBeInTheDocument();
    expect(screen.getByText('Иоанна хлеб')).toBeInTheDocument();
  });

  it('clears the history and offers it back once', async () => {
    rememberSearch('пастырь мой', 'rst');
    renderLine();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.historyClear' }));
    expect(screen.queryByText('пастырь мой')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.historyUndo' }));
    expect(screen.getByText('пастырь мой')).toBeInTheDocument();
  });

  it('opens empty in the reader, the searches kept under it; one of them comes back with the verses opened from it', async () => {
    const first = renderLine();
    await userEvent.type(first.line, 'Иоанна хлеб');
    await screen.findByText('bible.search.verses{"count":21}');
    await userEvent.keyboard('{Enter}');
    document.body.innerHTML = '';
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent autoFocus onOpen={jest.fn()} />);
    const line = screen.getByRole('combobox') as HTMLInputElement;
    // The owner, 2026-10-23: the window showed the last search again, even after it was cleared.
    expect(line).toHaveValue('');
    await userEvent.click(screen.getByText('Иоанна хлеб'));
    expect(line).toHaveValue('Иоанна хлеб');
    expect(await screen.findByText('bible.search.seen')).toBeInTheDocument();
  });

  it('opens «Как искать» in the reader while nothing was searched yet', () => {
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent onOpen={jest.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'bible.search.help' })).toBeInTheDocument();
  });

  // Lines are pasted, not typed, where the test is about what follows: every keystroke searches the whole
  // New Testament again, and the build machine (two cores) ran out of its 15 s on a typed one (2026-10-23).
  // The owner, 2026-10-27: a hundred at a time, not forty.
  it('shows a hundred verses, and the next hundred at a press, the arrows on the first of them', async () => {
    const { line } = renderLine();
    await userEvent.click(line);
    await userEvent.paste('НЗ благодать');
    await screen.findByText('bible.search.verses{"count":122}');
    expect(options()).toHaveLength(101);
    expect(showMore().closest('[role="option"]')).toBe(options()[100]);
    expect(screen.getByText('bible.search.shownOf{"shown":100,"count":122}')).toBeInTheDocument();
    // The rest at the press — the word's own 120 verses, then its 2 of the same stem under their line — and nothing is
    // left to press (Enter on it: `rowForEnter`, searchModel.test.ts).
    await userEvent.click(showMore());
    expect(options()).toHaveLength(122);
    expect(options()[100]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/^bible\.search\.kinHead/)).toBeInTheDocument();
    expect(screen.queryByText(/^bible\.search\.showMore/)).not.toBeInTheDocument();
    // Another line starts again from the first hundred.
    await userEvent.paste(' Христа');
    await waitFor(() => expect(options().length).toBeLessThanOrEqual(101));
  });

  // A page is a hundred now; the books are still offered past forty, as when forty were a page.
  it('offers the books of a search past forty verses, though they fit in one page: «Евангелия хлеб»', async () => {
    const { line } = renderLine();
    await userEvent.click(line);
    await userEvent.paste('Евангелия хлеб');
    await screen.findByText('bible.search.verses{"count":80}');
    expect(screen.queryByText(/^bible\.search\.showMore/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^От Матфея/ })).toBeInTheDocument();
  });

  describe('on a touch screen', () => {
    beforeEach(() => {
      window.matchMedia = jest.fn((query: string) => ({
        matches: query.includes('coarse'), media: query, onchange: null,
        addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
      })) as unknown as typeof window.matchMedia;
    });

    it('puts the signs of a search one tap away while the line is in use, without taking the focus', async () => {
      const { line } = renderLine({ wide: false });
      await userEvent.click(line);
      await userEvent.type(line, 'благодат');
      await userEvent.click(screen.getByRole('button', { name: 'bible.search.signs.star' }));
      await waitFor(() => expect(line).toHaveValue('благодат*'));
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      expect(line).toHaveFocus();
    });
  });

  it('keeps the place of a fresh line to open even when Enter comes before the rows catch up', async () => {
    const { onOpen, line } = renderLine();
    await userEvent.type(line, 'Пс 22{Enter}');
    expect(onOpen).toHaveBeenCalledWith({ bookId: 'Psalms', chapter: 22, verse: 1 });
    expect(fs.existsSync(path.join(process.cwd(), 'public/bible-text/rst/v1', `${bookSlug('Psalms')}.json`))).toBe(true);
  });
});

describe('the line under pressure (Codex review, 2026-10-23)', () => {
  it('gives the keys to the history while it is open: Enter there never opens a hidden result', async () => {
    const { onOpen, line } = renderLine();
    await userEvent.type(line, 'Иоанна хлеб');
    await screen.findByText('bible.search.verses{"count":21}');
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('clears on Escape pressed on a control of the results, and the window around it stays', async () => {
    const outside = jest.fn();
    window.addEventListener('keydown', outside);
    const { line } = renderLine();
    await userEvent.type(line, 'Иоанна хлеб');
    await screen.findByText('bible.search.verses{"count":21}');
    // A control of the results in focus, not the line.
    screen.getByRole('button', { name: /bible\.search\.widerNew/ }).focus();
    await userEvent.keyboard('{Escape}');
    expect(line).toHaveValue('');
    expect(outside).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    window.removeEventListener('keydown', outside);
  });

  it('keeps «search as words» through the history', async () => {
    const { line } = renderLine();
    await userEvent.type(line, 'плач скрежет');
    await userEvent.click(await screen.findByRole('button', { name: /bible\.search\.searchAsWords/ }));
    await screen.findByText('bible.search.verses{"count":7}');
    await userEvent.keyboard('{Enter}');
    await userEvent.clear(line);
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'bible.search.history' })).getByRole('button', { name: /^плач скрежет/ }));
    expect(await screen.findByText('bible.search.verses{"count":7}')).toBeInTheDocument();
    expect(screen.getByText('bible.search.asWords')).toBeInTheDocument();
  });

  it('widens to the whole Bible without turning a word into a book: «Мф плач» → «плач» as a word', async () => {
    const { line } = renderLine();
    await userEvent.type(line, 'Мф плач');
    await screen.findByText(/bible\.search\.verses/);
    await userEvent.click(screen.getByRole('button', { name: /bible\.search\.widerBible/ }));
    expect(line).toHaveValue('плач');
    expect(await screen.findByText('bible.search.asWords')).toBeInTheDocument();
    expect(screen.queryByText(/bible\.chapterCount/)).not.toBeInTheDocument();
  });

  // Typed with the English layout too: the search is «НЗ благодать», the field holds what was typed (Codex review r6);
  // and with two spaces between the words, which the history keeps as one (r7).
  it.each(['НЗ благодать', 'YP ,kfujlfnm', 'НЗ  благодать', 'YP  ,kfujlfnm'])('a search of the history comes back on a verse found after «Показать ещё», the same verses shown: «%s» (Codex review, 2026-10-23)', async (typed) => {
    const first = renderLine();
    await userEvent.click(first.line);
    await userEvent.paste(typed);
    await screen.findByText('bible.search.verses{"count":122}');
    await userEvent.click(showMore());
    await userEvent.keyboard('{Enter}');                     // the 101st verse, where «Показать ещё» put the arrows
    const opened = first.onOpen.mock.calls[0][0];
    document.body.innerHTML = '';
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent autoFocus onOpen={jest.fn()} />);
    await userEvent.keyboard('{Enter}');                     // the first search of the history
    // All 122 shown again, as when the verse was opened.
    await waitFor(() => expect(options()).toHaveLength(122));
    const selected = await waitFor(() => {
      const chosen = document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
      expect(chosen).not.toBeNull();
      return chosen as HTMLElement;
    });
    expect(selected.textContent).toContain(`${opened.chapter}:${opened.verse}`);
    expect(selected.textContent).toContain('bible.search.seen');
  });

  it('one search whatever its case: verses opened from «НЗ благодать» and «нз благодать» are both marked (Codex review r8)', async () => {
    const first = renderLine();
    await userEvent.click(first.line);
    await userEvent.paste('НЗ благодать');
    await screen.findByText('bible.search.verses{"count":122}');
    await userEvent.keyboard('{Enter}');                     // A, the first verse
    await userEvent.clear(first.line);
    await userEvent.paste('нз благодать');
    await screen.findByText('bible.search.verses{"count":122}');
    await userEvent.keyboard('{ArrowDown}{Enter}');          // B, the second
    document.body.innerHTML = '';
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent autoFocus onOpen={jest.fn()} />);
    expect(screen.getAllByRole('button', { name: /благодать/i }).filter((button) => !/historyRemove/.test(button.getAttribute('aria-label') ?? ''))).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    await screen.findByText('bible.search.verses{"count":122}');
    expect(screen.getAllByText('bible.search.seen')).toHaveLength(2);
  });

  it('a search of the history comes back on the verse opened last: A, then B, then A again', async () => {
    const first = renderLine();
    await userEvent.type(first.line, '"хлеб жизни"');
    await screen.findByText('bible.search.verses{"count":2}');
    await userEvent.keyboard('{Enter}');                     // John 6:35
    await userEvent.keyboard('{ArrowDown}{Enter}');          // John 6:48
    await userEvent.keyboard('{ArrowUp}{Enter}');            // John 6:35 again
    document.body.innerHTML = '';
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent autoFocus onOpen={jest.fn()} />);
    await userEvent.keyboard('{Enter}');                     // the first search of the history
    await screen.findByText('bible.search.verses{"count":2}');
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true'));
  });
});

// The owner, 2026-10-27: «сделал поиск, прошло 10 секунд и не поменял — в историю; выбрал стих — в историю; подбери и
// другие случаи». The cases weighed with Codex: `searchKeeping.ts`.
describe('the search history fills with the searches worked with', () => {
  const kept = () => (JSON.parse(window.localStorage.getItem('bible:search-history') ?? '{"entries":[]}') as { entries: Array<{ line: string }> }).entries.map((entry) => entry.line);
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] }));
  afterEach(() => {
    jest.useRealTimers();
    setVisibility('visible');
  });
  const typeLine = async (text: string) => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { line } = renderLine();
    await user.type(line, text);
    return { user, line };
  };
  const wait = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });

  it('keeps a search that stood ten seconds in sight, and never the letters on the way to it', async () => {
    const { user, line } = await typeLine('хлеб');
    await screen.findByText(/^bible\.search\.verses/);
    await wait(6000);
    await user.type(line, ' жизни');
    await screen.findByText(/^bible\.search\.verses/);
    await wait(9000);
    expect(kept()).toEqual([]);
    await wait(1500);
    expect(kept()).toEqual(['хлеб жизни']);
  });

  it('keeps a search at once when a verse is chosen in it, or copied', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn().mockResolvedValue(undefined) }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const { user, line } = await typeLine('"хлеб жизни"');
    await screen.findByText('bible.search.verses{"count":2}');
    await user.click(screen.getAllByRole('option')[1]);
    expect(kept()).toEqual(['"хлеб жизни"']);
    await user.clear(line);
    await user.type(line, 'Иоанна хлеб');
    await screen.findByText('bible.search.verses{"count":21}');
    await user.keyboard('{Control>}c{/Control}');
    expect(kept()).toEqual(['Иоанна хлеб', '"хлеб жизни"']);
  });

  it('lets the clock keep nothing while the tab is hidden, a lone word that begins books, or a search that found nothing', async () => {
    const { user, line } = await typeLine('хлеб жизни');
    await screen.findByText(/^bible\.search\.verses/);
    await wait(5000);
    setVisibility('hidden');
    await wait(30000);
    expect(kept()).toEqual([]);
    setVisibility('visible');
    await wait(5500);
    expect(kept()).toEqual(['хлеб жизни']);
    // «ад» finds verses, but two letters show only books for now: nothing shown, nothing kept (Codex review, 2026-10-27).
    for (const text of ['Ио', 'хлебщзш', 'ад']) {
      await user.clear(line);
      await user.type(line, text);
      await wait(12000);
    }
    expect(kept()).toEqual(['хлеб жизни']);
  });

  it('a search taken out of the history is not kept back by the clock; «Вернуть» keeps what came since', async () => {
    // Kept on an earlier visit, typed again, and taken out while its clock still runs.
    rememberSearch('хлеб жизни', 'rst');
    const { user, line } = await typeLine('хлеб жизни');
    await screen.findByText(/^bible\.search\.verses/);
    await wait(3000);
    await user.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await user.click(screen.getByRole('button', { name: 'bible.search.historyRemove{"line":"хлеб жизни"}' }));
    await user.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await wait(15000);
    expect(kept()).toEqual([]);
    // Cleared, a search worked with after it, then «Вернуть»: both are there, the later on top.
    rememberSearch('пастырь мой', 'rst');
    await user.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await user.click(screen.getByRole('button', { name: 'bible.search.historyClear' }));
    rememberSearch('свет миру', 'rst');
    await user.click(screen.getByRole('button', { name: 'bible.search.historyUndo' }));
    expect(kept()).toEqual(['свет миру', 'пастырь мой']);
    expect(line).toHaveValue('хлеб жизни');
  });

  it('clearing the history while a search waits on the clock leaves it cleared', async () => {
    const { user } = await typeLine('хлеб жизни');
    await screen.findByText(/^bible\.search\.verses/);
    await wait(4000);
    rememberSearch('пастырь мой', 'rst');
    await user.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await user.click(screen.getByRole('button', { name: 'bible.search.historyClear' }));
    await user.click(screen.getByRole('button', { name: 'bible.search.history' }));
    await wait(15000);
    expect(kept()).toEqual([]);
  });

  // Codex review, 2026-10-27: four ways the history went wrong.
  it('starts the clock again on any edit — a space too — and waits while an IME composes', async () => {
    const { user, line } = await typeLine('хлеб жизни');
    await screen.findByText(/^bible\.search\.verses/);
    await wait(9000);
    await user.type(line, ' ');
    await wait(2000);
    expect(kept()).toEqual([]);
    fireEvent.compositionStart(line);
    await wait(15000);
    expect(kept()).toEqual([]);
    fireEvent.compositionEnd(line);
    await wait(10500);
    expect(kept()).toEqual(['хлеб жизни']);
  });

  it('keeps a search a press on its results set off as soon as it answers, never a book name the arrows pass', async () => {
    const { user, line } = await typeLine('Иоа');
    await screen.findAllByText(/^bible\.search\.booksHead/);
    await user.keyboard('{ArrowDown}');
    expect(kept()).toEqual([]);
    await user.clear(line);
    await user.type(line, 'Рим 4 вера');
    await screen.findByText('bible.search.verses{"count":10}');
    await user.click(screen.getByRole('button', { name: /bible\.search\.widerBook/ }));
    await screen.findByText('bible.search.verses{"count":51}');
    expect(kept()).toEqual(['Рим вера']);
  });
});
