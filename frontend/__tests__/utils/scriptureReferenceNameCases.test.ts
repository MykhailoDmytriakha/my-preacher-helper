import { SYNODAL_BOOKS, PROTESTANT_BOOKS } from '@/components/bible/bookOrder';
import { extractBookIdsFromVerse } from '@/components/calendar/calendarAnalytics';
import { referencesInText, leadingReference, referenceFromTyped } from '@/utils/bibleLink';
import { withoutApostrophe } from '@/utils/bibleBooks';
import { readLine } from '@/utils/bibleSearch/query';
import { normalizeSpokenScriptureReferences, normalizeScriptureReferencesForTts } from '@/utils/scriptureReferenceNormalizer';
import { exactBook, parseReferenceText, bookNameLanguages, getReferenceBookAliases } from '@/utils/scriptureReferenceParser';

import type { AppLocale } from '@/utils/appLocale';

const cases: Array<[string, string, string, AppLocale, number, number]> = [
  ['Исаии 53:5', 'Исаия 53:5', 'Isaiah', 'ru', 53, 5],
  ['Иеремии 29:11', 'Иеремия 29:11', 'Jeremiah', 'ru', 29, 11],
  ['Даниила 3:1', 'Даниил 3:1', 'Daniel', 'ru', 3, 1],
  ['Иезекииля 36:26', 'Иезекииль 36:26', 'Ezekiel', 'ru', 36, 26],
  ['Ісаї 53:5', 'Ісая 53:5', 'Isaiah', 'uk', 53, 5],
  ['Єремії 29:11', 'Єремія 29:11', 'Jeremiah', 'uk', 29, 11],
  ['Плача Иеремии 3:22', 'Плач Иеремии 3:22', 'Lamentations', 'ru', 3, 22],
  ['Об’явленні 1:1', "Об'явлення 1:1", 'Revelation', 'uk', 1, 1],
  ['1 Иоанну 3:16', '1 Иоанна 3:16', '1 John', 'ru', 3, 16],
];
const nameOf = (value: string) => value.replace(/\s+\d+(?::\d+)?$/, '');

describe('one complete book name across Scripture readers', () => {
  it.each(cases)('parses the exact name in %s without borrowing search prefix guesses', (raw, _plain, book, locale, chapter, verse) => {
    expect(exactBook(nameOf(raw), locale)).toBe(book);
    expect(parseReferenceText(raw, { locale })).toMatchObject({ book, chapter, fromVerse: verse });
  });

  it.each(cases)('keeps the written language of %s independently of the interface', (raw, _plain, book, locale, chapter, verse) => {
    expect(bookNameLanguages(nameOf(raw))).toContain(locale);
    const written = locale === 'ru' ? 'uk' : 'ru';
    expect(referenceFromTyped(raw, { locale: 'en', written })).toMatchObject({ book, chapter, fromVerse: verse, bible: locale === 'ru' ? 'rst' : 'ubio' });
  });

  it.each(cases)('links the whole %s and opens it from the beginning of prose', (raw, _plain, book, locale, chapter, verse) => {
    const text = 'QA '+raw+'; QA.';
    const matches = referencesInText(text, locale);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ raw, start: 3, end: 3+raw.length, reference: { book, chapter, fromVerse: verse } });
    expect(leadingReference(raw+'; QA.', { locale })?.reference).toMatchObject({ book, chapter, fromVerse: verse });
  });

  it.each(cases)('counts %s once in the same calendar book and search destination', (raw, _plain, book, locale, chapter, verse) => {
    expect(extractBookIdsFromVerse(raw, locale)).toEqual([book]);
    expect(extractBookIdsFromVerse(raw+'; '+raw, locale)).toEqual([book]);
    expect(readLine(raw, { bible: locale === 'ru' ? 'rst' : 'ubio', books: locale === 'ru' ? SYNODAL_BOOKS : PROTESTANT_BOOKS })).toMatchObject({ kind: 'place', bookId: book, chapter, verse });
  });

  it.each(cases)('uses the same name vocabulary for normalized prose and speech in %s', (raw, plain, _book, locale) => {
    expect(getReferenceBookAliases().some(alias => withoutApostrophe(alias).toLowerCase() === withoutApostrophe(nameOf(raw)).toLowerCase())).toBe(true);
    const prefix = locale === 'uk' ? 'Сьогодні: ' : '';
    const normalized = normalizeSpokenScriptureReferences(prefix+raw);
    expect(normalized).toBe(normalizeSpokenScriptureReferences(prefix+plain));
    expect(normalized).not.toBe(prefix+raw);
    // Speech currently expands Russian references only; name recognition does not change that policy.
    if (locale === 'uk') {
      expect(normalizeScriptureReferencesForTts(prefix+raw)).toBe(prefix+raw);
      return;
    }
    const speech = normalizeScriptureReferencesForTts(raw);
    expect(speech).toBe(normalizeScriptureReferencesForTts(plain));
    expect(speech).not.toBe(raw);
  });

  it.each(['суда 5', 'луком 5', 'марки 5', 'marking 5', 'acting 5', 'закона 5'])('keeps ordinary %s outside the book grammar', raw => {
    expect(exactBook(nameOf(raw), 'ru')).toBeNull();
    expect(referencesInText(raw, 'ru')).toEqual([]);
    expect(extractBookIdsFromVerse(raw, 'ru')).toEqual([]);
    expect(normalizeSpokenScriptureReferences(raw)).toBe(raw);
    expect(readLine(raw, { bible: 'rst', books: SYNODAL_BOOKS }).kind).toBe('search');
  });

  it('does not turn a person age into a reference after admitting the name', () => {
    expect(referencesInText('Исаии 3 года; Даниила 5 лет.', 'ru')).toEqual([]);
  });

  it.each([['Isaiah 53:5', 'en', 'Isaiah'], ['Исаия 53:5', 'ru', 'Isaiah'], ['Ісая 53:5', 'uk', 'Isaiah']] as const)('retains the original written name %s', (raw, locale, book) => {
    expect(parseReferenceText(raw, { locale })?.book).toBe(book);
    expect(referencesInText(raw, locale)[0]?.reference.book).toBe(book);
  });

  it.each([['ru', '1 Samuel'], ['uk', '1 Kings']] as const)('preserves the existing %s meaning of a shared exact abbreviation', (locale, book) => {
    expect(parseReferenceText('1 Цар 3:5', { locale })?.book).toBe(book);
  });

  it('does not turn the first word of a compound title into a standalone book name', () => {
    expect(exactBook('Иисуса', 'ru')).toBeNull();
    expect(referencesInText('Иисуса 3:16', 'ru')).toEqual([]);
    expect(normalizeSpokenScriptureReferences('Иисуса 3:16')).toBe('Иисуса 3:16');
  });

  it('preserves a numbered name with and without the written space', () => {
    expect(parseReferenceText('1Иоанну 3:16', { locale: 'ru' })).toMatchObject({ book: '1 John', chapter: 3, fromVerse: 16 });
    expect(normalizeSpokenScriptureReferences('1Иоанну 3:16')).toBe(normalizeSpokenScriptureReferences('1 Иоанна 3:16'));
  });

  it('prepares a declined book name in an already-supported Russian spoken reference', () => {
    expect(normalizeSpokenScriptureReferences('Исаии 53 глава 5 стих')).toBe('Ис. 53:5');
  });

  it('keeps first-letter suggestions in search without admitting them to prose', () => {
    expect(exactBook('иса', 'ru')).toBeNull();
    expect(referencesInText('иса 53:5', 'ru')).toEqual([]);
    expect(readLine('иса 53:5', { bible: 'rst', books: SYNODAL_BOOKS })).toMatchObject({ kind: 'place', bookId: 'Isaiah', chapter: 53, verse: 5 });
  });
});
