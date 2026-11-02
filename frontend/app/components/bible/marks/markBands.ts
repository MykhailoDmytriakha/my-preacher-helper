import type { MarkColor } from '@/utils/bibleMarks';

/*
 * THE MARKER AS ROUNDED BANDS OF ONE HEIGHT (the owner, 2026-11-02, after his iPad showed the browser's highlight taller on
 * some lines than on others, with square corners). The browser's own highlight (`::highlight`) cannot round a corner, so the
 * marker is drawn by the page: each line a mark covers gets one band — the same height on every line, centred on the
 * words, its ends rounded — and the bands of a verse are one picture behind its row (`background-image`). Nothing is put
 * into the page: a whole book's ribbon is tens of thousands of words, and an element put into it restyled 69 000 nodes in
 * Chrome (`.howto/paint-marks-over-bible-text.md`); a row's own style is all that changes, so only that row repaints.
 * Placed against the row, the bands stay true when a comment opens above it or chapters come and go; they are measured
 * again when the row itself changes size (`useMarkHighlights` watches each painted row). The pencil's line is still the
 * browser's highlight, over the band.
 *
 * The colours are the page's (`globals.css`, `--mark-fill-<colour>`, light and dark): read when the bands are drawn, and the
 * bands are drawn again when the theme changes.
 */

/** The band's height against the text's size, and how far it reaches past the words on each side. */
const BAND_HEIGHT_EM = 1.32;
const BAND_REACH_PX = 2;
const BAND_ROUNDING = 0.28;

type Band = { x: number; y: number; width: number; height: number; color: MarkColor };

/** The fills drawn on each row — measured again from these when the row changes size. */
const painted = new WeakMap<HTMLElement, [MarkColor, Range][]>();

/** What is drawn on a row now (the technical reason: tests read it — jsdom draws no picture). */
export function fillsPaintedOn(row: HTMLElement): readonly [MarkColor, Range][] {
  return painted.get(row) ?? [];
}

const fillOf = (color: MarkColor): string =>
  getComputedStyle(document.documentElement).getPropertyValue(`--mark-fill-${color}`).trim() || 'transparent';

/** One band per line a range covers: the pieces of a line joined, the height the same on every line. */
function bandsOf(row: HTMLElement, fills: readonly [MarkColor, Range][], origin: DOMRect): Band[] {
  const bands: Band[] = [];
  for (const [color, range] of fills) {
    if (typeof range.getClientRects !== 'function') continue;
    const text = range.startContainer.parentElement ?? row;
    const size = parseFloat(getComputedStyle(text).fontSize) || 16;
    const height = Math.round(size * BAND_HEIGHT_EM);
    const lines: { mid: number; left: number; right: number }[] = [];
    for (const box of Array.from(range.getClientRects())) {
      if (box.width < 1) continue;
      const mid = (box.top + box.bottom) / 2;
      const line = lines.find((known) => Math.abs(known.mid - mid) < size * 0.5);
      if (line) {
        line.left = Math.min(line.left, box.left);
        line.right = Math.max(line.right, box.right);
      } else {
        lines.push({ mid, left: box.left, right: box.right });
      }
    }
    for (const line of lines) {
      const x = Math.max(0, line.left - origin.left - BAND_REACH_PX);
      bands.push({
        x, y: Math.round(line.mid - origin.top - height / 2), height, color,
        width: Math.min(origin.width - x, line.right - line.left + BAND_REACH_PX * 2),
      });
    }
  }
  return bands;
}

const CLEARED = ['background-image', 'background-size', 'background-repeat', 'background-position', 'background-origin'];

/** Draws `fills` as bands behind `row`; nothing to draw clears it. */
export function paintRowBands(row: HTMLElement, fills: readonly [MarkColor, Range][]): void {
  if (fills.length === 0) {
    clearRowBands(row);
    return;
  }
  painted.set(row, [...fills]);
  const origin = row.getBoundingClientRect();
  const bands = bandsOf(row, fills, origin);
  if (bands.length === 0 || origin.width < 1 || origin.height < 1) {
    CLEARED.forEach((property) => row.style.removeProperty(property));
    return;
  }
  const colours = new Map<MarkColor, string>();
  const rects = bands.map(({ x, y, width, height, color }) => {
    if (!colours.has(color)) colours.set(color, fillOf(color));
    const round = (value: number) => Math.round(value * 10) / 10;
    return `<rect x='${round(x)}' y='${round(y)}' width='${round(width)}' height='${height}' rx='${round(height * BAND_ROUNDING)}' fill='${colours.get(color)}'/>`;
  }).join('');
  const width = Math.ceil(origin.width), height = Math.ceil(origin.height);
  const picture = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>${rects}</svg>`;
  // Quotes and brackets escaped too: a picture inside url() must not end it early, whoever parses it.
  const encoded = encodeURIComponent(picture).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  row.style.setProperty('background-image', `url("data:image/svg+xml,${encoded}")`);
  row.style.setProperty('background-size', `${width}px ${height}px`);
  row.style.setProperty('background-repeat', 'no-repeat');
  row.style.setProperty('background-position', '0px 0px');
  row.style.setProperty('background-origin', 'border-box');
}

/** The row's bands, measured again (its size changed, or the theme). */
export function repaintRowBands(row: HTMLElement): void {
  const fills = painted.get(row);
  if (fills) paintRowBands(row, fills);
}

export function clearRowBands(row: HTMLElement): void {
  painted.delete(row);
  CLEARED.forEach((property) => row.style.removeProperty(property));
}
