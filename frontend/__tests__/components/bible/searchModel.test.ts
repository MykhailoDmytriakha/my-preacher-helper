import fs from 'fs';
import path from 'path';

import { bookSequence, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { buildSearchModel, rowForEnter, type ModelInput, type ModelRow } from '@/components/bible/search/searchModel';
import { readLine } from '@/utils/bibleSearch/query';
import { answerSearch } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { bookSlug, type BookText } from '@/utils/bibleText';

import type { SearchIndexState } from '@/utils/bibleSearch/searchIndexStore';
import type { TFunction } from 'i18next';

/*
 * What the line says when not every book was searched (Codex review, 2026-10-23): the counts are
 * qualified, the steps stay, and «nowhere in the Bible» is never said.
 */
const t = ((key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key)) as unknown as TFunction;
const order = bookSequence(SYNODAL_BOOKS);
const johnOnly = new BibleSearchIndex(order);
johnOnly.addBook(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/bible-text/rst/v1', `${bookSlug('John')}.json`), 'utf8')) as BookText);

function model(line: string, index: Partial<SearchIndexState>, offline: boolean, more: Partial<ModelInput> = {}) {
  const state = { index: johnOnly, indexed: 1, total: 66, loading: false, missing: 65, version: 1, ...index } as SearchIndexState;
  const reading = readLine(line, { bible: 'rst', books: SYNODAL_BOOKS });
  const answer = reading.kind === 'search' ? answerSearch(johnOnly, reading.query, SYNODAL_BOOKS) : null;
  const input: ModelInput = {
    reading, books: SYNODAL_BOOKS, answer, index: state, bible: 'rst', locale: 'ru', t, wide: true, asWords: false, bookReadAs: null,
    allBooks: false, fixChapters: false, opened: new Set(), offline, layoutFixed: null, limit: 40, booksBegun: null, ...more,
  };
  return buildSearchModel(input, () => null);
}

// BUG-20261027-search-related-words: «Слова на «корин»: душу коринф» — the label of a beginning stood over every form found.
describe('the forms found under the line', () => {
  it('names the beginnings only when every form shown begins one of them', () => {
    expect(model('хлеб жизн', {}, false).head?.formsLabel).toBe('bible.search.formsFound');
    expect(model('жизн', {}, false).head?.formsLabel).toContain('bible.search.begun');
  });
});

// BUG-20261027-search-related-words: a line whose first letters may be books keeps its other reading a tap away.
describe('the other reading of first letters that may be books', () => {
  const begun = { line: '1Кор 2Кор душ', bookIds: ['1 Corinthians', '2 Corinthians'], said: 'корин', place: false, asWords: 'корин* душ', found: 4 };
  it('shown as the books, offers the words — the letters with a star, so a book named before them stays', () => {
    const shown = model('Ин хлеб', {}, false, { booksBegun: { ...begun, chosen: true } });
    expect(shown.head?.asWordsLink).toEqual({ label: 'bible.search.asWordLink{"word":"корин","words":"корин"}', run: { kind: 'write', line: 'корин* душ' } });
  });
  it('shown as words, offers the books where they find verses — and only there', () => {
    const shown = model('хлеб', {}, false, { booksBegun: { ...begun, chosen: false } });
    expect(shown.head?.asWordsLink?.run).toEqual({ kind: 'write', line: '1Кор 2Кор душ' });
    expect(shown.head?.asWordsLink?.label).toContain('bible.search.searchInBooks');
    expect(model('хлеб', {}, false, { booksBegun: { ...begun, found: 0, chosen: false } }).head?.asWordsLink).toBeNull();
  });
});

describe('a search over some of the books', () => {
  it('offline: says where it looked, keeps the step wider and never says «nowhere»', () => {
    const shown = model('Рим хлеб', {}, true);
    const fix = shown.rows.find((row) => row.type === 'fix');
    expect(fix).toMatchObject({ text: expect.stringContaining('bible.search.everywhereSaved') });
    expect(fix?.type === 'fix' && fix.actions.map((action) => action.label)).toEqual(['bible.search.searchBible']);
    expect(shown.offline).toContain('bible.search.offline');
    expect(JSON.stringify(shown)).not.toContain('bible.search.nowhere');
  });

  it('online with books that did not load: the same, in the words of a failed load', () => {
    const shown = model('Рим хлеб', {}, false);
    expect(shown.rows.find((row) => row.type === 'fix')).toMatchObject({ text: expect.stringContaining('bible.search.everywhereLoaded') });
    expect(shown.offline).toContain('bible.search.partial');
  });

  it('keeps «search as words» for a book whose name is a word', () => {
    const shown = model('плач скрежет', {}, true);
    const fix = shown.rows.find((row) => row.type === 'fix');
    expect(fix?.type === 'fix' && fix.actions[0].run).toEqual({ kind: 'asWords', on: true });
  });

  // Codex review, 2026-10-27: several books whose first is an everyday word kept no way to search the line as words.
  it('keeps «search as words» for several books whose first is a word: «лев Иуды»', () => {
    const shown = model('лев Иуды', {}, false);
    expect(shown.rows[0]).toMatchObject({ type: 'book', key: 'as-words', run: { kind: 'asWords', on: true } });
    // Several names read as words — said in the plural («как слова»), not as one word.
    expect(shown.rows[0]).toMatchObject({ title: expect.stringContaining('bible.search.asWordsLink') });
  });

  // Codex review, 2026-10-27: a chapter after several books was dropped and the books searched whole, silently.
  it('a chapter after several books is said, with the books whole or the last book at that chapter', () => {
    const shown = model('Прит Еккл 3:1 свет', {}, false);
    const fix = shown.rows.find((row) => row.type === 'fix');
    expect(fix?.type === 'fix' && fix.title).toBe('bible.search.booksChapterTitle');
    expect(fix?.type === 'fix' && fix.actions.map((action) => action.run)).toEqual([
      { kind: 'write', line: 'Притч Еккл свет' },
      { kind: 'write', line: 'Притч 3:1 свет' },
      { kind: 'write', line: 'Еккл 3:1 свет' },
    ]);
  });

  // BUG-20261027-search-related-words: «корин 13:4» — a place in 1 or 2 Corinthians; each book is a way to it.
  it('a place after several books offers it in each book', () => {
    const fix = model('1Кор 2Кор 13:4', {}, false).rows.find((row) => row.type === 'fix');
    expect(fix?.type === 'fix' && fix.title).toBe('bible.search.booksPlaceTitle');
    expect(fix?.type === 'fix' && fix.actions.map((action) => [action.label, action.run])).toEqual([
      ['1Кор 13:4', { kind: 'write', line: '1Кор 13:4' }],
      ['2Кор 13:4', { kind: 'write', line: '2Кор 13:4' }],
    ]);
  });

  // Codex review r2, 2026-10-27: each line a button writes reads back as what the button says.
  it.each([
    ['Прит Еккл 3:1-8 время', ['Притч Еккл время', 'Притч 3:1-8 время', 'Еккл 3:1-8 время']],
    // «Лев» second in a list is the word — the person's own «левит» is written instead.
    ['Прит Левит 3 свет', ['прит левит свет', 'Притч 3 свет', 'Лев 3 свет']],
    // «Иоанн» after «Ин» is the word, not John again.
    ['Мф Ин 3 Иоанн', ['Мф Ин иоанн', 'Мф 3 иоанн', 'Ин 3 иоанн']],
    // «Иов» would join the list once the chapter is gone: no line searches the two books for it, so no button says so.
    ['Прит Еккл 3 Иов', ['Притч 3 иов', 'Еккл 3 иов']],
    // A chapter only some of the books have: Ecclesiastes has twelve.
    ['Прит Еккл 20 свет', ['Притч Еккл свет', 'Притч 20 свет']],
  ])('the books-chapter buttons for «%s» write lines that read back as said', (line, written) => {
    const fix = model(line, {}, false).rows.find((row) => row.type === 'fix');
    const actions = fix?.type === 'fix' ? fix.actions : [];
    expect(actions.map((action) => action.run)).toEqual(written.map((text) => ({ kind: 'write', line: text })));
    expect(actions[0].primary).toBe(true);
  });

  it('while books arrive: says it is still loading, and the wider counts wait', () => {
    const empty = model('Рим хлеб', { loading: true, missing: 0 }, false);
    expect(empty.rows).toEqual([expect.objectContaining({ type: 'more', text: expect.stringContaining('bible.search.stillLoadingTitle') })]);
    const found = model('Иоанна хлеб', { loading: true, missing: 0 }, false);
    expect(found.head).toMatchObject({ wider: [], where: expect.stringContaining('bible.search.stillLoading') });
  });
});

describe('a word being typed', () => {
  it('says the words were found by their beginning, and marks them in the verse', () => {
    const shown = model('Ин хле', { indexed: 66, missing: 0 }, false);
    expect(shown.head?.formsLabel).toBe('bible.search.begun{"words":"bible.search.quote{\\"text\\":\\"хле\\"}"}');
    expect(shown.head?.forms).toEqual(expect.arrayContaining(['хлеб', 'хлеба']));
    const verse = shown.rows.find((row) => row.type === 'verse');
    expect(verse?.type === 'verse' && verse.pieces.filter((piece) => piece.lit).map((piece) => piece.text.toLowerCase())).toEqual(
      expect.arrayContaining([expect.stringMatching(/^хлеб/)]),
    );
  });
});

describe('what Enter opens', () => {
  const verse = (key: string): ModelRow => ({ type: 'verse', key, ref: key, pieces: [], seen: false, run: { kind: 'write', line: key } });
  const rows: ModelRow[] = [{ type: 'head', key: 'h', title: 'h' }, verse('a'), verse('b'), { type: 'showMore', key: 'show-more', title: '', meta: '', run: { kind: 'more', limit: 80, next: 'c' } }];

  it('opens the row the arrows are on, even before the rows on screen caught up (Codex review r8)', () => {
    expect(rowForEnter(rows, 'b')?.key).toBe('b');
    expect(rowForEnter(rows, 'show-more')?.key).toBe('show-more');
  });

  it('else the first place, book or verse — never «Показать ещё» by default', () => {
    expect(rowForEnter(rows, null)?.key).toBe('a');
    expect(rowForEnter(rows, 'gone')?.key).toBe('a');
    expect(rowForEnter([rows[3]], null)).toBeNull();
  });
});
