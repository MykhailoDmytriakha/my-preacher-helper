import fs from 'fs';
import path from 'path';

import { bookSequence, booksOf } from '@/components/bible/bookOrder';
import { answeringOf, chooseReading } from '@/utils/bibleSearch/lineChoice';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { bookSlug, type BookText } from '@/utils/bibleText';

import type { BibleId } from '@/utils/bibles';

function corpus(bible: BibleId, only?: string[]) {
  const books = booksOf(bible);
  const order = bookSequence(books);
  const index = new BibleSearchIndex(order);
  for (const id of only ?? order) {
    index.addBook(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/bible-text', bible, 'v1', bookSlug(id) + '.json'), 'utf8')) as BookText);
  }
  return { index, books, order };
}
const rst = corpus('rst');
const choose = (raw: string, asWords = false) => chooseReading(raw, { bible: 'rst', books: rst.books, asWords }, answeringOf(rst.index, rst.order.length, rst.books));
const scope = (raw: string) => {
  const reading = choose(raw).reading;
  return reading.kind === 'search' ? reading.query.scope : null;
};

// BUG-20261027-search-book-name-that-is-a-word: the existing UI action needs positive word evidence.
describe('exact book names with a word meaning', () => {
  it.each([
    ['Рим Павел', 'Romans', 1, 5],
    ['Иоанн крест', 'John', 14, 33],
    ['Иуда предал', 'Jude', 0, 7],
  ])('keeps the book and offers the word meaning of %s', (raw, bookId, bookCount, wordCount) => {
    const reading = choose(String(raw));
    expect(reading.reading.kind).toBe('search');
    expect(scope(String(raw))).toMatchObject({ kind: 'book', bookId, chapter: null, wordLike: true });
    expect(reading.answer?.hits).toHaveLength(Number(bookCount));
    const words = choose(String(raw), true);
    expect(words.reading.kind === 'search' && words.reading.query.scope).toBeNull();
    expect(words.answer?.hits).toHaveLength(Number(wordCount));
  });

  it('decorates the final reading after correcting the keyboard layout', () => {
    const chosen = choose('hbv gfdtk');
    expect(chosen.layoutFixed).toBe('рим павел');
    expect(chosen.reading.kind === 'search' && chosen.reading.query.scope).toMatchObject({ kind: 'book', bookId: 'Romans', wordLike: true });
    expect(chosen.answer?.hits).toHaveLength(1);
  });

  it.each([
    ['Рим 4 вера', { kind: 'book', bookId: 'Romans', chapter: 4, wordLike: false }],
    ['Ин хлеб', { kind: 'book', bookId: 'John', chapter: null, wordLike: false }],
    ['1 Ин свет', { kind: 'book', bookId: '1 John', chapter: null, wordLike: false }],
    ['Мф Иоанн хлеб', { kind: 'books', bookIds: ['Matthew', 'John'], wordLike: false }],
  ])('preserves the explicit interpretation of %s', (raw, expected) => {
    expect(scope(raw)).toMatchObject(expected);
  });

  it('retains explicit phrases, patterns and place opening', () => {
    expect(choose('Ин 3:16').reading).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16 });
    expect(choose('"Рим" Павел').reading).toMatchObject({ kind: 'search', query: { scope: null, phrases: [{ words: ['рим'], complete: true }] } });
    expect(choose('Рим* Павел').reading).toMatchObject({ kind: 'search', query: { scope: null, terms: ['рим*', 'павел'] } });
    expect(scope('Рим "Павел"')).toMatchObject({ kind: 'book', bookId: 'Romans', wordLike: true });
  });

  it('does not run another search merely to expose the word choice', () => {
    const spy = jest.spyOn(rst.index, 'search');
    choose('Рим Павел');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('adds the choice only after the available index attests the name and keeps the static fallback', () => {
    const partial = corpus('rst', ['Genesis']);
    const read = (line: string) => {
      const result = chooseReading(line, { bible: 'rst', books: partial.books }, answeringOf(partial.index, 1, partial.books));
      return result.reading.kind === 'search' ? result.reading.query.scope : null;
    };
    expect(read('Иоанн крест')).toMatchObject({ wordLike: false });
    expect(read('плач скрежет')).toMatchObject({ wordLike: true });
    partial.index.addBook(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/bible-text/rst/v1/john.json'), 'utf8')) as BookText);
    expect(read('Иоанн крест')).toMatchObject({ wordLike: true });
    // The same saved local index supports the same choice without a new network request.
    expect(read('Иоанн крест')).toMatchObject({ wordLike: true });
  });

  it.each([
    ['kjv', 'John Jesus', 'John', 245, 17],
    ['ubio', 'Івана Христос', 'John', 15, 1],
  ] as const)('uses the actual %s translation vocabulary for %s', (bible, raw, bookId, bookCount, wordCount) => {
    const data = corpus(bible);
    const context = { bible, books: data.books };
    const answer = answeringOf(data.index, data.order.length, data.books);
    const chosen = chooseReading(raw, context, answer);
    expect(chosen.reading.kind === 'search' && chosen.reading.query.scope).toMatchObject({ kind: 'book', bookId, wordLike: true });
    expect(chosen.answer?.hits).toHaveLength(bookCount);
    expect(chooseReading(raw, { ...context, asWords: true }, answer).answer?.hits).toHaveLength(wordCount);
  });
});
