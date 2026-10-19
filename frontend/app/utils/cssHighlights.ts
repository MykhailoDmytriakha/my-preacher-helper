/*
 * The browser's own highlights (the CSS Custom Highlight API): a range the page paints by name, with
 * the colour under `::highlight(<name>)` in `globals.css`. The words stay as they are, so text drawn
 * by React is never cut into extra elements. Null where the browser has no API (Safari before 17.2):
 * the caller then shows nothing painted, and nothing else changes.
 */
export type HighlightSet = { add: (range: Range) => void; delete: (range: Range) => void };
export type HighlightRegistry = { set: (name: string, highlight: HighlightSet) => void; delete: (name: string) => void };
export type HighlightConstructor = new (...ranges: Range[]) => HighlightSet;

export function cssHighlightRegistry(): { highlights: HighlightRegistry; Highlight: HighlightConstructor } | null {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return null;
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
  return highlights && Highlight ? { highlights, Highlight } : null;
}
