import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

import { MARK_COLORS, PENCIL_COLORS, type BookMarks, type MarkColor, type PencilColor } from '@/utils/bibleMarks';

import { mapVerseText, VERSE_TEXT_ATTRIBUTE, wordsRange } from './verseWordDom';

/*
 * MARKS DRAWN OVER THE TEXT — by the browser itself (the CSS Custom Highlight API): the words stay as
 * they are, a mark is a range the page paints, so a whole book of marks costs no element of its own
 * (a ribbon of the Psalms is tens of thousands of words). The colours live in `globals.css` under
 * `::highlight(bible-mark-…)`, light and dark. A browser without the API (Safari before 17.2) shows no
 * marks and offers no tools (`marksSupported`).
 */
type Layer = MarkColor | `pencil-${PencilColor}`;
export const highlightName = (layer: Layer) => `bible-mark-${layer}`;

type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };
type HighlightConstructor = new (...ranges: Range[]) => unknown;

function registry(): { highlights: HighlightRegistry; Highlight: HighlightConstructor } | null {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return null;
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
  return highlights && Highlight ? { highlights, Highlight } : null;
}

export const marksSupported = (): boolean => registry() !== null;

const LAYERS: Layer[] = [...MARK_COLORS, ...PENCIL_COLORS.map((color) => `pencil-${color}` as const)];

function paintMarks(root: HTMLElement, marks: BookMarks): void {
  const api = registry();
  if (!api) return;
  const ranges = new Map<Layer, Range[]>(LAYERS.map((layer) => [layer, []]));
  for (const [verse, verseMarks] of Object.entries(marks)) {
    const container = root.querySelector(`[data-verse="${verse}"] [${VERSE_TEXT_ATTRIBUTE}]`);
    if (!container) continue;
    const map = mapVerseText(container);
    verseMarks.m?.forEach(([first, last, color]) => {
      const range = wordsRange(map, first, last);
      if (range) ranges.get(color)?.push(range);
    });
    verseMarks.p?.forEach(([first, last, color]) => {
      const range = wordsRange(map, first, last);
      if (range) ranges.get(`pencil-${color}`)?.push(range);
    });
  }
  LAYERS.forEach((layer) => api.highlights.set(highlightName(layer), new api.Highlight(...(ranges.get(layer) ?? []))));
}

/**
 * Paints `marks` over the verses drawn inside the ribbon (`rootRef`, on the page once `ready`); again
 * whenever the marks or the drawn text change. Returns how a stroke being drawn shows itself: painted
 * at once, outside React — a stroke redrawing the whole reader on every word made an iPad lag (the
 * owner, 2026-10-16); `null` returns to the marks.
 */
export function useMarkHighlights(rootRef: RefObject<HTMLElement | null>, ready: boolean, marks: BookMarks, textKey: unknown): (preview: BookMarks | null) => void {
  const latest = useRef({ marks, ready });
  latest.current = { marks, ready };
  // A stroke still being drawn stays painted when the marks under it move on (a batch kept meanwhile).
  const drawing = useRef<BookMarks | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!registry() || !root || !ready) return undefined;
    paintMarks(root, drawing.current ?? marks);
    return () => LAYERS.forEach((layer) => registry()?.highlights.delete(highlightName(layer)));
  }, [marks, ready, rootRef, textKey]);
  return useCallback((preview: BookMarks | null) => {
    drawing.current = preview;
    const root = rootRef.current;
    if (root && latest.current.ready) paintMarks(root, preview ?? latest.current.marks);
  }, [rootRef]);
}
