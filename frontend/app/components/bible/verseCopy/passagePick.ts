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
 * A PASSAGE FOR AN ANALYSIS IS ONE PIECE OF TEXT (the owner, canvas «Разбор структуры», 2026-10-29): a verse below or
 * above stretches it to that verse; its first or last verse is taken off; a verse in its middle cannot go — a block
 * diagram cuts running text, and a gap would cut a sentence. `inside` says the press asked for that.
 */
export function stretchPassage(text: BookText, chosen: readonly VerseAt[], at: VerseAt): { verses: VerseAt[]; inside: boolean } {
  if (!chosen.length) return { verses: [at], inside: false };
  const sorted = [...chosen].sort((a, b) => bookIndex(text, a) - bookIndex(text, b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const target = bookIndex(text, at);
  if (target > bookIndex(text, last)) return { verses: versesBetween(text, first, at), inside: false };
  if (target < bookIndex(text, first)) return { verses: versesBetween(text, at, last), inside: false };
  if (sorted.length === 1) return { verses: sorted, inside: false };
  if (target === bookIndex(text, last)) return { verses: sorted.slice(0, -1), inside: false };
  if (target === bookIndex(text, first)) return { verses: sorted.slice(1), inside: false };
  return { verses: sorted, inside: true };
}

/** The chosen verses as one passage, first verse to last. */
export function pickedPassage(text: BookText, chosen: readonly VerseAt[]): PickedPassage | null {
  if (!chosen.length) return null;
  const sorted = [...chosen].sort((a, b) => bookIndex(text, a) - bookIndex(text, b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return { chapter: first.chapter, fromVerse: first.verse, toChapter: last.chapter, toVerse: last.verse };
}
