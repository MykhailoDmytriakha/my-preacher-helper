import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { recordDiagnostic } from '@/utils/appDiagnostics';
import { applyStroke, strokeErases, type BookMarks, type StrokeKind, type VerseOrder, type WordAt } from '@/utils/bibleMarks';

import { wordAtPoint } from './verseWordDom';

import type { MarksChange } from './markStore';
import type { MarkPainter } from './useMarkHighlights';

/*
 * A STROKE OVER THE WORDS — the gesture of the marks (the owner, 2026-10-16): a tool in hand, a press
 * on a word and a pull along the words paints them, whole words at a time; let go and the stroke is
 * kept. A mouse pulls as it likes. A finger with a tool in hand paints along the line and still scrolls
 * up and down: the text then answers only sideways pulls (`touch-action: pan-y`, set by the reader),
 * and a pull the page takes for a scroll cancels the stroke, leaving the words as they were. An Apple
 * Pencil paints at once with the last tool, nothing taken, up and down too: its touches are kept from
 * scrolling here. While the stroke is on, the page shows it; only the kept stroke is saved.
 *
 * A stroke starts only on a verse's row, never on what is pressed there — a chip of links, a number, a
 * sign: a Pencil's tap on a chip opens the links and paints no word. The word under a moving finger is
 * looked up once a frame, and the stroke being drawn is painted at once by the highlights (`painter`),
 * not by React: an iPad redrawing the reader on every word lagged (the owner, 2026-10-16); let go and
 * kept, it stays painted until its save arrives. Each stroke's end — kept, cancelled, or missing every
 * word — goes to the technical details a feedback report sends.
 *
 * A mouse with a tool in hand gets a crosshair over the verse it is on, set on that verse's row alone:
 * a style changed on the whole text restyles every word of the book, and the iPad's Psalms took half
 * a second a tap when the tool's cursor and touch handling were switched on the text (2026-10-16).
 */
type Stroke = { pointerId: number; input: string; at: number; start: WordAt; last: WordAt; kind: StrokeKind; erase: boolean; base: BookMarks };
const VERSE_ROW = '[data-verse]';

type StrokeOptions = {
  /** The ribbon's article, on the page once `ready`. */
  rootRef: RefObject<HTMLElement | null>;
  ready: boolean;
  order: VerseOrder | null;
  /** Keeps a stroke: how it changes the marks, laid over the newest stored copy; false when it is not kept. */
  save: (change: MarksChange) => boolean;
  /** Whether a tool is in hand: a finger or a mouse paints only then. */
  armed: boolean;
  /** The stroke is starting: what it paints with, or nothing (no tool for this pointer). */
  begin: (pen: boolean) => StrokeKind | null;
  /** Shows the stroke being drawn, and the stroke let go until it is kept (`useMarkHighlights`). */
  painter: MarkPainter;
  enabled: boolean;
};

const sameWord = (a: WordAt, b: WordAt) => a.verse === b.verse && a.index === b.index;
/** What is pressed on a verse's row is not a word to paint. */
const PRESSABLE = 'button, a, [role="button"], input, textarea, select';

export function useMarkStrokes({ rootRef, ready, order, save, armed, begin, painter, enabled }: StrokeOptions): void {
  const live = useRef({ order, save, armed, begin, painter });
  useLayoutEffect(() => {
    live.current = { order, save, armed, begin, painter };
  });
  // The row wearing the mouse's crosshair; put down as soon as the tool is.
  const aimed = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (armed) return;
    aimed.current?.style.removeProperty('cursor');
    aimed.current = null;
  }, [armed]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || !ready) return undefined;
    let stroke: Stroke | null = null;
    let point: { x: number; y: number } | null = null;
    let frame: number | null = null;

    // The word under the pointer, once a frame: a Pencil reports moves far more often than the screen draws.
    const reach = (x: number, y: number) => {
      const { order: currentOrder } = live.current;
      if (!stroke || !currentOrder) return;
      const word = wordAtPoint(root, x, y);
      if (!word || sameWord(word, stroke.last)) return;
      stroke.last = word;
      live.current.painter.draw(applyStroke(stroke.base, currentOrder, stroke.start, word, stroke.kind, stroke.erase));
    };
    const step = () => {
      frame = null;
      const at = point;
      point = null;
      if (at) reach(at.x, at.y);
    };

    const onDown = (event: PointerEvent) => {
      if (stroke || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const pen = event.pointerType === 'pen';
      const { order: currentOrder, armed: inHand, begin: beginStroke, painter: paint } = live.current;
      if (!currentOrder || (!inHand && !pen)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-verse]') || target.closest(PRESSABLE)) return;
      const word = wordAtPoint(root, event.clientX, event.clientY);
      if (!word) {
        recordDiagnostic('mark', { source: event.pointerType, result: 'missed' });
        return;
      }
      const kind = beginStroke(pen);
      if (!kind) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      // From what the page shows: strokes let go a moment ago, not yet back from their save, included.
      const kept = paint.shown();
      const erase = strokeErases(kept, word, kind);
      stroke = { pointerId: event.pointerId, input: event.pointerType, at: Date.now(), start: word, last: word, kind, erase, base: kept };
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone: the stroke ends with its own up or cancel.
      }
      paint.draw(applyStroke(kept, currentOrder, word, word, kind, erase));
    };

    const aim = (row: HTMLElement | null) => {
      if (row === aimed.current) return;
      aimed.current?.style.removeProperty('cursor');
      aimed.current = row;
      row?.style.setProperty('cursor', 'crosshair');
    };

    const onMove = (event: PointerEvent) => {
      if (!stroke && event.pointerType === 'mouse') {
        const target = event.target instanceof Element ? event.target : null;
        aim(live.current.armed ? target?.closest<HTMLElement>(VERSE_ROW) ?? null : null);
      }
      if (!stroke || event.pointerId !== stroke.pointerId) return;
      point = { x: event.clientX, y: event.clientY };
      if (frame === null) frame = window.requestAnimationFrame(step);
    };

    const onUp = (event: PointerEvent) => {
      if (!stroke || event.pointerId !== stroke.pointerId) return;
      // The last move may still wait for its frame: it counts first, then the point of release
      // (a release outside the text keeps the word the pointer reached).
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      const waiting = point;
      point = null;
      if (waiting) reach(waiting.x, waiting.y);
      reach(event.clientX, event.clientY);
      const { order: currentOrder, save: keep, painter: paint } = live.current;
      const { start, last, kind, erase, input, at } = stroke;
      stroke = null;
      const change: MarksChange | null = currentOrder ? (current) => applyStroke(current, currentOrder, start, last, kind, erase) : null;
      paint.release(change && keep(change) ? change : null);
      recordDiagnostic('mark', { source: input, result: currentOrder ? 'kept' : 'cancelled', code: kind.tool, elapsedMs: Date.now() - at });
    };

    const onCancel = (event: PointerEvent) => {
      if (!stroke || event.pointerId !== stroke.pointerId) return;
      // The page took the pull for a scroll: the words stay as they were.
      recordDiagnostic('mark', { source: stroke.input, result: 'cancelled', elapsedMs: Date.now() - stroke.at });
      stroke = null;
      point = null;
      live.current.painter.release(null);
    };

    // An Apple Pencil paints up and down too: its touches do not scroll the text while a stroke is on.
    const onTouchMove = (event: TouchEvent) => {
      const stylus = Array.from(event.touches).some((touch) => (touch as Touch & { touchType?: string }).touchType === 'stylus');
      if (stylus && stroke) event.preventDefault();
    };

    // No text selection under a tool: a long press or a pull would start one instead of a stroke.
    const onSelectStart = (event: Event) => {
      if (live.current.armed || stroke) event.preventDefault();
    };

    const onLeave = () => aim(null);

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('selectstart', onSelectStart);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('selectstart', onSelectStart);
      root.removeEventListener('pointerleave', onLeave);
      aim(null);
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (stroke) live.current.painter.release(null);
    };
  }, [enabled, ready, rootRef]);
}
