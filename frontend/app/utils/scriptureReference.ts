import { getLocalizedAbbrev, getLocalizedBookName } from '@/(pages)/(private)/studies/bibleData';
import { BOOK_ABBREVIATIONS } from '@/(pages)/(private)/studies/bookAbbreviations';
import { CANONICAL_BIBLE, referenceBibleFor, referenceIn, withStoredBible } from '@/utils/scriptureReferenceNumbering';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

/**
 * A SCRIPTURE REFERENCE AS TEXT — one reading of its shape, three faces.
 *
 * Eight functions used to do this, each with its own opinion: whether a verse beats a leftover
 * chapter range, whether "5:17-17" is a range, whether Psalm 23 of the King James is Psalm 22 in
 * a Russian Bible. They drifted exactly as copies do — the calendar printed
 * "Luke 5:17-26" under a note whose own chips read "Лк.5:17-26".
 *
 * The SHAPE is read once, here. What legitimately differs is only the FACE:
 *
 * - `short`     — "Лк.5:17-26". Chips, compact labels. The book abbreviated in the interface
 *                 language.
 * - `long`      — "От Луки 5:17-26". Text a person reads: cards, previews, search.
 * - `canonical` — "Luke 5:17-26". The stored English name in the King James numbering, for AI
 *                 prompts and anything a machine compares. Never shown as the interface's words.
 *
 * The NUMBERS are the reader's Bible's: a reference is kept in the Bible it was written in and
 * shown in the Bible of the interface's language — "Пс 50:12" for a Russian reader is "Ps 51:10"
 * for an English one (`scriptureReferenceNumbering.ts`).
 */
export type ScriptureRefStyle = 'short' | 'long' | 'canonical';

export interface ScriptureRefShape {
  /** The Bible whose numbering the chapter and verses are in; absent on references written before it was kept. */
  bible?: BibleId;
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

/**
 * The reference in the Bible it is read in: the canonical face in the King James, the others in
 * the Bible of the interface's language, and with no language as it was written. A reference that
 * does not name its Bible is read the way the interface typed it before Bibles were kept.
 */
function inReadersBible(ref: ScriptureRefShape, { locale, style = 'short' }: ScriptureRefFormat): ScriptureRefShape {
  if (style === 'canonical') return referenceIn(ref, CANONICAL_BIBLE);
  if (!locale) return ref;
  return referenceIn(withStoredBible(ref, locale), referenceBibleFor(locale));
}

export function formatScriptureReference(stored: ScriptureRefShape, format: ScriptureRefFormat = {}): string {
  const book = bookFor(stored.book, format);
  if (stored.chapter === undefined) return book;

  const ref = inReadersBible(stored, format);
  // The short face glues the book to the chapter ("Лк.5"); the other two read as prose.
  const joint = (format.style ?? 'short') === 'short' ? '.' : ' ';
  const chapter = ref.chapter;

  // A verse wins even when a chapter range is also present — old data carries both.
  if (ref.fromVerse !== undefined) {
    const verses =
      ref.toVerse !== undefined && ref.toVerse !== ref.fromVerse
        ? `${ref.fromVerse}-${ref.toVerse}`
        : String(ref.fromVerse);
    return `${book}${joint}${chapter}:${verses}`;
  }

  if (ref.toChapter !== undefined && ref.toChapter !== ref.chapter) {
    return `${book}${joint}${chapter}-${ref.toChapter}`;
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

/**
 * Everything a study note is found by, lower-cased — its references as the card shows them, both
 * forms (BUG-20260927-study-search-drops-by-short-reference: a hand-built full-name-only text
 * dropped a note the person searched for by the abbreviation on its card).
 */
export function studyNoteSearchText(
  note: { title?: string; content?: string; tags?: readonly string[]; scriptureRefs?: readonly ScriptureRefShape[] },
  locale: AppLocale
): string {
  const refs = (note.scriptureRefs ?? []).map((ref) => `${scriptureReferenceSearchText(ref, locale)} ${storedNumberingSearchText(ref, locale)}`).join(' ');
  return `${note.title ?? ''} ${note.content ?? ''} ${(note.tags ?? []).join(' ')} ${refs}`.toLowerCase();
}

/**
 * EXACTLY the text this search matched before it learned the displayed forms: the full name with
 * the STORED chapter number, as the pre-filter used to build it (missing parts included, so a
 * search that found a note before still does). The stored numbers are those of the Bible the
 * reference was written in, and may differ from the ones shown; the number a person knows must still find it.
 */
function storedNumberingSearchText(ref: ScriptureRefShape, locale: AppLocale): string {
  return `${getLocalizedBookName(ref.book, locale)} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`;
}
