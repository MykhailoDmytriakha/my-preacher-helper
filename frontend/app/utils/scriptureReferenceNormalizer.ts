import { BIBLE_BOOKS_DATA, getBookByName, getLocalizedBookName } from '@/(pages)/(private)/studies/bibleData';
import { formatScriptureRef } from '@/(pages)/(private)/studies/bookAbbreviations';
import { getReferenceBookAliases, parseReferenceText } from '@/(pages)/(private)/studies/referenceParser';
import { formatRussianOrdinal } from '@utils/russianOrdinals';

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
