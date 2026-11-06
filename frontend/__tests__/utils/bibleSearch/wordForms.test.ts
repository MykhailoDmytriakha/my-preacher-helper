import { prepareWordForms } from '../../../test-utils/bibleWordForms';

prepareWordForms(["ru", "uk"]);

import fs from 'node:fs';
import path from 'node:path';

import { bookSequence, PROTESTANT_BOOKS, SYNODAL_BOOKS } from '@/components/bible/bookOrder';
import { readLine } from '@/utils/bibleSearch/query';
import { answerSearch } from '@/utils/bibleSearch/results';
import { BibleSearchIndex } from '@/utils/bibleSearch/searchIndex';
import { matcherOf, type SearchLanguage } from '@/utils/bibleSearch/wordForms';
import { bookSlug, type BookText } from '@/utils/bibleText';

const foreignWords = [
  ['ru', 'дело', 'для'],
  ['ru', 'вес', 'все'],
  ['ru', 'народ', 'нарда'],
  ['ru', 'вес', 'весь'],
  ['uk', 'народ', 'нарду'],
] as const;

const texts = (bible: 'rst' | 'ubio') => {
  const books = bible === 'rst' ? SYNODAL_BOOKS : PROTESTANT_BOOKS;
  const index = new BibleSearchIndex(bookSequence(books));
  for (const id of bookSequence(books)) {
    const file = path.join(__dirname, '../../../public/bible-text', bible, 'v1', `${bookSlug(id)}.json`);
    index.addBook(JSON.parse(fs.readFileSync(file, 'utf8')) as BookText);
  }
  return { index, books, bible };
};
const indexes = { ru: texts('rst'), uk: texts('ubio') };

// BUG-20261027-search-delo-finds-dlya: letters that can alternate somewhere do not establish one word.
describe('inflections retain the searched word', () => {
  it.each(foreignWords)('%s: %s does not accept the different word %s as an inflection', (language, term, other) => {
    expect(matcherOf(term, language).test(other)).toBe(false);
  });

  it.each(foreignWords)('%s: a full Bible search for %s does not advertise %s as a form', (language, term, other) => {
    const { index, books, bible } = indexes[language];
    const reading = readLine(term, { bible, books, asWords: true });
    if (reading.kind !== 'search') throw new Error('Expected an ordinary word search');
    const result = answerSearch(index, reading.query, books);
    expect(result.forms).not.toContain(other);
  });

  it.each([
    ['ru', 'Mark', 14, 3],
    ['uk', 'John', 12, 3],
  ] as const)('%s: a search for people excludes the unrelated perfume verse %s %i:%i even beyond the form preview', (language, book, chapter, verse) => {
    const { index, books, bible } = indexes[language];
    const reading = readLine('народ', { bible, books, asWords: true });
    if (reading.kind !== 'search') throw new Error('Expected an ordinary word search');
    const text = index.verseText(book, chapter, verse);
    expect(text).toMatch(language === 'ru' ? /нарда/u : /на́рду/u);
    expect(text).not.toMatch(/народ/u);
    expect(answerSearch(index, reading.query, books).hits).not.toEqual(expect.arrayContaining([expect.objectContaining({ book, chapter, verse })]));
  });

  it('uses the lexicon as admission, without adding candidates from another reading', () => {
    expect(matcherOf('дело', 'ru').test('день')).toBe(false);
  });

  it('retains regular unknown-name endings but does not invent a vowel for an unknown word', () => {
    expect(matcherOf('авиафар', 'ru').test('авиафара')).toBe(true);
    expect(matcherOf('авиафара', 'ru').test('авиафар')).toBe(true);
    expect(matcherOf('ззрок', 'ru').test('ззрка')).toBe(false);
  });

  it('keeps a very long unrecognized word literal without breaking lookup', () => {
    const term = 'н'.repeat(100000);
    const matcher = matcherOf(term, 'ru');
    expect(matcher.test(term)).toBe(true);
    expect(matcher.test('народ')).toBe(false);
  });

  it.each<[SearchLanguage, string, string]>([
    ['ru', 'отец', 'отца'], ['ru', 'отца', 'отец'],
    ['ru', 'сон', 'сна'], ['ru', 'любовь', 'любви'], ['ru', 'любви', 'любовь'],
    ['uk', 'отець', 'отця'], ['uk', 'отця', 'отець'], ['uk', 'сон', 'сну'],
    ['en', 'love', 'loveth'], ['en', 'loveth', 'love'],
  ])('%s: %s still accepts its useful form %s', (language, term, form) => {
    expect(matcherOf(term, language).test(form)).toBe(true);
  });
});
