import { ScriptureReference } from '@/models/models';
import { getBookByName, getBookByWrittenName, getBookIds } from '@/utils/bibleBooks';

import type { AppLocale } from '@/utils/appLocale';

type BookMatch = { book: string; remaining: string[] };

/**
 * Book aliases for quick parsing of user input.
 * Includes Russian and Ukrainian variations.
 */
const ORDERED_BOOKS: Array<{ english: string; aliases: string[] }> = [
  // Old Testament - Pentateuch
  { english: 'Genesis', aliases: ['бытие', 'книга бытие', 'быт', 'буття', 'бут'] },
  { english: 'Exodus', aliases: ['исход', 'книга исход', 'исх', 'исхода', 'вихід', 'вих'] },
  { english: 'Leviticus', aliases: ['левит', 'книга левит', 'лев'] },
  { english: 'Numbers', aliases: ['числа', 'книга числа', 'чис'] },
  { english: 'Deuteronomy', aliases: ['второзаконие', 'второзакония', 'книга второзакония', 'втор', 'второзак', 'повторення закону', 'повт'] },
  // Historical
  { english: 'Joshua', aliases: ['иисус навин', 'книга иисуса навина', 'навин', 'нав', 'ісус навин', 'і.нав'] },
  { english: 'Judges', aliases: ['судьи', 'книга судей', 'судья', 'суд', 'суддів'] },
  { english: 'Ruth', aliases: ['руфь', 'книга руфь', 'руф', 'рут'] },
  // Note: RU 1-2 Царств = EN 1-2 Samuel, UK 1-2 Самуїлова
  {
    english: '1 Samuel',
    aliases: ['1 царств', '1-я книга царств', 'первая книга царств', '1 сам', '1сам', '1 цар', '1цар', '1 самуїлова'],
  },
  {
    english: '2 Samuel',
    aliases: ['2 царств', '2-я книга царств', 'вторая книга царств', '2 сам', '2сам', '2 цар', '2цар', '2 самуїлова'],
  },
  // Note: RU 3-4 Царств = EN 1-2 Kings, UK 1-2 Царів
  {
    english: '1 Kings',
    aliases: ['3 царств', '3-я книга царств', 'третья книга царств', '3 цар', '3цар', '1 царів'],
  },
  {
    english: '2 Kings',
    aliases: ['4 царств', '4-я книга царств', 'четвертая книга царств', '4 цар', '4цар', '2 царів'],
  },
  {
    english: '1 Chronicles',
    aliases: ['1 паралипоменон', '1-я книга паралипоменон', 'первая книга паралипоменон', '1 пар', '1пар', '1 хроніки', '1хр'],
  },
  {
    english: '2 Chronicles',
    aliases: ['2 паралипоменон', '2-я книга паралипоменон', 'вторая книга паралипоменон', '2 пар', '2пар', '2 хроніки', '2хр'],
  },
  { english: 'Ezra', aliases: ['ездра', 'книга ездра', 'ез', 'езд'] },
  { english: 'Nehemiah', aliases: ['неемия', 'книга неемии', 'неем', 'неемія'] },
  { english: 'Esther', aliases: ['есфирь', 'книга есфири', 'эстирь', 'есф', 'естер', 'ест'] },
  // Wisdom/Poetry
  { english: 'Job', aliases: ['иов', 'книга иова', 'йов'] },
  { english: 'Psalms', aliases: ['псалтирь', 'пс', 'псал', 'псалми', 'псалом', 'псалмы', 'psalm'] },
  { english: 'Proverbs', aliases: ['притчи', 'поу́чения', 'притч', 'притчи соломоновы', 'прит', 'приповістки', 'прип'] },
  { english: 'Ecclesiastes', aliases: ['екклесиаст', 'проповедник', 'екк', 'ек', 'екклезіяст', 'еккл'] },
  { english: 'Song of Solomon', aliases: ['песнь песней', 'песнь-песней', 'песн', 'песнь', 'пісня пісень', 'пісн'] },
  // Major Prophets
  { english: 'Isaiah', aliases: ['исаия', 'книга исаии', 'ис', 'ісая', 'іс'] },
  { english: 'Jeremiah', aliases: ['иеремия', 'книга иеремии', 'иер', 'єремія', 'єр'] },
  { english: 'Lamentations', aliases: ['плач иеремии', 'плач', 'плач єремії'] },
  { english: 'Ezekiel', aliases: ['иезекииль', 'книга иезекииля', 'иезекий', 'иез', 'єзекіїль', 'єз'] },
  { english: 'Daniel', aliases: ['даниил', 'книга даниила', 'дан', 'даниїл'] },
  // Minor Prophets
  { english: 'Hosea', aliases: ['осия', 'книга осии', 'ос', 'осія'] },
  { english: 'Joel', aliases: ['иоиль', 'книга иоиля', 'иоил', 'йоїл'] },
  { english: 'Amos', aliases: ['амос', 'книга амоса', 'ам'] },
  { english: 'Obadiah', aliases: ['авдий', 'обадия', 'авд', 'овдій', 'овд'] },
  { english: 'Jonah', aliases: ['иона', 'книга ионы', 'ион', 'йона', 'йон'] },
  { english: 'Micah', aliases: ['михей', 'книга михея', 'мик', 'мих'] },
  { english: 'Nahum', aliases: ['наум', 'книга наума', 'нам'] },
  { english: 'Habakkuk', aliases: ['аввакум', 'книга аввакума', 'авв', 'авакум', 'авк'] },
  { english: 'Zephaniah', aliases: ['софония', 'книга софонии', 'соф', 'софонія'] },
  { english: 'Haggai', aliases: ['аггей', 'книга аггея', 'агг', 'огій', 'ог'] },
  { english: 'Zechariah', aliases: ['захария', 'книга захарии', 'зах', 'захарія'] },
  { english: 'Malachi', aliases: ['малахия', 'книга малахии', 'мал', 'малахія'] },
  // Gospels
  {
    english: 'Matthew',
    aliases: ['матфей', 'евангелие от матфея', 'евангелие матфея', 'матф', 'мат', 'матфея', 'від матвія', 'мт'],
  },
  {
    english: 'Mark',
    aliases: ['марк', 'евангелие от марка', 'евангелие марка', 'марк', 'мар', 'мк', 'марка', 'від марка', 'мр'],
  },
  {
    english: 'Luke',
    aliases: ['лука', 'евангелие от луки', 'евангелие луки', 'лк', 'лук', 'луки', 'від луки'],
  },
  {
    english: 'John',
    aliases: ['иоанн', 'иоанна', 'от иоанна', 'евангелие от иоанна', 'евангелие иоанна', 'иоанн', 'иоан', 'ин', 'від івана', 'ів'],
  },
  // History
  { english: 'Acts', aliases: ['деяния', 'деяния апостолов', 'дея', 'деян', 'дії'] },
  // Pauline Epistles
  { english: 'Romans', aliases: ['римлянам', 'послание к римлянам', 'рим', 'до римлян'] },
  {
    english: '1 Corinthians',
    aliases: ['1 коринфянам', '1-е послание к коринфянам', 'первое послание к коринфянам', '1 кор', '1кор', '1 коринтян'],
  },
  {
    english: '2 Corinthians',
    aliases: ['2 коринфянам', '2-е послание к коринфянам', '2 кор', '2кор', '2 коринтян'],
  },
  { english: 'Galatians', aliases: ['галатам', 'послание к галатам', 'гал', 'до галатів'] },
  { english: 'Ephesians', aliases: ['ефесянам', 'послание к ефесянам', 'ефес', 'еф', 'до ефесян'] },
  {
    english: 'Philippians',
    aliases: ['филиппийцам', 'послание к филиппийцам', 'филип', 'филп', 'флп', "до филип'ян"],
  },
  {
    english: 'Colossians',
    aliases: ['колоссянам', 'послание к колоссянам', 'колос', 'кол', 'до колосян'],
  },
  {
    english: '1 Thessalonians',
    aliases: ['1 фессалоникийцам', '1-е послание к фессалоникийцам', '1 фес', '1фес', '1фс', '1 солунян', '1сол'],
  },
  {
    english: '2 Thessalonians',
    aliases: ['2 фессалоникийцам', '2-е послание к фессалоникийцам', '2 фес', '2фес', '2фс', '2 солунян', '2сол'],
  },
  {
    english: '1 Timothy',
    aliases: ['1 тимофею', '1-е послание к тимофею', '1 тим', '1тим', '1т', '1 тимофія'],
  },
  {
    english: '2 Timothy',
    aliases: ['2 тимофею', '2-е послание к тимофею', '2 тим', '2тим', '2т', '2 тимофія'],
  },
  { english: 'Titus', aliases: ['титу', 'послание к титу', 'тит', 'до тита'] },
  { english: 'Philemon', aliases: ['филимону', 'послание к филимону', 'филим', 'фил', 'флм', 'до филимона'] },
  // General Epistles
  { english: 'Hebrews', aliases: ['евреям', 'послание к евреям', 'евр', 'до євреїв', 'євр'] },
  { english: 'James', aliases: ['якову', 'послание иакову', 'иакову', 'иак', 'иа', 'якова', 'як'] },
  { english: '1 Peter', aliases: ['1 петра', '1-е послание петра', '1 пет', '1пет', '1п', '1пт'] },
  { english: '2 Peter', aliases: ['2 петра', '2-е послание петра', '2 пет', '2пет', '2п', '2пт'] },
  {
    english: '1 John',
    aliases: ['1 иоанна', '1-е послание иоанна', '1 иоан', '1иоан', '1и', '1 івана', '1ів'],
  },
  {
    english: '2 John',
    aliases: ['2 иоанна', '2-е послание иоанна', '2 иоан', '2иоан', '2и', '2 івана', '2ів'],
  },
  {
    english: '3 John',
    aliases: ['3 иоанна', '3-е послание иоанна', '3 иоан', '3иоан', '3и', '3 івана', '3ів'],
  },
  { english: 'Jude', aliases: ['иуде', 'иуда', 'иуды', 'послание иуде', 'послание иуды', 'иуд', 'иу', 'юди', 'юд'] },
  // Apocalypse
  {
    english: 'Revelation',
    aliases: ['откровение иоанна богослова', 'откровение', 'откр', 'отк', 'апокалипсис', "об'явлення", 'об'],
  },
];

const BOOK_ALIAS_ENTRIES = ORDERED_BOOKS.flatMap(({ english, aliases }) => {
  const normalizedEnglish = english.toLowerCase();
  const compactEnglish = normalizedEnglish.replace(/[^a-z0-9]/g, '');
  const aliasSet = new Set<string>([
    normalizedEnglish,
    english,
    compactEnglish,
    ...aliases.map((alias) => alias.toLowerCase()),
  ]);

  return Array.from(aliasSet).map((alias) => [alias, english] as [string, string]);
});

const BOOK_ALIASES = BOOK_ALIAS_ENTRIES.reduce<Record<string, string>>((acc, [alias, book]) => {
  acc[alias] = book;
  return acc;
}, {});

export const getReferenceBookAliases = (): string[] => Array.from(new Set(BOOK_ALIAS_ENTRIES.map(([alias]) => alias)));

const normalizeInput = (raw: string): { dashNormalized: string; normalized: string } => {
  const dashNormalized = raw.replace(/[–—−‒‑﹘﹣]/g, '-');
  const normalized = dashNormalized.replace(/[:,.;]/g, ' ');
  return { dashNormalized, normalized };
};

const splitTokensNaive = (normalized: string): string[] =>
  normalized
    .split(/\s+/)
    .flatMap((token) =>
      token
        .split('-')
        .map((segment) => segment.trim())
        .filter(Boolean)
    )
    .filter(Boolean);

const splitTokensPreservingHyphen = (normalized: string): string[] => normalized.split(/\s+/).filter(Boolean);

const countNumericTokens = (tokens: string[]): number => {
  let count = 0;
  for (const token of tokens) {
    if (/^\d+(-\d+)?$/.test(token)) {
      count += 1;
    }
  }
  return count;
};

const resolveParsingTokens = ({
  normalized,
  dashNormalized,
  allTokensNaive,
  tokensPreservingHyphen,
}: {
  normalized: string;
  dashNormalized: string;
  allTokensNaive: string[];
  tokensPreservingHyphen: string[];
}): { tokens: string[]; isChapterRangeFormat: boolean; rangeMatch: RegExpMatchArray | null } => {
  const rangeMatch = dashNormalized.match(/(\d+)\s*-\s*(\d+)$/);
  const hasRange = rangeMatch !== null;
  const numericTokenCount = countNumericTokens(tokensPreservingHyphen);

  if (hasRange && numericTokenCount === 1) {
    const beforeRange = normalized.replace(/\d+\s*-\s*\d+$/, '').trim();
    return {
      tokens: beforeRange.split(/\s+/).filter(Boolean),
      isChapterRangeFormat: true,
      rangeMatch,
    };
  }

  return { tokens: allTokensNaive, isChapterRangeFormat: false, rangeMatch };
};

const exactBookOf = (input: string, locale?: AppLocale): string | null => {
  // The language it is written in first: "1Цар" is 1 Samuel in Russian and 1 Kings in Ukrainian.
  const own = locale ? getBookByWrittenName(input, locale) : undefined;
  if (own) return own.id;

  const direct = BOOK_ALIASES[input.toLowerCase()];
  if (direct) return direct;

  // Try bibleData lookup (supports all locales)
  const bookInfo = getBookByName(input);
  if (bookInfo) return bookInfo.id;

  // As people write it: "1 Ин" for "1Ин", "1Иоанна" for "1 Иоанна", "И Нав" for "И.Нав" (dots are spaces by now).
  return getBookByWrittenName(input)?.id ?? null;
};

/**
 * The book a name is written for — a book's name, its abbreviation or a known alias, as people write
 * it ("Рим.", "1 Пар", "Песнь-Песней") — and never a guess from its first letters: in prose "A" and
 * "Is" are words, not Amos and Isaiah. The reference field keeps that guess (`parseReferenceText`).
 */
export function exactBook(name: string, locale?: AppLocale): string | null {
  const words = nameWords(name);
  return words ? exactBookOf(words, locale) : null;
}

/** A book's name as its words, the way names are kept: dashes and dots are spaces ("Песнь-Песней", "Рим."). */
const nameWords = (name: string): string => name.replace(/[–—−‒‑﹘﹣]/g, '-').replace(/[:,.;]/g, ' ').split(/[\s-]+/).filter(Boolean).join(' ');

/**
 * The languages whose own names and abbreviations write a book so: "Ps" English alone, "Иоил" Russian,
 * "Йоїл" Ukrainian, "Пс" and "1Цар" both Russian and Ukrainian. A name only an alias knows gives none.
 */
export function bookNameLanguages(name: string): AppLocale[] {
  const words = nameWords(name);
  return words ? WRITING_LANGUAGES.filter((locale) => getBookByWrittenName(words, locale) !== undefined) : [];
}

/** Cyrillic first: a name Russian and Ukrainian share, read with nothing else to go by, is read as Russian. */
const WRITING_LANGUAGES: readonly AppLocale[] = ['ru', 'uk', 'en'];

const resolveBook = (input: string, locale?: AppLocale): BookMatch | null => {
  const exact = exactBookOf(input, locale);
  if (exact) return { book: exact, remaining: [] };

  // Fallback: find canonical book ID starting with input
  const normalized = input.toLowerCase();
  const found = getBookIds().find((id) => id.toLowerCase().startsWith(normalized));
  if (found) return { book: found, remaining: [] };

  return null;
};

type ParsedReference = Omit<ScriptureReference, 'id'>;

const resolveBookFromTokens = (
  tokens: string[],
  locale?: AppLocale
): {
  matched: BookMatch;
  consumed: number;
} | null => {
  const maybeBookParts: string[] = [];
  const maxBookTokens = Math.min(4, tokens.length);
  for (let i = 1; i <= maxBookTokens; i += 1) {
    maybeBookParts.push(tokens.slice(0, i).join(' '));
  }

  let matched: BookMatch | null = null;
  let consumed = 0;
  for (let i = maybeBookParts.length - 1; i >= 0; i -= 1) {
    const candidate = maybeBookParts[i];
    const res = resolveBook(candidate, locale);
    if (res) {
      matched = res;
      consumed = i + 1;
      break;
    }
  }

  if (!matched) return null;
  return { matched, consumed };
};

const parseChapterRangeReference = (book: string, rangeMatch: RegExpMatchArray): ParsedReference | null => {
  const fromChapter = Number(rangeMatch[1]);
  const toChapter = Number(rangeMatch[2]);

  if (isNaN(fromChapter) || isNaN(toChapter) || fromChapter <= 0 || toChapter <= 0) {
    return null;
  }

  return {
    book,
    chapter: fromChapter,
    toChapter,
  };
};

const buildReferenceFromNumbers = (book: string, numbers: number[]): ParsedReference | null => {
  if (numbers.length === 0) {
    return { book };
  }

  if (numbers.some((n) => Number.isNaN(n) || n <= 0)) return null;

  const [chapter, fromVerse, maybeTo] = numbers;

  if (numbers.length === 1) {
    return {
      book,
      chapter,
    };
  }

  if (!chapter || !fromVerse) return null;

  const parsed: ParsedReference = {
    book,
    chapter,
    fromVerse,
  };
  if (maybeTo && maybeTo >= fromVerse) {
    parsed.toVerse = maybeTo;
  }

  return parsed;
};

/**
 * Parse a Scripture reference string into structured data.
 * Supports multiple locales (en, ru, uk) with localized book names and abbreviations.
 *
 * The numbers are read as written: "Пс 22" is chapter 22 of whichever Bible the person reads.
 * Which Bible that is the caller says, by the `bible` it stores with the result
 * (`referenceBibleFor`); showing it in another Bible is `utils/scriptureReferenceNumbering.ts`.
 *
 * Supported formats:
 * - Book only: "Ezekiel", "Иезекииль" -> { book: "Ezekiel" }
 * - Chapter only: "Пс 23", "Romans 8" -> { book: "Psalms", chapter: 23 }
 * - Chapter range: "Мф 5-7", "Matthew 5-7" -> { book: "Matthew", chapter: 5, toChapter: 7 }
 * - Verse: "Ин 3:16" -> { book: "John", chapter: 3, fromVerse: 16 }
 * - Verse range: "Ис 4:5-8" -> { book: "Isaiah", chapter: 4, fromVerse: 5, toVerse: 8 }
 *
 * @param raw - The raw reference string
 * @param options.locale - The language it is written in, when known: an abbreviation two languages
 *   share ("1Цар") is read in it. Without it the Russian reading of such an abbreviation stays.
 */
export function parseReferenceText(raw: string, options: { locale?: AppLocale } = {}): ParsedReference | null {
  const { dashNormalized, normalized } = normalizeInput(raw);
  const allTokensNaive = splitTokensNaive(normalized);

  // Need at least 1 token for book-only references
  if (allTokensNaive.length < 1) return null;

  const tokensPreservingHyphen = splitTokensPreservingHyphen(normalized);
  const { tokens, isChapterRangeFormat, rangeMatch } = resolveParsingTokens({
    normalized,
    dashNormalized,
    allTokensNaive,
    tokensPreservingHyphen,
  });

  // Need at least 1 token for book-only references
  if (tokens.length < 1) return null;

  const matchResult = resolveBookFromTokens(tokens, options.locale);
  if (!matchResult) return null;
  const { matched, consumed } = matchResult;

  // Handle chapter range pattern
  if (isChapterRangeFormat && rangeMatch) {
    return parseChapterRangeReference(matched.book, rangeMatch);
  }

  // Get remaining numbers after book name
  const numbers = tokens.slice(consumed).map((t) => Number(t));

  return buildReferenceFromNumbers(matched.book, numbers);
}
