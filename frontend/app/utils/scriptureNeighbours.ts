import { chapterCount, verseCount } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/** A verse of one book: chapter and verse in the Bible it is counted in. */
export type VerseSpot = { chapter: number; verse: number };

/** How far a list of neighbours reaches each way: five verses up and five down (the owner, 2026-10-28). */
export const NEIGHBOUR_REACH = 5;

/** The verse one step forward or back inside the book, across a chapter's edge; null past the book's ends. */
export function verseStep(bible: BibleId, book: string, { chapter, verse }: VerseSpot, direction: 1 | -1): VerseSpot | null {
  if (direction > 0) {
    if (verse < verseCount(bible, book, chapter)) return { chapter, verse: verse + 1 };
    return chapter < chapterCount(bible, book) ? { chapter: chapter + 1, verse: 1 } : null;
  }
  if (verse > 1) return { chapter, verse: verse - 1 };
  return chapter > 1 ? { chapter: chapter - 1, verse: verseCount(bible, book, chapter - 1) } : null;
}

/**
 * THE VERSES AROUND A VERSE (case 2026-10-12-block-diagram, a comment moved): `reach` up and `reach` down, in order,
 * the verse itself among them, crossing a chapter's edge — after Isaiah 40:31 come 41:1–5 — and stopping at the book's ends.
 */
export function versesAround(bible: BibleId, book: string, at: VerseSpot, reach = NEIGHBOUR_REACH): VerseSpot[] {
  const before: VerseSpot[] = [];
  const after: VerseSpot[] = [];
  for (let spot: VerseSpot | null = at, i = 0; i < reach; i += 1) {
    spot = verseStep(bible, book, spot, -1);
    if (!spot) break;
    before.unshift(spot);
  }
  for (let spot: VerseSpot | null = at, i = 0; i < reach; i += 1) {
    spot = verseStep(bible, book, spot, 1);
    if (!spot) break;
    after.push(spot);
  }
  return [...before, at, ...after];
}

/** The chapters around a chapter: `reach` up and down, the chapter itself among them, inside the book. */
export function chaptersAround(bible: BibleId, book: string, chapter: number, reach = NEIGHBOUR_REACH): number[] {
  const first = Math.max(1, chapter - reach);
  const last = Math.min(chapterCount(bible, book), chapter + reach);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

/**
 * A reference moved to another place keeps what it covers, and only its place changes: Isaiah 40:29–31 moved to 41:2 is
 * 41:2–4, chapters 40–41 moved to 43 are 43–44 — cut at the chapter's or the book's end. Its book is the place's, its Bible
 * the one the place is counted in; its id stays, so the same reference has moved.
 */
export function movedReference<T extends ScriptureRefShape>(ref: T, bible: BibleId, book: string, to: { chapter: number; verse?: number }): T {
  const { toChapter: _toChapter, fromVerse: _fromVerse, toVerse: _toVerse, ...rest } = ref;
  if (to.verse !== undefined) {
    const span = ref.fromVerse !== undefined && ref.toVerse !== undefined ? Math.max(0, ref.toVerse - ref.fromVerse) : 0;
    const end = Math.min(verseCount(bible, book, to.chapter), to.verse + span);
    return { ...rest, bible, book, chapter: to.chapter, fromVerse: to.verse, ...(end > to.verse ? { toVerse: end } : {}) } as T;
  }
  const span = ref.chapter !== undefined && ref.toChapter !== undefined ? Math.max(0, ref.toChapter - ref.chapter) : 0;
  const end = Math.min(chapterCount(bible, book), to.chapter + span);
  return { ...rest, bible, book, chapter: to.chapter, ...(end > to.chapter ? { toChapter: end } : {}) } as T;
}
