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
 * The frame around the verses on screen, from the first to the last, in the map's own coordinates.
 * A chapter's first verse brings its label in, as the page shows the heading above it: at the start
 * of the book the frame starts at the top of the map, so the map stands still and "Chapter 1" shows.
 * It ends with the map: a short last verse of the book would carry it past the end, and its bottom
 * edge off the box.
 */
export function frameOnMap(
  layout: MinimapLayout,
  [first, last]: [{ chapter: number; verse: number }, { chapter: number; verse: number }],
): { top: number; height: number } {
  const label = first.verse === 1 ? layout.labels.find((candidate) => candidate.chapter === first.chapter) : undefined;
  const top = label ? label.y : (layout.verseTop[first.chapter - 1]?.[first.verse - 1] ?? 0) - 2;
  const bottom = Math.min(layout.height, (layout.verseTop[last.chapter - 1]?.[last.verse - 1] ?? 0) + MINIMAP_GEOMETRY.lineStep * 2);
  return { top, height: Math.max(6, bottom - top) };
}

export type MinimapFrame = { top: number; height: number };

/**
 * HOW A PRESSED FRAME COMES BACK TO ITS PLACE (owner, 2026-10-15: after a press the frame stands
 * where it was pressed, and a jump to its place "jerks — align it more smoothly"). The frame closes
 * on the place following the text would give it only while the person reads the way it has to go —
 * never against the hand: about two thirds of the way per SETTLE_PX of reading, and never faster
 * than SETTLE_RATE times the reading itself, so a big gap closes at an even pace and then slows.
 */
export const SETTLE_PX = 30;
export const SETTLE_RATE = 2;

export type SettleStep = {
  /** How far the map is scrolled now. */
  mapTop: number;
  /** Where following the text put the map before this step of reading, and where it puts it now. */
  attachedBefore: number;
  attachedNow: number;
  /** This step of reading in map px: + down the book, − up. Taken from the page's own scroll, not
   * the frame's: the frame moves a verse at a time, a chapter heading at once, and a pace taken from
   * it would close the gap in jolts. */
  reading: number;
  frame: MinimapFrame;
  boxHeight: number;
};

export function settleOffset({ mapTop, attachedBefore, attachedNow, reading, frame, boxHeight }: SettleStep): { top: number; settled: boolean } {
  // drift > 0: the map is ahead of following, the frame stands above its place, and reading down brings it there.
  const drift = mapTop - attachedBefore;
  const closing = reading !== 0 && Math.sign(reading) === Math.sign(drift);
  const closed = closing ? Math.min(Math.abs(drift) * (1 - Math.exp(-Math.abs(reading) / SETTLE_PX)), SETTLE_RATE * Math.abs(reading)) : 0;
  let top = attachedNow + drift - Math.sign(drift) * closed;
  // The frame stays whole in the box (one taller than the box keeps its top in sight) — pulled back a
  // little at a time when longer verses stretch it past an edge, never at a jolt.
  const lowest = frame.top + frame.height - boxHeight;
  const whole = lowest > frame.top ? frame.top : Math.min(frame.top, Math.max(lowest, top));
  const pull = Math.max(4, 3 * Math.abs(reading));
  top += Math.max(-pull, Math.min(pull, whole - top));
  return Math.abs(top - attachedNow) < 0.5 ? { top: attachedNow, settled: true } : { top, settled: false };
}

/**
 * A frame pressed near the bottom of the box hangs past its edge: the offset that shows it whole —
 * reached at once, as the answer to the press, not later as a jolt in the middle of reading — or
 * null when it already shows whole. A frame taller than the box shows its top.
 */
export function fitPressedFrame(frame: MinimapFrame, mapTop: number, boxHeight: number): number | null {
  const overhang = frame.top + frame.height - mapTop - boxHeight;
  return overhang > 0 ? Math.min(frame.top, mapTop + overhang) : null;
}

/**
 * How far the map is scrolled. A map taller than its box moves with the frame around what is on
 * screen, as an editor's minimap does: the frame has travelled the same share of the map as of the
 * box, so it stays whole inside the box — at the start of the book the map shows the start, at its
 * end the end. Moved by the page's scroll instead, the map let the frame run off the bottom: the
 * page is taller than the text (its end, the room below), and the share left out the frame's height.
 */
export function minimapOffset(layoutHeight: number, boxHeight: number, frame: { top: number; height: number }): number {
  const overflow = layoutHeight - boxHeight;
  if (overflow <= 0) return 0;
  const travel = layoutHeight - frame.height;
  const progress = travel > 0 ? Math.min(1, Math.max(0, frame.top / travel)) : 1;
  // A frame taller than the box cannot stay whole: its top stays in sight, where reading starts.
  return Math.min(Math.round(overflow * progress), Math.max(0, frame.top));
}

/**
 * The map's own margin inside its width: the strokes and labels start this far from the left edge and the
 * marks end this far from the right one, so the reading frame, which spans the whole width, has the same air
 * on both sides (the owner, 2026-10-21: the marks crossed the frame's edge, and the map sat closer to one side).
 */
export const MINIMAP_INSET = 4;

/**
 * A MARK OF THE PERSON'S MATERIAL on the map (`useBookUsage`, the owner's choice 2026-10-21 on the canvas: «на
 * правом краю», a little longer than tall): at the height of the verse its passage starts at, or of the
 * chapter's label for what names the whole chapter, in one column at the map's right end, inside the reading
 * frame when it is there. Several kinds at one place stand side by side, the first of them outermost.
 */
export type MinimapMark<Kind extends string = string> = { chapter: number; verse: number | null; kinds: readonly Kind[] };
export type MinimapMarkRect<Kind extends string = string> = { x: number; y: number; width: number; height: number; kind: Kind };

export const MINIMAP_MARK = { width: 8, height: 5, gap: 2 } as const;

/** Where each mark's pills stand on the map, in the map's own coordinates; a place the map lacks has none. */
export function minimapMarkRects<Kind extends string>(layout: MinimapLayout, marks: readonly MinimapMark<Kind>[], mapWidth: number): MinimapMarkRect<Kind>[] {
  const { width, height, gap } = MINIMAP_MARK;
  const right = mapWidth - MINIMAP_INSET;
  return marks.flatMap((mark) => {
    const label = mark.verse === null ? layout.labels.find((one) => one.chapter === mark.chapter) : undefined;
    // A verse's first line, or the middle of the chapter's label.
    const centre = mark.verse === null ? (label ? label.y + 5 : undefined) : layout.verseTop[mark.chapter - 1]?.[mark.verse - 1];
    if (centre === undefined) return [];
    const middle = mark.verse === null ? centre : centre + 1;
    return mark.kinds.map((kind, index) => ({ x: right - width - index * (width + gap), y: middle - height / 2, width, height, kind }));
  });
}
