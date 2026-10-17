import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

import { MARK_COLORS, marksKey, PENCIL_COLORS, type BookMarks, type MarkColor, type PencilColor } from '@/utils/bibleMarks';

import { mapVerseText, VERSE_TEXT_ATTRIBUTE, wordsRange } from './verseWordDom';

import type { MarksChange } from './markStore';

/*
 * MARKS DRAWN OVER THE TEXT — by the browser itself (the CSS Custom Highlight API): the words stay as
 * they are, a mark is a range the page paints, so a whole book of marks costs no element of its own
 * (a ribbon of the Psalms is tens of thousands of words). The colours live in `globals.css` under
 * `::highlight(bible-mark-…)`, light and dark. A browser without the API (Safari before 17.2) shows no
 * marks and offers no tools (`marksSupported`).
 *
 * Drawn only when what is shown changes (`marksKey`): the book's form hands the reader a new copy at
 * every step of a save — kept on the device, queued, sent, answered — and the same marks drawn again
 * at each one, every marked verse looked up through the whole book, left an iPad's Psalms stiff for
 * seconds after a stroke (2026-10-16, measured in WebKit). The verses are found through one index of
 * the drawn text, not by a search of the book per verse. Each colour's highlight is registered once and
 * only the ranges of verses whose marks changed are taken out and put in: WebKit repaints every range
 * of a highlight replaced whole, and a stroke over the Psalms with ninety marks redrew them all on each
 * word (67 ms a frame against 34 for one range put in, measured in WebKit).
 */
type Layer = MarkColor | `pencil-${PencilColor}`;
export const highlightName = (layer: Layer) => `bible-mark-${layer}`;

type HighlightSet = { add: (range: Range) => void; delete: (range: Range) => void };
type HighlightRegistry = { set: (name: string, highlight: HighlightSet) => void; delete: (name: string) => void };
type HighlightConstructor = new (...ranges: Range[]) => HighlightSet;

function registry(): { highlights: HighlightRegistry; Highlight: HighlightConstructor } | null {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return null;
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
  return highlights && Highlight ? { highlights, Highlight } : null;
}

export const marksSupported = (): boolean => registry() !== null;

const LAYERS: Layer[] = [...MARK_COLORS, ...PENCIL_COLORS.map((color) => `pencil-${color}` as const)];
/** How long a kept stroke is shown over marks that do not hold it yet. */
const HOLD_MS = 3_000;

/** Each drawn verse's words by the verse (`"26:4"`), read from the page once for its text. */
function verseIndex(root: HTMLElement): Map<string, Element> {
  const index = new Map<string, Element>();
  root.querySelectorAll(`[${VERSE_TEXT_ATTRIBUTE}]`).forEach((container) => {
    const verse = container.closest('[data-verse]')?.getAttribute('data-verse');
    if (verse) index.set(verse, container);
  });
  return index;
}

/**
 * The marks as drawn on this page: one highlight per colour, and each verse's ranges in them with the
 * words they were drawn over — a big book draws its chapters around the place read, and a verse that
 * left the page or came back is drawn again over its new words.
 */
type Canvas = { layers: Map<Layer, HighlightSet> | null; verses: Map<string, { key: string; words: Element | undefined; ranges: [Layer, Range][] }> };

function rangesOf(container: Element, verseMarks: BookMarks[string]): [Layer, Range][] {
  const map = mapVerseText(container);
  const ranges: [Layer, Range][] = [];
  verseMarks.m?.forEach(([first, last, color]) => {
    const range = wordsRange(map, first, last);
    if (range) ranges.push([color, range]);
  });
  verseMarks.p?.forEach(([first, last, color]) => {
    const range = wordsRange(map, first, last);
    if (range) ranges.push([`pencil-${color}`, range]);
  });
  return ranges;
}

/** Brings the page's highlights to `marks`, touching only the verses whose marks changed. */
function paintMarks(canvas: Canvas, root: HTMLElement, index: Map<string, Element>, marks: BookMarks): void {
  const api = registry();
  if (!api) return;
  if (!canvas.layers) {
    const layers = new Map<Layer, HighlightSet>();
    LAYERS.forEach((layer) => {
      const highlight = new api.Highlight();
      api.highlights.set(highlightName(layer), highlight);
      layers.set(layer, highlight);
    });
    canvas.layers = layers;
  }
  const layers = canvas.layers;
  const takeOut = (ranges: [Layer, Range][]) => ranges.forEach(([layer, range]) => layers.get(layer)?.delete(range));
  for (const [verse, verseMarks] of Object.entries(marks)) {
    const key = JSON.stringify(verseMarks);
    const drawn = canvas.verses.get(verse);
    const found = index.get(verse);
    const words = found && root.contains(found) ? found : undefined;
    if (drawn?.key === key && drawn.words === words) continue;
    if (drawn) takeOut(drawn.ranges);
    const ranges = words ? rangesOf(words, verseMarks) : [];
    ranges.forEach(([layer, range]) => layers.get(layer)?.add(range));
    canvas.verses.set(verse, { key, words, ranges });
  }
  for (const [verse, drawn] of canvas.verses) {
    if (marks[verse]) continue;
    takeOut(drawn.ranges);
    canvas.verses.delete(verse);
  }
}

function clearMarks(state: { painted: string | null; canvas: Canvas }): void {
  state.painted = null;
  state.canvas = { layers: null, verses: new Map() };
  LAYERS.forEach((layer) => registry()?.highlights.delete(highlightName(layer)));
}

/** How a stroke shows itself, outside React: a reader redrawn on every word made an iPad lag (2026-10-16). */
export type MarkPainter = {
  /** A stroke being drawn: shown over the marks, and through every change of them, until it is let go. */
  draw: (marks: BookMarks) => void;
  /**
   * The stroke let go: `null` when it is not kept. A kept stroke — a change that, applied twice, changes
   * nothing more (`applyStroke`) — stays shown over the book's marks until they hold it: its own save
   * arriving, however many saves of earlier strokes come first, so it never blinks out and back while
   * it is kept. A save is on the device within a moment; a stroke the marks never come to hold (the
   * person took the server's version) is let go after `HOLD_MS`.
   */
  release: (kept: MarksChange | null) => void;
  /** A kept stroke whose save failed: no longer shown. */
  drop: (kept: MarksChange) => void;
  /** What the page shows now: a stroke starts from it, strokes let go a moment ago included. */
  shown: () => BookMarks;
};

/**
 * Paints `marks` over the verses drawn inside the ribbon (`rootRef`, on the page once `ready`), again
 * whenever the shown marks, the drawn text (`textKey`) or its chapters drawn (`drawnKey`) change, and
 * gives a stroke its painter.
 */
export function useMarkHighlights(rootRef: RefObject<HTMLElement | null>, ready: boolean, marks: BookMarks, textKey: unknown, drawnKey?: unknown): MarkPainter {
  const state = useRef({
    marks,
    ready,
    drawing: null as BookMarks | null,
    held: [] as { change: MarksChange; until: number }[],
    painted: null as string | null,
    index: null as Map<string, Element> | null,
    canvas: { layers: null, verses: new Map() } as Canvas,
    timers: new Set<number>(),
  });

  const painter = useMemo(() => {
    const show = (target: BookMarks) => {
      const current = state.current;
      const root = rootRef.current;
      if (!root || !current.ready || !registry()) return;
      const key = marksKey(target);
      if (key === current.painted) return;
      current.index ??= verseIndex(root);
      paintMarks(current.canvas, root, current.index, target);
      current.painted = key;
    };
    const heldOver = (marks: BookMarks) => state.current.held.reduce((shownMarks, { change }) => change(shownMarks), marks);
    const shown = () => state.current.drawing ?? heldOver(state.current.marks);
    // The strokes the book's marks hold already, from the oldest, are no longer held over them: saves
    // arrive in the order the strokes were made, and a later stroke over the same words must stay after
    // the earlier one (Codex, 2026-10-16: an eraser held past the red stroke after it hid the saved red).
    // Strokes held too long go too.
    const settle = () => {
      const { marks: kept } = state.current;
      const key = marksKey(kept);
      const now = Date.now();
      let held = state.current.held.filter(({ until }) => until > now);
      while (held.length > 0 && marksKey(held[0].change(kept)) === key) held = held.slice(1);
      state.current.held = held;
      show(shown());
    };
    return {
      show,
      shown,
      settle,
      draw: (next: BookMarks) => {
        state.current.drawing = next;
        show(next);
      },
      release: (kept: MarksChange | null) => {
        state.current.drawing = null;
        // A stroke that changes nothing shown (an eraser over bare words) has nothing to hold.
        const before = heldOver(state.current.marks);
        if (kept && marksKey(kept(before)) !== marksKey(before)) {
          state.current.held = [...state.current.held, { change: kept, until: Date.now() + HOLD_MS }];
          const timer = window.setTimeout(() => {
            state.current.timers.delete(timer);
            settle();
          }, HOLD_MS + 50);
          state.current.timers.add(timer);
        }
        show(shown());
      },
      drop: (kept: MarksChange) => {
        state.current.held = state.current.held.filter(({ change }) => change !== kept);
        show(shown());
      },
    };
  }, [rootRef]);

  // What this page shows is published when React commits it, never while it renders: a render that
  // is set aside never commits, and a held stroke's timer must not paint its marks.
  useLayoutEffect(() => {
    state.current.marks = marks;
    state.current.ready = ready;
  });

  // A new text — another book or Bible: its verses are other elements, nothing of it is painted yet,
  // and a stroke drawn or held over the last one has nothing to do with it.
  useLayoutEffect(() => {
    state.current.index = null;
    state.current.held = [];
    state.current.drawing = null;
    clearMarks(state.current);
  }, [textKey, ready]);

  // The book's marks changed (a stroke's save arrived, or another device's change): shown with the
  // strokes they do not hold yet; a stroke still being drawn stays over them. Marks switched off
  // (signed out, the text gone) leave nothing painted.
  useLayoutEffect(() => {
    if (ready) painter.settle();
    else clearMarks(state.current);
  }, [marks, ready, textKey, painter]);

  // Other chapters of a big book came into the page and some left it (`drawnKey`): the words are looked
  // up again, and only the verses whose words changed are drawn anew — a stroke held stays shown.
  const drawnRef = useRef(drawnKey);
  useLayoutEffect(() => {
    if (drawnRef.current === drawnKey) return;
    drawnRef.current = drawnKey;
    state.current.index = null;
    state.current.painted = null;
    if (state.current.ready) painter.show(painter.shown());
  }, [drawnKey, painter]);

  // The reader left: nothing painted stays, and no held stroke's timer runs after it.
  useLayoutEffect(() => {
    const current = state.current;
    return () => {
      current.timers.forEach((timer) => window.clearTimeout(timer));
      current.timers.clear();
      clearMarks(current);
    };
  }, []);

  return useMemo(() => ({ draw: painter.draw, release: painter.release, drop: painter.drop, shown: painter.shown }), [painter]);
}
