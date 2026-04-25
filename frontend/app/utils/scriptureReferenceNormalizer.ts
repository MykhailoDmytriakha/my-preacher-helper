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

const aliasesPattern = getReferenceBookAliases()
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
