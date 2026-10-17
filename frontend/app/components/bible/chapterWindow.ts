/*
 * A BIG BOOK DRAWN AROUND THE PLACE READ (the owner's iPad, 2026-10-16): only the chapters near the verse
 * being read are in the page; every other chapter stands as a box of its height with its heading, so the
 * scroll still spans the whole book and a jump finds any chapter where it stands. Why: whatever touches the
 * whole text — a new text size, the iPad turned — costs WebKit time for every element in the page, hidden
 * or not (`content-visibility` left WebKit's style work as it was: the Psalms' text size 682 → 583 ms,
 * while the chapters around the place alone took 99 ms; production build, measured 2026-10-16).
 */

/** The chapters drawn, first to last, counted from 1. */
export type ChapterSpan = { first: number; last: number };

/** A book this short is drawn whole: its boxes would save nothing worth having. */
export const WHOLE_BOOK_VERSES = 400;
/** Verses drawn on each side of the chapter read: four screens and more, so reading never meets a box. */
export const SIDE_VERSES = 60;
/** At most this many chapters on a side, so short psalms do not pull half the Psalter in. */
export const SIDE_CHAPTERS = 6;

type Chapters = readonly (readonly string[])[];

/** The chapters drawn while `chapter` is read: whole chapters, about `SIDE_VERSES` on either side of it. */
export function spanAround(chapters: Chapters, chapter: number): ChapterSpan {
  const count = chapters.length;
  const total = chapters.reduce((sum, verses) => sum + verses.length, 0);
  if (total <= WHOLE_BOOK_VERSES) return { first: 1, last: count };
  const at = Math.min(Math.max(1, Math.round(chapter)), count);
  let first = at;
  let before = 0;
  while (first > 1 && before < SIDE_VERSES && at - first < SIDE_CHAPTERS) {
    first -= 1;
    before += chapters[first - 1].length;
  }
  let last = at;
  let after = 0;
  while (last < count && after < SIDE_VERSES && last - at < SIDE_CHAPTERS) {
    last += 1;
    after += chapters[last - 1].length;
  }
  return { first, last };
}

export const sameSpan = (one: ChapterSpan, other: ChapterSpan): boolean => one.first === other.first && one.last === other.last;
export const inSpan = (span: ChapterSpan, chapter: number): boolean => chapter >= span.first && chapter <= span.last;

/** A chapter's heading and each verse's last line, as letters: a box's height follows its text. */
const HEADING_WEIGHT = 80;
const VERSE_WEIGHT = 30;

/** What a chapter weighs for its height: its letters, and a share for its heading and each verse's last line. */
export function chapterWeight(verses: readonly string[]): number {
  return verses.reduce((sum, raw) => sum + raw.length + VERSE_WEIGHT, HEADING_WEIGHT);
}

/** Pixels a letter of weight takes before any chapter was measured: corrected once the first ones are. */
export const FIRST_GUESS_PX = 0.6;

/**
 * Pixels per letter of weight, from the chapters drawn: their heights over their weights. The boxes of the
 * chapters never seen are this times their weight; a chapter once drawn keeps the height it had.
 */
export function pixelsPerWeight(measured: readonly { height: number; weight: number }[]): number | null {
  const weight = measured.reduce((sum, chapter) => sum + chapter.weight, 0);
  const height = measured.reduce((sum, chapter) => sum + chapter.height, 0);
  return weight > 0 && height > 0 ? height / weight : null;
}

/**
 * The chapters drawn next while the person scrolls, around `wanted` (the chapter at the reading top) —
 * except boxes of a guessed height above the text the person sees (`seen`, the chapter of the first verse
 * drawn on the screen; `wanted` itself when the screen shows none): drawn, such a box moves that text by
 * the guess's error, and moving the scroll back in the middle of a glide can stop it on an iPad. Those wait
 * until the scroll rests (`scrolling` false), and are drawn then with the scroll kept on that text. The
 * chapters below it are drawn at once, and so are those taken away: a chapter taken away leaves a box of
 * the height it had.
 */
export function nextSpan(chapters: Chapters, current: ChapterSpan, wanted: number, scrolling: boolean, known: (chapter: number) => boolean, seen: number = wanted): ChapterSpan {
  const desired = spanAround(chapters, wanted);
  if (!scrolling) return desired;
  let first = Math.min(Math.max(1, Math.round(seen)), chapters.length);
  while (first > desired.first && (inSpan(current, first - 1) || known(first - 1))) first -= 1;
  return { first, last: Math.max(first, desired.last) };
}
