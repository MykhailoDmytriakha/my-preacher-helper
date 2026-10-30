import { PROTESTANT_BOOKS } from '@/components/bible/bookOrder';
import { readLine } from '@/utils/bibleSearch/query';
import { digitsForNumberWords, ordinalOf } from '@/utils/bibleSearch/numberWords';
import { normalizeWord, wordsOfText } from '@/utils/bibleSearch/words';

const en = { bible: 'kjv' as const, books: PROTESTANT_BOOKS };
const words = (text: string): string[] => wordsOfText(text);
const digits = (text: string): string[] => digitsForNumberWords(words(text));

/**
 * Regression for full ordinal words and the existing number-reader contract.
 * These checks cover pure normalization/number parsing and `readLine` behavior only. They do not prove
 * browser rendering, Enter navigation, installed or production behavior, or server-side normalization.
 */
describe('ordinalOf — Ukrainian tens missing from the ordinal table', () => {
  it.each([
    { said: 'П’ятдесятий', normalized: 'пятдесятий', ordinal: 50 },
    { said: "п'ятдесятого", normalized: 'пятдесятого', ordinal: 50 },
    { said: 'шістдесятий', normalized: 'шістдесятий', ordinal: 60 },
    { said: 'сімдесятий', normalized: 'сімдесятий', ordinal: 70 },
    { said: 'вісімдесятий', normalized: 'вісімдесятий', ordinal: 80 },
    { said: 'Шістдесята', normalized: 'шістдесята', ordinal: 60 },
    { said: 'Сімдесяте', normalized: 'сімдесяте', ordinal: 70 },
    { said: 'Вісімдесятого', normalized: 'вісімдесятого', ordinal: 80 },
  ])('$said normalizes to $normalized and means $ordinal', ({ said, normalized, ordinal }) => {
    const normalizedWord = words(said)[0];
    expect(normalizeWord(said)).toBe(normalized);
    expect(ordinalOf(normalizedWord)).toBe(ordinal);
  });
});

describe('ordinalOf — English tens and hundred', () => {
  it.each([
    { said: 'sixtieth', ordinal: 60 },
    { said: 'seventieth', ordinal: 70 },
    { said: 'eightieth', ordinal: 80 },
    { said: 'ninetieth', ordinal: 90 },
    { said: 'hundredth', ordinal: 100 },
  ])('$said means $ordinal', ({ said, ordinal }) => {
    expect(ordinalOf(words(said)[0])).toBe(ordinal);
  });

  it('converts “one hundredth” to 100', () => {
    expect(digits('one hundredth')).toEqual(['100']);
  });
});

describe('digitsForNumberWords — existing composition and control words', () => {
  it.each([
    { said: 'двадцать третий', expected: ['23'] },
    { said: 'двадцать третий шестнадцать', expected: ['23', '16'] },
    { said: 'сороковий', expected: ['40'] },
    { said: 'дев’яностий', expected: ['90'] },
    { said: 'сотий', expected: ['100'] },
    { said: 'twenty first', expected: ['21'] },
    { said: 'one hundred nineteen', expected: ['119'] },
    { said: 'one hundred seventy six', expected: ['176'] },
    { said: 'сто девятнадцать', expected: ['119'] },
    { said: 'один сто', expected: ['1', '100'] },
  ])('$said becomes $expected', ({ said, expected }) => {
    expect(digits(said)).toEqual(expected);
  });

  it.each([
    { said: 'one hundred and nineteenth', expected: ['100', 'and', '19'] },
    { said: 'one hundred and seventy six', expected: ['100', 'and', '76'] },
    { said: 'faith and peace', expected: ['faith', 'and', 'peace'] },
  ])('$said keeps non-number words and conjunctions as written', ({ said, expected }) => {
    expect(digits(said)).toEqual(expected);
  });

  it('ends an ordinal number before the next verse number', () => {
    expect(digits('one hundred nineteenth one hundred seventy six')).toEqual(['119', '176']);
  });
});

describe('readLine — ordinal chapter and following verse', () => {
  it.each([
    { said: 'Псалом п’ятдесятий', chapter: 50 },
    { said: 'Псалом шістдесятий', chapter: 60 },
    { said: 'Псалом сімдесятий', chapter: 70 },
    { said: 'Псалом вісімдесятий', chapter: 80 },
    { said: 'Psalm sixtieth', chapter: 60 },
    { said: 'Psalm seventieth', chapter: 70 },
    { said: 'Psalm eightieth', chapter: 80 },
    { said: 'Psalm ninetieth', chapter: 90 },
    { said: 'Psalm hundredth', chapter: 100 },
    { said: 'Psalm one hundredth', chapter: 100 },
    { said: 'Psalm seventy-sixth', chapter: 76 },
    { said: 'Psalm one hundred nineteenth one hundred seventy six', chapter: 119, verse: 176 },
  ])('$said reads the chapter and verse as a place', ({ said, chapter, verse }) => {
    expect(readLine(said, en)).toMatchObject({
      kind: 'place',
      bookId: 'Psalms',
      chapter,
      verse: verse ?? null,
    });
  });

  it('keeps an explicitly written verse range', () => {
    expect(readLine('Psalm 3:5-7', en)).toMatchObject({
      kind: 'place',
      bookId: 'Psalms',
      chapter: 3,
      verse: 5,
      toVerse: 7,
    });
  });
});

/*
 * Test boundary: a green Jest result here proves only the pure functions and readLine unit contract in
 * this process. It does not prove that a built app was opened, the browser showed this preview, Enter
 * navigated to Psalms N:1, or the verse was visible in the reader.
 */

// Whole unknown words must stay words, even when their beginning resembles an ordinal.
describe('ordinal word boundaries', () => {
  it.each(['пятдесятирічний', 'шістдесятийрік', 'сімдесятиріччя', 'вісімдесятилітній', 'sixtieths', 'hundredths'])('keeps %s as an ordinary word', said => {
    expect(ordinalOf(normalizeWord(said))).toBeNull();
    expect(digits(said)).toEqual([normalizeWord(said)]);
  });
});
