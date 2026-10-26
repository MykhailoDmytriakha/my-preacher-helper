import fs from 'fs';
import path from 'path';

import { bookSequence, PROTESTANT_BOOKS, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { readLine } from '@/utils/bibleSearch/query';
import { answerSearch } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { bookSlug, type BookText } from '@/utils/bibleText';

/** The whole Synodal text from the files the app serves: the numbers below are the real ones. */
function indexOf(bible: 'rst' | 'kjv'): BibleSearchIndex {
  const books = bible === 'rst' ? SYNODAL_BOOKS : PROTESTANT_BOOKS;
  const order = bookSequence(books);
  const index = new BibleSearchIndex(order);
  for (const bookId of order) {
    const file = path.join(__dirname, '../../../public/bible-text', bible, 'v1', `${bookSlug(bookId)}.json`);
    index.addBook(JSON.parse(fs.readFileSync(file, 'utf8')) as BookText);
  }
  return index;
}

const rst = indexOf('rst');
const ru = { bible: 'rst' as const, books: SYNODAL_BOOKS };

const answer = (line: string, asWords = false) => {
  const reading = readLine(line, { ...ru, asWords });
  if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
  return answerSearch(rst, reading.query, SYNODAL_BOOKS);
};
const places = (line: string) => answer(line).hits.map((hit) => `${hit.book} ${hit.chapter}:${hit.verse}`);

describe('search over the Synodal text', () => {
  it.each([
    ['Иоанна хлеб', 21],
    ['Рим 4 вера', 9],
    ['Римлянам четыре веры', 9],
    ['Ин 6:25-59 хлеб', 11],
    ['НЗ благодать', 120],
    ['Евангелия хлеб', 79],
    ['Пророки утешение', 5],
    ['"хлеб жизни"', 2],
    ['благодат*', 132],
    ['Ил_я', 61],
    ['пастырь мой', 7],
    ['1 Кор 13 любовь', 6],
  ])('«%s» finds %i verses', (line, count) => {
    expect(answer(line).hits).toHaveLength(count);
  });

  it('finds the forms of a word: «вера» — веры, вере, веру', () => {
    expect(answer('Рим 4 вера').forms).toEqual(expect.arrayContaining(['вере', 'вера', 'веры', 'веру']));
    expect(answer('1 Кор 13 любовь').forms).toEqual(expect.arrayContaining(['любовь', 'любви']));
  });

  it('the phrase is found where its words stand together', () => {
    expect(places('"хлеб жизни"')).toEqual(['John 6:35', 'John 6:48']);
  });

  it('the wider steps carry their counts and the line that searches there', () => {
    expect(answer('Рим 4 вера').wider).toEqual([
      { kind: 'book', count: 36, line: 'Рим вера' },
      { kind: 'testament', testament: 'new', count: 240, line: 'НЗ вера' },
      { kind: 'bible', count: 248, line: 'вера' },
    ]);
    expect(answer('Ин 6:25-59 хлеб').wider[0]).toEqual({ kind: 'chapter', chapter: 6, count: 17, line: 'Ин 6 хлеб' });
  });

  it('nothing in the place it looked, and how much everywhere', () => {
    const none = answer('Рим хлеб');
    expect(none.hits).toHaveLength(0);
    expect(none.everywhere).toBe(440);
  });

  it('a book read as a word: «плач скрежет» as words', () => {
    expect(answer('плач скрежет').hits).toHaveLength(0);
    expect(answer('плач скрежет', true).hits).toHaveLength(7);
  });

  it('a word the Bible does not have is read as the beginning of one: «НЗ оде» while «одежда» is typed', () => {
    const typing = answer('НЗ оде');
    expect(typing.begun).toEqual(['оде']);
    expect(typing.hits.length).toBeGreaterThan(93);
    expect(typing.forms).toEqual(expect.arrayContaining(['одежды', 'одежду']));
    // Each step of typing finds, and the finished word is searched in its forms again.
    expect(answer('НЗ од').hits.length).toBeGreaterThan(0);
    expect(answer('НЗ одеж').begun).toEqual(['одеж']);
    expect(answer('НЗ одежд').begun).toEqual([]);
    expect(answer('НЗ одежд').hits).toHaveLength(93);
    // A word the Bible has keeps to its forms: «мир» does not turn into «мирра».
    expect(answer('мир').begun).toEqual([]);
    expect(answer('мир').forms).not.toContain('мирра');
  });

  it('the beginning of a word marks what it found in the verse', () => {
    const typing = answer('НЗ оде');
    expect(typing.matchers.some((matcher) => matcher.test('одеяние'))).toBe(true);
    expect(answer('НЗ ыыы').hits).toHaveLength(0);
  });

  it('results come in the order of the Bible being read', () => {
    const books = Array.from(new Set(answer('НЗ благодать').hits.map((hit) => hit.book)));
    // The Synodal puts James–Jude right after Acts.
    expect(books.indexOf('James')).toBeLessThan(books.indexOf('Romans'));
  });
});

describe('search over the King James text', () => {
  const kjv = indexOf('kjv');
  const en = { bible: 'kjv' as const, books: PROTESTANT_BOOKS };
  const find = (line: string) => {
    const reading = readLine(line, en);
    if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
    return answerSearch(kjv, reading.query, PROTESTANT_BOOKS);
  };

  it('finds English forms: «love» — loveth, loved', () => {
    // The King James says «charity» in 1 Corinthians 13; «love» fills 1 John 4.
    expect(find('1 John 4 love').hits.length).toBeGreaterThan(5);
    expect(find('John love').forms).toEqual(expect.arrayContaining(['love', 'loveth', 'loved']));
  });

  it('reads the parts in English', () => {
    expect(find('Gospels bread').hits.every((hit) => ['Matthew', 'Mark', 'Luke', 'John'].includes(hit.book))).toBe(true);
    expect(find('"bread of life"').hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('search over the Ohienko text', () => {
  const order = bookSequence(PROTESTANT_BOOKS);
  const ubio = new BibleSearchIndex(order);
  for (const bookId of order) {
    const file = path.join(__dirname, '../../../public/bible-text/ubio/v1', `${bookSlug(bookId)}.json`);
    ubio.addBook(JSON.parse(fs.readFileSync(file, 'utf8')) as BookText);
  }
  const uk = { bible: 'ubio' as const, books: PROTESTANT_BOOKS };
  const find = (line: string) => {
    const reading = readLine(line, uk);
    if (reading.kind !== 'search') throw new Error(`${line}: ${reading.kind}`);
    return answerSearch(ubio, reading.query, PROTESTANT_BOOKS);
  };

  it('knows a book by its name without «Від»: «Івана хліб»', () => {
    expect(find('Івана хліб').hits).toHaveLength(21);
    expect(readLine('Івана три шістнадцять', uk)).toMatchObject({ kind: 'place', bookId: 'John', chapter: 3, verse: 16 });
  });

  it('finds words printed with stress marks: «пастир» in «Па́стир»', () => {
    const shepherd = find('мій пастир').hits.map((hit) => `${hit.book} ${hit.chapter}:${hit.verse}`);
    expect(shepherd).toContain('Psalms 22:1');
  });

  it('one letter: «Іл_я» finds both spellings', () => {
    expect(find('Іл_я').forms).toEqual(expect.arrayContaining(['ілля', 'ілія']));
  });
});
