import { BIBLE_BOOKS_DATA, getBookByName, getLocalizedBookName } from '@/(pages)/(private)/studies/bibleData';
import { formatScriptureRef } from '@/(pages)/(private)/studies/bookAbbreviations';
import { getReferenceBookAliases, parseReferenceText } from '@/(pages)/(private)/studies/referenceParser';

import type { BibleLocale } from '@/(pages)/(private)/studies/bibleData';

const REFERENCE_PREFIX = '(^|[\\s([{"\'«„“])';
const ORDINAL_SUFFIX = '(?:[-–—]?(?:я|й|ая|ый|ой|ое|го|му|м|ю|е|х))?';
const NUMBER = `(\\d+)${ORDINAL_SUFFIX}`;
const CHAPTER_WORDS = '(?:глава|главу|главе|главы|глав|chapter|chapters|chap\\.?)';
const VERSE_WORDS = '(?:стих(?:а|е|и|ов)?|verse(?:s)?|v\\.?)';
const RANGE_SEPARATOR = '(?:-|–|—|по|to|through)';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const localizedBookAliases = BIBLE_BOOKS_DATA.flatMap(({ names, abbrev }) => [
  names.en,
  names.ru,
  names.uk,
  abbrev.en,
  abbrev.ru,
  abbrev.uk,
]);

const aliasesPattern = getReferenceBookAliases()
  .concat(localizedBookAliases)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const COLON_REFERENCE_PATTERN = new RegExp(
  `${REFERENCE_PREFIX}(${aliasesPattern})\\s+${NUMBER}\\s*:\\s*${NUMBER}(?:\\s*${RANGE_SEPARATOR}\\s*${NUMBER})?`,
  'giu'
);

const SPOKEN_VERSE_REFERENCE_PATTERN = new RegExp(
  `${REFERENCE_PREFIX}(${aliasesPattern})\\s+${NUMBER}(?:\\s+${CHAPTER_WORDS})?\\s+(?:с\\s+)?${NUMBER}(?:\\s*${RANGE_SEPARATOR}\\s*${NUMBER})?(?:\\s+${VERSE_WORDS})?`,
  'giu'
);

const SPOKEN_CHAPTER_REFERENCE_PATTERN = new RegExp(
  `${REFERENCE_PREFIX}(${aliasesPattern})\\s+${NUMBER}\\s+${CHAPTER_WORDS}`,
  'giu'
);

const TTS_COLON_REFERENCE_PATTERN = new RegExp(
  `${REFERENCE_PREFIX}(${aliasesPattern})\\.?\\s+${NUMBER}\\s*:\\s*${NUMBER}(?:\\s*${RANGE_SEPARATOR}\\s*${NUMBER})?`,
  'giu'
);

type ParsedScriptureReference = NonNullable<ReturnType<typeof parseReferenceText>>;
type RussianOrdinalForm = 'masculine' | 'feminine' | 'genitiveMasculine';

const hasExplicitReferenceSignal = (value: string, verse?: string): boolean =>
  Boolean(verse) || /[:]|(?:^|\s)(?:глава|главу|главе|главы|глав|стих|стиха|стихе|стихи|стихов|chapter|chapters|chap\.?|verse|verses|v\.?)(?:\s|$)/iu.test(value);

const detectLocale = (value: string): BibleLocale => {
  if (/[іїєґ]/iu.test(value)) return 'uk';
  if (/[а-яё]/iu.test(value)) return 'ru';
  return 'en';
};

const formatReferenceForProse = (
  ref: NonNullable<ReturnType<typeof parseReferenceText>>,
  locale: BibleLocale
): string => {
  const formatted = formatScriptureRef(ref, locale);
  return locale === 'en'
    ? formatted.replace(/\.(?=\d)/u, ' ')
    : formatted.replace(/\.(?=\d)/u, '. ');
};

const RUSSIAN_ORDINAL_UNDER_20: Record<RussianOrdinalForm, Record<number, string>> = {
  masculine: {
    1: 'первый',
    2: 'второй',
    3: 'третий',
    4: 'четвертый',
    5: 'пятый',
    6: 'шестой',
    7: 'седьмой',
    8: 'восьмой',
    9: 'девятый',
    10: 'десятый',
    11: 'одиннадцатый',
    12: 'двенадцатый',
    13: 'тринадцатый',
    14: 'четырнадцатый',
    15: 'пятнадцатый',
    16: 'шестнадцатый',
    17: 'семнадцатый',
    18: 'восемнадцатый',
    19: 'девятнадцатый',
  },
  feminine: {
    1: 'первая',
    2: 'вторая',
    3: 'третья',
    4: 'четвертая',
    5: 'пятая',
    6: 'шестая',
    7: 'седьмая',
    8: 'восьмая',
    9: 'девятая',
    10: 'десятая',
    11: 'одиннадцатая',
    12: 'двенадцатая',
    13: 'тринадцатая',
    14: 'четырнадцатая',
    15: 'пятнадцатая',
    16: 'шестнадцатая',
    17: 'семнадцатая',
    18: 'восемнадцатая',
    19: 'девятнадцатая',
  },
  genitiveMasculine: {
    1: 'первого',
    2: 'второго',
    3: 'третьего',
    4: 'четвертого',
    5: 'пятого',
    6: 'шестого',
    7: 'седьмого',
    8: 'восьмого',
    9: 'девятого',
    10: 'десятого',
    11: 'одиннадцатого',
    12: 'двенадцатого',
    13: 'тринадцатого',
    14: 'четырнадцатого',
    15: 'пятнадцатого',
    16: 'шестнадцатого',
    17: 'семнадцатого',
    18: 'восемнадцатого',
    19: 'девятнадцатого',
  },
};

const RUSSIAN_CARDINAL_TENS: Record<number, string> = {
  20: 'двадцать',
  30: 'тридцать',
  40: 'сорок',
  50: 'пятьдесят',
  60: 'шестьдесят',
  70: 'семьдесят',
  80: 'восемьдесят',
  90: 'девяносто',
};

const RUSSIAN_ORDINAL_TENS: Record<RussianOrdinalForm, Record<number, string>> = {
  masculine: {
    20: 'двадцатый',
    30: 'тридцатый',
    40: 'сороковой',
    50: 'пятидесятый',
    60: 'шестидесятый',
    70: 'семидесятый',
    80: 'восьмидесятый',
    90: 'девяностый',
  },
  feminine: {
    20: 'двадцатая',
    30: 'тридцатая',
    40: 'сороковая',
    50: 'пятидесятая',
    60: 'шестидесятая',
    70: 'семидесятая',
    80: 'восьмидесятая',
    90: 'девяностая',
  },
  genitiveMasculine: {
    20: 'двадцатого',
    30: 'тридцатого',
    40: 'сорокового',
    50: 'пятидесятого',
    60: 'шестидесятого',
    70: 'семидесятого',
    80: 'восьмидесятого',
    90: 'девяностого',
  },
};

const RUSSIAN_CARDINAL_HUNDREDS: Record<number, string> = {
  100: 'сто',
  200: 'двести',
  300: 'триста',
  400: 'четыреста',
  500: 'пятьсот',
  600: 'шестьсот',
  700: 'семьсот',
  800: 'восемьсот',
  900: 'девятьсот',
};

const RUSSIAN_ORDINAL_HUNDREDS: Record<RussianOrdinalForm, Record<number, string>> = {
  masculine: {
    100: 'сотый',
    200: 'двухсотый',
    300: 'трехсотый',
    400: 'четырехсотый',
    500: 'пятисотый',
    600: 'шестисотый',
    700: 'семисотый',
    800: 'восьмисотый',
    900: 'девятисотый',
  },
  feminine: {
    100: 'сотая',
    200: 'двухсотая',
    300: 'трехсотая',
    400: 'четырехсотая',
    500: 'пятисотая',
    600: 'шестисотая',
    700: 'семисотая',
    800: 'восьмисотая',
    900: 'девятисотая',
  },
  genitiveMasculine: {
    100: 'сотого',
    200: 'двухсотого',
    300: 'трехсотого',
    400: 'четырехсотого',
    500: 'пятисотого',
    600: 'шестисотого',
    700: 'семисотого',
    800: 'восьмисотого',
    900: 'девятисотого',
  },
};

const formatRussianOrdinal = (value: number, form: RussianOrdinalForm): string => {
  if (!Number.isInteger(value) || value <= 0 || value >= 1000) {
    return String(value);
  }

  if (value < 20) {
    return RUSSIAN_ORDINAL_UNDER_20[form][value] || String(value);
  }

  if (value < 100) {
    const tens = Math.floor(value / 10) * 10;
    const rest = value % 10;

    if (rest === 0) {
      return RUSSIAN_ORDINAL_TENS[form][tens] || String(value);
    }

    return `${RUSSIAN_CARDINAL_TENS[tens]} ${formatRussianOrdinal(rest, form)}`;
  }

  const hundreds = Math.floor(value / 100) * 100;
  const rest = value % 100;

  if (rest === 0) {
    return RUSSIAN_ORDINAL_HUNDREDS[form][hundreds] || String(value);
  }

  return `${RUSSIAN_CARDINAL_HUNDREDS[hundreds]} ${formatRussianOrdinal(rest, form)}`;
};

const getRussianBookNameForTts = (book: string): string =>
  getLocalizedBookName(book, 'ru')
    .replace(/^(?:от|к)\s+/iu, '')
    .trim();

const formatRussianReferenceForTts = (
  ref: ParsedScriptureReference,
  displayChapter: number,
  displayFromVerse: number,
  displayToVerse?: number
): string | null => {
  if (
    !Number.isInteger(displayChapter) ||
    !Number.isInteger(displayFromVerse) ||
    displayChapter <= 0 ||
    displayFromVerse <= 0 ||
    (displayToVerse !== undefined && (!Number.isInteger(displayToVerse) || displayToVerse <= 0))
  ) {
    return null;
  }

  const bookName = getRussianBookNameForTts(ref.book);
  const chapter = `${formatRussianOrdinal(displayChapter, 'feminine')} глава`;
  const verse = displayToVerse && displayToVerse !== displayFromVerse
    ? `стихи с ${formatRussianOrdinal(displayFromVerse, 'genitiveMasculine')} по ${formatRussianOrdinal(displayToVerse, 'masculine')}`
    : `${formatRussianOrdinal(displayFromVerse, 'masculine')} стих`;

  return `${bookName}, ${chapter}, ${verse}`;
};

const parseReferenceForTts = (
  bookAlias: string,
  chapter: string,
  verse: string,
  toVerse: string | undefined,
  locale: BibleLocale
): ParsedScriptureReference | null => {
  const parsed = parseReferenceText([bookAlias, chapter, verse, toVerse].filter(Boolean).join(' '), locale);
  if (parsed) {
    return parsed;
  }

  const book = getBookByName(bookAlias, locale) || getBookByName(bookAlias);
  if (!book) {
    return null;
  }

  const displayChapter = Number(chapter);
  const displayFromVerse = Number(verse);
  const displayToVerse = toVerse ? Number(toVerse) : undefined;

  if (
    !Number.isInteger(displayChapter) ||
    !Number.isInteger(displayFromVerse) ||
    displayChapter <= 0 ||
    displayFromVerse <= 0 ||
    (displayToVerse !== undefined && (!Number.isInteger(displayToVerse) || displayToVerse <= 0))
  ) {
    return null;
  }

  return {
    book: book.id,
    chapter: displayChapter,
    fromVerse: displayFromVerse,
    ...(displayToVerse ? { toVerse: displayToVerse } : {}),
  };
};

/**
 * Converts dictated Scripture references into written citation notation.
 * Example: "Второзаконие 10 глава 11 стих" -> "Втор. 10:11".
 */
export function normalizeSpokenScriptureReferences(text: string): string {
  if (!text.trim()) return text;

  const locale = detectLocale(text);

  const replaceVerseReference = (
    value: string,
    matchPattern: RegExp
  ): string =>
    value.replace(matchPattern, (match: string, prefix: string, bookAlias: string, chapter: string, verse: string, toVerse?: string) => {
      if (!hasExplicitReferenceSignal(match, verse)) {
        return match;
      }

      const parseableReference = [bookAlias, chapter, verse, toVerse].filter(Boolean).join(' ');
      const parsed = parseReferenceText(parseableReference, locale);

      if (!parsed) {
        return match;
      }

      return `${prefix}${formatReferenceForProse(parsed, locale)}`;
    });

  const replaceChapterReference = (value: string): string =>
    value.replace(SPOKEN_CHAPTER_REFERENCE_PATTERN, (match: string, prefix: string, bookAlias: string, chapter: string) => {
      if (!hasExplicitReferenceSignal(match)) {
        return match;
      }

      const parsed = parseReferenceText([bookAlias, chapter].join(' '), locale);

      if (!parsed) {
        return match;
      }

      return `${prefix}${formatReferenceForProse(parsed, locale)}`;
    });

  return replaceChapterReference(
    replaceVerseReference(
      replaceVerseReference(text, COLON_REFERENCE_PATTERN),
      SPOKEN_VERSE_REFERENCE_PATTERN
    )
  );
}

/**
 * Converts written Scripture references into a form that TTS pronounces naturally.
 * Example: "Матфея 24:42" -> "Матфея, двадцать четвертая глава, сорок второй стих".
 */
export function normalizeScriptureReferencesForTts(text: string): string {
  if (!text.trim()) return text;

  const locale = detectLocale(text);
  if (locale !== 'ru') return text;

  return text.replace(
    TTS_COLON_REFERENCE_PATTERN,
    (match: string, prefix: string, bookAlias: string, chapter: string, verse: string, toVerse?: string) => {
      const parsed = parseReferenceForTts(bookAlias, chapter, verse, toVerse, locale);
      if (!parsed) {
        return match;
      }

      const spokenReference = formatRussianReferenceForTts(
        parsed,
        Number(chapter),
        Number(verse),
        toVerse ? Number(toVerse) : undefined
      );
      return spokenReference ? `${prefix}${spokenReference}` : match;
    }
  );
}
