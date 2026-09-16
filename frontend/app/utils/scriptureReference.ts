import {
  getLocalizedAbbrev,
  getLocalizedBookName,
  psalmHebrewToSeptuagint,
} from '@/(pages)/(private)/studies/bibleData';
import { BOOK_ABBREVIATIONS } from '@/(pages)/(private)/studies/bookAbbreviations';

import type { AppLocale } from '@/utils/appLocale';

/**
 * A SCRIPTURE REFERENCE AS TEXT — one reading of its shape, three faces.
 *
 * Eight functions used to do this, each with its own opinion: whether a verse beats a leftover
 * chapter range, whether "5:17-17" is a range, whether Psalm 23 of the stored Hebrew numbering
 * is Psalm 22 in a Russian Bible. They drifted exactly as copies do — the calendar printed
 * "Luke 5:17-26" under a note whose own chips read "Лк.5:17-26".
 *
 * The SHAPE is read once, here. What legitimately differs is only the FACE:
 *
 * - `short`     — "Лк.5:17-26". Chips, compact labels. The book abbreviated in the interface
 *                 language, the Psalms renumbered for Russian and Ukrainian readers.
 * - `long`      — "От Луки 5:17-26". Text a person reads: cards, previews, search.
 * - `canonical` — "Luke 5:17-26". The stored English name and the stored numbering, for AI
 *                 prompts and anything a machine compares. Never shown as the interface's words.
 */
export type ScriptureRefStyle = 'short' | 'long' | 'canonical';

export interface ScriptureRefShape {
  book: string;
  chapter?: number;
  toChapter?: number;
  fromVerse?: number;
  toVerse?: number;
}

export interface ScriptureRefFormat {
  /**
   * The interface language. Omitted for `short`, the book falls back to the Russian
   * abbreviation table — the behaviour the app has always had for a missing locale.
   */
  locale?: AppLocale;
  style?: ScriptureRefStyle;
}

function bookFor(book: string, { locale, style = 'short' }: ScriptureRefFormat): string {
  if (style === 'canonical') return book;
  if (style === 'long') return getLocalizedBookName(book, locale ?? 'en');
  return locale ? getLocalizedAbbrev(book, locale) : BOOK_ABBREVIATIONS[book] || book;
}

/** The stored numbering is Hebrew; Russian and Ukrainian Bibles number the Psalms by the Septuagint. */
function chapterFor(book: string, chapter: number, { locale, style = 'short' }: ScriptureRefFormat): number {
  if (style === 'canonical' || book !== 'Psalms') return chapter;
  return locale === 'ru' || locale === 'uk' ? psalmHebrewToSeptuagint(chapter) : chapter;
}

export function formatScriptureReference(ref: ScriptureRefShape, format: ScriptureRefFormat = {}): string {
  const book = bookFor(ref.book, format);
  if (ref.chapter === undefined) return book;

  // The short face glues the book to the chapter ("Лк.5"); the other two read as prose.
  const joint = (format.style ?? 'short') === 'short' ? '.' : ' ';
  const chapter = chapterFor(ref.book, ref.chapter, format);

  // A verse wins even when a chapter range is also present — old data carries both.
  if (ref.fromVerse !== undefined) {
    const verses =
      ref.toVerse !== undefined && ref.toVerse !== ref.fromVerse
        ? `${ref.fromVerse}-${ref.toVerse}`
        : String(ref.fromVerse);
    return `${book}${joint}${chapter}:${verses}`;
  }

  if (ref.toChapter !== undefined && ref.toChapter !== ref.chapter) {
    return `${book}${joint}${chapter}-${chapterFor(ref.book, ref.toChapter, format)}`;
  }

  return `${book}${joint}${chapter}`;
}

/**
 * Several references as one line, or `undefined` when there is nothing to say — so a caller can
 * write `formatted ?? fallback` instead of testing for an empty string.
 */
export function formatScriptureReferences(
  refs: readonly ScriptureRefShape[] | undefined | null,
  format: ScriptureRefFormat & { limit?: number; separator?: string } = {}
): string | undefined {
  const { limit, separator = '; ', ...face } = format;
  const chosen = limit === undefined ? refs ?? [] : (refs ?? []).slice(0, limit);
  const parts = chosen.map((ref) => formatScriptureReference(ref, face)).filter(Boolean);
  return parts.length > 0 ? parts.join(separator) : undefined;
}

/**
 * WHAT A SEARCH MAY MATCH A REFERENCE BY — the forms a person can see, lowercased.
 *
 * The studies list searched the spelled-out name with the STORED Psalm number, while its own
 * cards displayed the renumbered one; the sermon's note picker searched the abbreviation. So
 * "Псалтирь 22", read straight off a card, did not find that card. Both forms are offered here,
 * both renumbered the way the reader's Bible numbers them, and every search uses this.
 */
export function scriptureReferenceSearchText(ref: ScriptureRefShape, locale: AppLocale): string {
  const short = formatScriptureReference(ref, { locale, style: 'short' });
  const long = formatScriptureReference(ref, { locale, style: 'long' });
  return `${short} ${long}`.toLowerCase();
}
