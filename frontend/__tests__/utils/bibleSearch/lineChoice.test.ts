import fs from 'fs';
import path from 'path';

import { bookSequence, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { chooseReading } from '@/utils/bibleSearch/lineChoice';
import { answerSearch, isBibleWord } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { bookSlug, type BookText } from '@/utils/bibleText';

import type { LineReading } from '@/utils/bibleSearch/query';

/** The whole Synodal text from the files the app serves: the numbers below are the real ones. */
const order = bookSequence(SYNODAL_BOOKS);
const rst = new BibleSearchIndex(order);
for (const bookId of order) {
  rst.addBook(JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/bible-text/rst/v1', `${bookSlug(bookId)}.json`), 'utf8')) as BookText);
}
const answering = {
  answerFor: (reading: LineReading) => (reading.kind === 'search' ? answerSearch(rst, reading.query, SYNODAL_BOOKS) : null),
  isWord: (word: string) => isBibleWord(rst, word),
};
const choose = (line: string, asWords = false) => chooseReading(line, { bible: 'rst', books: SYNODAL_BOOKS, asWords }, answering);
const scopeOf = (line: string, asWords = false) => {
  const { reading } = choose(line, asWords);
  return reading.kind === 'search' && reading.query.scope && 'bookIds' in reading.query.scope ? reading.query.scope.bookIds : null;
};
const places = (line: string) => (choose(line).answer?.hits ?? []).map((hit) => `${hit.book} ${hit.chapter}:${hit.verse}`);

// BUG-20261027-search-related-words: «корин душ» found one verse by the city Corinth; the owner meant 1 and 2 Corinthians.
describe('a line whose first letters may be books', () => {
  it('is read with the books when there it finds more: «корин душ», «коринфянам душ» — 1 and 2 Corinthians', () => {
    for (const line of ['корин душ', 'коринфянам душ']) {
      expect(scopeOf(line)).toEqual(['1 Corinthians', '2 Corinthians']);
      expect(choose(line).booksBegun).toMatchObject({ line: '1Кор 2Кор душ', chosen: true });
      // «Душевный человек не принимает того, что от Духа Божия» — the kin of «душ» found there too.
      expect(places(line)).toContain('1 Corinthians 2:14');
    }
    expect(scopeOf('Прит Екклес свет')).toEqual(['Proverbs', 'Ecclesiastes']);
    expect(places('Прит Екклес свет')).toHaveLength(14);
  });

  // Codex review, 2026-10-27: counting verses chose the books — a word made a book is one word fewer to find.
  it('never takes a word of the Bible for a book: «петр сказал», «Мф иисус сказал», «Иисус в» typed on', () => {
    const peter = choose('петр сказал');
    expect(peter.reading.kind === 'search' && peter.reading.query.scope).toBeNull();
    expect(peter.booksBegun).toBeNull();
    expect(peter.answer?.hits.length).toBeGreaterThan(50);
    const matthew = choose('Мф иисус сказал');
    expect(matthew.reading.kind === 'search' && matthew.reading.query.scope).toMatchObject({ kind: 'book', bookId: 'Matthew' });
    expect(matthew.answer?.hits).toHaveLength(75);
    for (const line of ['Иисус', 'Иисус в', 'Иисус в лодк']) expect(choose(line).reading.kind).toBe('search');
  });

  it('a phrase in quotes follows the letters too: «корин "любовь долготерпит"»', () => {
    expect(places('корин "любовь долготерпит"')).toEqual(['1 Corinthians 13:4']);
  });

  // Codex class hunt, 2026-10-27: a number before cut-short letters names one of the books.
  it('a number before the letters names that book: «1 корин душ» is 1 Corinthians alone', () => {
    expect(scopeOf('1 корин душ')).toBeNull();
    const first = choose('1 корин душ');
    expect(first.reading.kind === 'search' && first.reading.query.scope).toMatchObject({ kind: 'book', bookId: '1 Corinthians' });
    expect(places('1 корин душ').every((place) => place.startsWith('1 Corinthians'))).toBe(true);
  });

  // Codex class hunt, 2026-10-27: «corin judg» made «Judg», still being typed, a third book.
  it('the books reading holds its own books only: «корин ин» does not make «ин» John', () => {
    expect(choose('корин ин').reading.kind).toBe('search');
    expect(choose('корин ин').booksBegun?.chosen).toBe(false);
  });

  it('answers each reading in one pass over the index', () => {
    const search = jest.spyOn(rst, 'search');
    choose('корин душ');
    expect(search).toHaveBeenCalledTimes(2);
    search.mockRestore();
  });

  it('read as words by the person, keeps the books only as the way back, counted', () => {
    const words = choose('корин душ', true);
    expect(scopeOf('корин душ', true)).toBeNull();
    expect(words.booksBegun).toMatchObject({ chosen: false, line: '1Кор 2Кор душ', asWords: 'корин* душ' });
    expect(words.booksBegun?.found).toBeGreaterThan(1);
  });

  it('first letters and numbers alone are a place: «корин 13:4» — 1 or 2 Corinthians, not the city', () => {
    const place = choose('корин 13:4');
    expect(place.booksBegun).toMatchObject({ chosen: true, line: '1Кор 2Кор 13:4' });
    expect(place.reading.kind).toBe('booksChapter');
    // A little word is no place: «корин в», typed on, stays the search it was (Codex review, 2026-10-27).
    expect(choose('корин в').reading.kind).toBe('search');
    // With words, the words still choose by the verses: «корин 13 любовь» — none as words, the chapter in the books.
    expect(choose('корин 13 любовь').reading.kind).toBe('booksChapter');
  });

  it('a line typed in the English layout is still read turned', () => {
    const turned = choose('ghbn cdtn');
    expect(turned.layoutFixed).toBe('прит свет');
    expect(turned.reading.kind === 'search' && turned.reading.query.scope).toMatchObject({ kind: 'book', bookId: 'Proverbs' });
  });
});
