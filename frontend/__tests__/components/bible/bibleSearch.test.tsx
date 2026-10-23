import fs from 'fs';
import path from 'path';

import { act, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(await screen.findByText('bible.search.verses{"count":9}')).toBeInTheDocument();
    expect(screen.getByText('bible.search.scopeChapter{"book":"К Римлянам","chapter":4}')).toBeInTheDocument();
    expect(screen.getByText('bible.search.formsFound')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(9);
    // A wider step writes its place into the line.
    await userEvent.click(screen.getByRole('button', { name: /bible\.search\.widerBook/ }));
    expect(line).toHaveValue('Рим вера');
    expect(await screen.findByText('bible.search.verses{"count":36}')).toBeInTheDocument();
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
  it('shows forty verses, and forty more at a press, the arrows on the first of them', async () => {
    const { line } = renderLine();
    await userEvent.click(line);
    await userEvent.paste('НЗ благодать');
    await screen.findByText('bible.search.verses{"count":120}');
    expect(options()).toHaveLength(41);
    expect(showMore().closest('[role="option"]')).toBe(options()[40]);
    expect(screen.getByText('bible.search.shownOf{"shown":40,"count":120}')).toBeInTheDocument();
    await userEvent.click(showMore());
    expect(screen.getByText('bible.search.shownOf{"shown":80,"count":120}')).toBeInTheDocument();
    expect(options()).toHaveLength(81);
    expect(options()[40]).toHaveAttribute('aria-selected', 'true');
    // The last step shows the rest, and nothing is left to press (Enter on it: `rowForEnter`, searchModel.test.ts).
    await userEvent.click(showMore());
    expect(options()).toHaveLength(120);
    expect(screen.queryByText(/^bible\.search\.showMore/)).not.toBeInTheDocument();
    // Another line starts again from the first forty.
    await userEvent.paste(' Христа');
    await waitFor(() => expect(options().length).toBeLessThanOrEqual(41));
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
    await screen.findByText('bible.search.verses{"count":120}');
    await userEvent.click(showMore());
    await userEvent.keyboard('{Enter}');                     // the 41st verse, where «Показать ещё» put the arrows
    const opened = first.onOpen.mock.calls[0][0];
    document.body.innerHTML = '';
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent autoFocus onOpen={jest.fn()} />);
    await userEvent.keyboard('{Enter}');                     // the first search of the history
    await screen.findByText('bible.search.shownOf{"shown":80,"count":120}');
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
    await screen.findByText('bible.search.verses{"count":120}');
    await userEvent.keyboard('{Enter}');                     // A, the first verse
    await userEvent.clear(first.line);
    await userEvent.paste('нз благодать');
    await screen.findByText('bible.search.verses{"count":120}');
    await userEvent.keyboard('{ArrowDown}{Enter}');          // B, the second
    document.body.innerHTML = '';
    render(<BibleSearch bible="rst" locale="ru" wide surface="window" openWithRecent autoFocus onOpen={jest.fn()} />);
    expect(screen.getAllByRole('button', { name: /благодать/i }).filter((button) => !/historyRemove/.test(button.getAttribute('aria-label') ?? ''))).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    await screen.findByText('bible.search.verses{"count":120}');
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
