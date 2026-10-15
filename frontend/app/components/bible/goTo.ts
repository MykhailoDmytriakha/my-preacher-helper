import { referenceFromText } from '@/utils/bibleLink';
import { chapterCount } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';

export type GoToPlace = { bookId: string; chapter: number; verse: number };

/**
 * A reference typed in one line — "Ин 3:16", "Пс 22", "1 Кор 13", "Быт" — as a place to open, or
 * null when there is no such book or chapter. The shared reading of typed text is
 * `referenceFromText` (`utils/bibleLink.ts`): the number is the one on screen, in the Bible being
 * read, and the number after a book of one chapter is its verse ("Иуд 3" is Jude 1:3).
 * Whether the verse exists is the reader's check, as for a link.
 */
export function placeFromReference(raw: string, bible: BibleId): GoToPlace | null {
  const ref = referenceFromText(raw, bible);
  if (!ref) return null;
  const chapter = ref.chapter ?? 1;
  if (chapter > chapterCount(bible, ref.book)) return null;
  return { bookId: ref.book, chapter, verse: ref.fromVerse ?? 1 };
}
