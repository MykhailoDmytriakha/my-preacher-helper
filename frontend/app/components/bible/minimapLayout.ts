import { verseWords } from '@/utils/bibleText';

/**
 * The minimap of a book, laid out without drawing: one thin stroke per line of a verse (a long
 * verse takes several), a label above every chapter, and the top of every verse. Like an editor's
 * minimap, a stroke's length follows the real length of the text, so the map looks like the page.
 */
export type MinimapGeometry = {
  width: number;
  charsPerLine: number;
  lineStep: number;
  verseGap: number;
  chapterGap: number;
  labelHeight: number;
};

export const MINIMAP_GEOMETRY: MinimapGeometry = {
  width: 104,
  charsPerLine: 90,
  lineStep: 3,
  verseGap: 1,
  chapterGap: 8,
  labelHeight: 13,
};

export type MinimapLine = { y: number; width: number; chapter: number; verse: number };
export type MinimapLabel = { y: number; chapter: number };

export type MinimapLayout = {
  lines: MinimapLine[];
  labels: MinimapLabel[];
  height: number;
  /** verseTop[c - 1][v - 1] is the y of verse c:v on the map. */
  verseTop: number[][];
};

export function buildMinimapLayout(chapters: string[][], geometry: MinimapGeometry = MINIMAP_GEOMETRY): MinimapLayout {
  const lines: MinimapLine[] = [];
  const labels: MinimapLabel[] = [];
  const verseTop: number[][] = [];
  let y = 0;
  chapters.forEach((verses, chapterIndex) => {
    const chapter = chapterIndex + 1;
    if (chapterIndex > 0) y += geometry.chapterGap;
    labels.push({ y, chapter });
    y += geometry.labelHeight;
    verseTop[chapterIndex] = [];
    verses.forEach((raw, verseIndex) => {
      const verse = verseIndex + 1;
      verseTop[chapterIndex][verseIndex] = y;
      let rest = Math.max(1, verseWords(raw).length);
      while (rest > 0) {
        const part = Math.min(geometry.charsPerLine, rest);
        lines.push({ y, width: Math.max(6, Math.round((part / geometry.charsPerLine) * geometry.width)), chapter, verse });
        y += geometry.lineStep;
        rest -= geometry.charsPerLine;
      }
      y += geometry.verseGap;
    });
  });
  return { lines, labels, height: y, verseTop };
}

/** The index of the last item whose `y` is at or above the given y (items run down the map); -1 when none. */
function lastAtOrAbove<T extends { y: number }>(items: T[], y: number): number {
  let low = -1;
  let high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (items[middle].y <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The first stroke that can show in a window starting at y — where drawing starts, instead of at the top of the book. */
export const firstVisibleLine = (layout: MinimapLayout, y: number): number => Math.max(0, lastAtOrAbove(layout.lines, y));

/**
 * The verse under a point of the map. On a chapter's label it is that chapter's first verse — the
 * label stands above the chapter, and "the last stroke above" would be the previous chapter's end.
 * Above the first line is the first verse, below the last is the last.
 */
export function verseAtY(layout: MinimapLayout, y: number): { chapter: number; verse: number } | null {
  const { lines, labels, verseTop } = layout;
  if (lines.length === 0) return null;
  const labelIndex = lastAtOrAbove(labels, y);
  if (labelIndex >= 0) {
    const { chapter } = labels[labelIndex];
    const firstLineY = verseTop[chapter - 1]?.[0];
    if (firstLineY !== undefined && y < firstLineY) return { chapter, verse: 1 };
  }
  const line = lines[Math.max(0, lastAtOrAbove(lines, y))];
  return { chapter: line.chapter, verse: line.verse };
}

/**
 * How far the map is scrolled. A map taller than its box moves with the page, as an editor's
 * minimap does: at the top of the book it shows the start, at the bottom the end.
 */
export function minimapOffset(layoutHeight: number, boxHeight: number, pageProgress: number): number {
  const overflow = layoutHeight - boxHeight;
  if (overflow <= 0) return 0;
  const progress = Math.min(1, Math.max(0, pageProgress));
  return Math.round(overflow * progress);
}
