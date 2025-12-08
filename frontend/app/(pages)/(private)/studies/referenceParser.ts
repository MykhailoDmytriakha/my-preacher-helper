import { ScriptureReference } from '@/models/models';
import { getBookByName, getBookIds, BibleLocale, psalmSeptuagintToHebrew } from './bibleData';

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
  { english: 'Deuteronomy', aliases: ['второзаконие', 'книга второзакония', 'втор', 'второзак', 'повторення закону', 'повт'] },
  // Historical
  { english: 'Joshua', aliases: ['иисус навин', 'книга иисуса навина', 'навин', 'ісус навин', 'і.нав'] },
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
  { english: 'Psalms', aliases: ['псалтирь', 'пс', 'псал', 'псалми'] },
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
    aliases: ['иоанн', 'евангелие от иоанна', 'евангелие иоанна', 'иоанн', 'иоан', 'ин', 'від івана', 'ів'],
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
  { english: 'Jude', aliases: ['иуде', 'послание иуде', 'иуд', 'иу', 'юди', 'юд'] },
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

const resolveBook = (input: string): BookMatch | null => {
  const normalized = input.toLowerCase();
  const direct = BOOK_ALIASES[normalized];
  if (direct) return { book: direct, remaining: [] };

  // Try bibleData lookup (supports all locales)
  const bookInfo = getBookByName(input);
  if (bookInfo) return { book: bookInfo.id, remaining: [] };

  // Fallback: find canonical book ID starting with input
  const bookIds = getBookIds();
  const found = bookIds.find((id) => id.toLowerCase().startsWith(normalized));
  if (found) return { book: found, remaining: [] };

  return null;
};

type ParsedReference = Omit<ScriptureReference, 'id'>;

/**
 * Parse a Scripture reference string into structured data.
 * Supports multiple locales (en, ru, uk) with localized book names and abbreviations.
 *
 * IMPORTANT: For Psalms, the chapter number is converted from the user's locale numbering
 * to the standard Hebrew/Protestant numbering for storage.
 * - EN uses Hebrew numbering (stored as-is)
 * - RU/UK use Septuagint numbering (converted to Hebrew for storage)
 *
 * Supported formats:
 * - Book only: "Ezekiel", "Иезекииль" -> { book: "Ezekiel" }
 * - Chapter only: "Пс 23", "Romans 8" -> { book: "Psalms", chapter: 24 }
 * - Chapter range: "Мф 5-7", "Matthew 5-7" -> { book: "Matthew", chapter: 5, toChapter: 7 }
 * - Verse: "Ин 3:16" -> { book: "John", chapter: 3, fromVerse: 16 }
 * - Verse range: "Ис 4:5-8" -> { book: "Isaiah", chapter: 4, fromVerse: 5, toVerse: 8 }
 *
 * @param raw - The raw reference string
 * @param locale - The user's locale for proper Psalm numbering conversion
 */
export function parseReferenceText(raw: string, locale?: BibleLocale): ParsedReference | null {
  // Normalize separators and dash variants (e.g., en/em dash) to a standard hyphen
  const dashNormalized = raw.replace(/[–—−‒‑﹘﹣]/g, '-');
  const normalized = dashNormalized.replace(/[:,.;]/g, ' ');

  // First, split all tokens naively (splitting hyphens too)
  const allTokensNaive = normalized
    .split(/\s+/)
    .flatMap((token) =>
      token
        .split('-')
        .map((segment) => segment.trim())
        .filter(Boolean)
    )
    .filter(Boolean);

  // Need at least 1 token for book-only references
  if (allTokensNaive.length < 1) return null;

  // Count how many non-book tokens we'd have for format detection
  // This helps distinguish "book 5-7" (chapter range) from "book 4 5-6" (verse range)
  const rangeMatch = dashNormalized.match(/(\d+)\s*-\s*(\d+)$/);
  const hasRange = rangeMatch !== null;

  // Simpler approach: split first, then determine format
  // Split WITHOUT splitting on hyphen first to count numeric tokens
  const tokensPreservingHyphen = normalized.split(/\s+/).filter(Boolean);

  // Find how many tokens look like numbers (including hyphenated like "5-7")
  let numericTokenCount = 0;
  for (const token of tokensPreservingHyphen) {
    if (/^\d+(-\d+)?$/.test(token)) {
      numericTokenCount++;
    }
  }

  // Now split everything for book resolution
  let tokens: string[];
  let isChapterRangeFormat = false;

  // Chapter range format: exactly 1 numeric token that contains a hyphen (e.g., "book 5-7")
  // Verse range format: 2+ numeric tokens, last may contain hyphen (e.g., "book 4 5-6")
  if (hasRange && numericTokenCount === 1) {
    // This is a chapter range: "book 5-7"
    isChapterRangeFormat = true;
    const beforeRange = normalized.replace(/\d+\s*-\s*\d+$/, '').trim();
    tokens = beforeRange.split(/\s+/).filter(Boolean);
  } else {
    // Normal parsing - split hyphens to get individual numbers
    tokens = allTokensNaive;
  }

  // Need at least 1 token for book-only references
  if (tokens.length < 1) return null;

  // Try to match book name (1-4 tokens)
  const maybeBookParts: string[] = [];
  const maxBookTokens = Math.min(4, tokens.length);
  for (let i = 1; i <= maxBookTokens; i += 1) {
    maybeBookParts.push(tokens.slice(0, i).join(' '));
  }

  let matched: BookMatch | null = null;
  let consumed = 0;
  for (let i = maybeBookParts.length - 1; i >= 0; i -= 1) {
    const candidate = maybeBookParts[i];
    const res = resolveBook(candidate);
    if (res) {
      matched = res;
      consumed = i + 1;
      break;
    }
  }
  if (!matched) return null;

  // Handle chapter range pattern
  if (isChapterRangeFormat && rangeMatch) {
    let fromChapter = Number(rangeMatch[1]);
    let toChapter = Number(rangeMatch[2]);

    if (isNaN(fromChapter) || isNaN(toChapter) || fromChapter <= 0 || toChapter <= 0) {
      return null;
    }

    // Convert Psalm numbers for storage
    if (matched.book === 'Psalms' && locale && (locale === 'ru' || locale === 'uk')) {
      fromChapter = psalmSeptuagintToHebrew(fromChapter);
      toChapter = psalmSeptuagintToHebrew(toChapter);
    }

    return {
      book: matched.book,
      chapter: fromChapter,
      toChapter: toChapter,
    };
  }

  // Get remaining numbers after book name
  const numbers = tokens.slice(consumed).map((t) => Number(t));

  // Book-only reference (no numbers after book name)
  if (numbers.length === 0) {
    return { book: matched.book };
  }

  // Filter out invalid numbers
  if (numbers.some((n) => Number.isNaN(n) || n <= 0)) return null;

  let [chapter, fromVerse, maybeTo] = numbers;

  // Chapter-only reference (one number after book name)
  if (numbers.length === 1) {
    // Convert Psalm number for storage
    if (matched.book === 'Psalms' && locale && (locale === 'ru' || locale === 'uk')) {
      chapter = psalmSeptuagintToHebrew(chapter);
    }
    return {
      book: matched.book,
      chapter,
    };
  }

  // Verse reference (chapter and verse(s))
  if (!chapter || !fromVerse) return null;

  // Convert Psalm number from Septuagint (RU/UK) to Hebrew (EN) for storage
  if (matched.book === 'Psalms' && locale && (locale === 'ru' || locale === 'uk')) {
    chapter = psalmSeptuagintToHebrew(chapter);
  }

  const parsed: ParsedReference = {
    book: matched.book,
    chapter,
    fromVerse,
  };
  if (maybeTo && maybeTo >= fromVerse) {
    parsed.toVerse = maybeTo;
  }

  return parsed;
}

