import { getBookById } from '@/(pages)/(private)/studies/bibleData';
import { parseReferenceText } from '@/(pages)/(private)/studies/referenceParser';
import { chapterCount } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';

export type GoToPlace = { bookId: string; chapter: number; verse: number };

/**
 * A reference typed in one line — "Ин 3:16", "Пс 22", "1 Кор 13", "Быт" — as a place to open, or
 * null when there is no such book or chapter. The shared parser reads it (`.howto/format-scripture-reference.md`);
 * two rules are the reader's own:
 * - the number is the one on screen, in the Bible being read: a psalm is not renumbered (the parser
 *   renumbers into storage numbering only when it is given a locale, and it is given none);
 * - a book of one chapter is cited by its verse alone: "Иуд 3" is Jude 1:3.
 * Whether the verse exists is the reader's check, as for a link.
 */
export function placeFromReference(raw: string, bible: BibleId): GoToPlace | null {
  // Digits alone are no reference: the parser would take "3" for the start of "3 John".
  if (!/\p{L}/u.test(raw)) return null;
  const parsed = parseReferenceText(raw.trim());
  const book = parsed ? getBookById(parsed.book) : undefined;
  if (!parsed || !book) return null;
  const chapters = chapterCount(bible, book.id);
  if (chapters === 1 && parsed.chapter && !parsed.fromVerse) {
    return { bookId: book.id, chapter: 1, verse: parsed.chapter };
  }
  const chapter = parsed.chapter ?? 1;
  if (chapter > chapters) return null;
  return { bookId: book.id, chapter, verse: parsed.fromVerse ?? 1 };
}
