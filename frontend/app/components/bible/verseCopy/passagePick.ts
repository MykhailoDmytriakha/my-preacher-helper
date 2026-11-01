import type { VerseAt } from './selectedVerses';
import type { BookText } from '@/utils/bibleText';


/** A passage of one book, as the chosen verses make it. */
export type PickedPassage = { chapter: number; fromVerse: number; toChapter: number; toVerse: number };

/** A verse's place in the whole book: the verses of the chapters before it, then its number. */
export function bookIndex(text: BookText, at: VerseAt): number {
  return text.chapters.slice(0, at.chapter - 1).reduce((sum, chapter) => sum + chapter.length, 0) + at.verse - 1;
}

/** Every verse from `from` to `to`, both included, across chapters. */
/** The verse before this one in the book, over a chapter's end; null before the first. */
export function verseBefore(text: BookText, at: VerseAt): VerseAt | null {
  if (at.verse > 1) return { chapter: at.chapter, verse: at.verse - 1 };
  const previous = text.chapters[at.chapter - 2];
  return previous ? { chapter: at.chapter - 1, verse: previous.length } : null;
}

/** The verse after this one in the book, over a chapter's end; null after the last. */
export function verseAfter(text: BookText, at: VerseAt): VerseAt | null {
  if (at.verse < (text.chapters[at.chapter - 1]?.length ?? 0)) return { chapter: at.chapter, verse: at.verse + 1 };
  return text.chapters[at.chapter] ? { chapter: at.chapter + 1, verse: 1 } : null;
}

export function versesBetween(text: BookText, from: VerseAt, to: VerseAt): VerseAt[] {
  const verses: VerseAt[] = [];
  for (let chapter = from.chapter; chapter <= to.chapter; chapter += 1) {
    const first = chapter === from.chapter ? from.verse : 1;
    const last = chapter === to.chapter ? to.verse : (text.chapters[chapter - 1]?.length ?? 0);
    for (let verse = first; verse <= last; verse += 1) verses.push({ chapter, verse });
  }
  return verses;
}

/**
 * A PASSAGE IS ONE PIECE OF TEXT — an analysis's (the owner, canvas «Разбор структуры», 2026-10-29) and a comment's
 * paragraph (31.10): a verse below or above stretches it to that verse; its first or last verse is taken off; a verse in
 * its middle brings the nearer end to it (the last on a tie) — the first verse moves as freely as the last (the owner, 31.10:
 * «первый стих тоже может меняться»), and no gap is ever cut into the text. `end` says which end moved, none when nothing did.
 */
export function stretchPassage(text: BookText, chosen: readonly VerseAt[], at: VerseAt): { verses: VerseAt[]; end: 'first' | 'last' | null } {
  if (!chosen.length) return { verses: [at], end: null };
  const sorted = [...chosen].sort((a, b) => bookIndex(text, a) - bookIndex(text, b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const target = bookIndex(text, at);
  const start = bookIndex(text, first);
  const finish = bookIndex(text, last);
  if (target > finish) return { verses: versesBetween(text, first, at), end: 'last' };
  if (target < start) return { verses: versesBetween(text, at, last), end: 'first' };
  if (sorted.length === 1) return { verses: sorted, end: null };
  if (target === finish) return { verses: sorted.slice(0, -1), end: 'last' };
  if (target === start) return { verses: sorted.slice(1), end: 'first' };
  return target - start < finish - target
    ? { verses: versesBetween(text, at, last), end: 'first' }
    : { verses: versesBetween(text, first, at), end: 'last' };
}

/**
 * A passage with one end pulled to a verse (a grip on the chosen run, phase 9): the first verse to it, or the last; pulled
 * past the other end, the passage is that end's verse alone — the grips never swap.
 */
export function pulledEnd(text: BookText, chosen: readonly VerseAt[], end: 'first' | 'last', at: VerseAt): VerseAt[] {
  if (!chosen.length) return [at];
  const sorted = [...chosen].sort((a, b) => bookIndex(text, a) - bookIndex(text, b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (end === 'first') return bookIndex(text, at) > bookIndex(text, last) ? [last] : versesBetween(text, at, last);
  return bookIndex(text, at) < bookIndex(text, first) ? [first] : versesBetween(text, first, at);
}

/**
 * Which row a pulled grip stands at, given the rows' middles top to bottom and the pointer's height: an end goes to a verse
 * once the pointer is past its middle (the owner, 01.11: «когда перетянул больше половины стиха то должно переключаться») —
 * the last verse to the lowest row whose middle is above the pointer, the first to the highest whose middle is below it.
 */
export function pulledRow(middles: readonly number[], y: number, end: 'first' | 'last'): number {
  if (!middles.length) return -1;
  if (end === 'last') {
    let row = 0;
    middles.forEach((middle, index) => { if (middle <= y) row = index; });
    return row;
  }
  const row = middles.findIndex((middle) => middle >= y);
  return row === -1 ? middles.length - 1 : row;
}

/** The chosen verses as one passage, first verse to last. */
export function pickedPassage(text: BookText, chosen: readonly VerseAt[]): PickedPassage | null {
  if (!chosen.length) return null;
  const sorted = [...chosen].sort((a, b) => bookIndex(text, a) - bookIndex(text, b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return { chapter: first.chapter, fromVerse: first.verse, toChapter: last.chapter, toVerse: last.verse };
}
