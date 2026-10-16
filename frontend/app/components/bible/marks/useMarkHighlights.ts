import { useLayoutEffect, type RefObject } from 'react';

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

/**
 * Paints `marks` over the verses drawn inside the ribbon (`rootRef`, on the page once `ready`); again
 * whenever the marks or the drawn text change.
 */
export function useMarkHighlights(rootRef: RefObject<HTMLElement | null>, ready: boolean, marks: BookMarks, textKey: unknown): void {
  useLayoutEffect(() => {
    const api = registry();
    const root = rootRef.current;
    if (!api || !root || !ready) return undefined;
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
    return () => LAYERS.forEach((layer) => api.highlights.delete(highlightName(layer)));
  }, [marks, ready, rootRef, textKey]);
}
