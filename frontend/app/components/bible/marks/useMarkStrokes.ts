import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { applyStroke, strokeErases, type BookMarks, type StrokeKind, type VerseOrder, type WordAt } from '@/utils/bibleMarks';

import { wordAtPoint } from './verseWordDom';

/*
 * A STROKE OVER THE WORDS — the gesture of the marks (the owner, 2026-10-16): a tool in hand, a press
 * on a word and a pull along the words paints them, whole words at a time; let go and the stroke is
 * kept. A mouse pulls as it likes. A finger with a tool in hand paints along the line and still scrolls
 * up and down: the text then answers only sideways pulls (`touch-action: pan-y`, set by the reader),
 * and a pull the page takes for a scroll cancels the stroke, leaving the words as they were. An Apple
 * Pencil paints at once with the last tool, nothing taken, up and down too: its touches are kept from
 * scrolling here. While the stroke is on, the page shows it; only the kept stroke is saved.
 */
type Stroke = { pointerId: number; start: WordAt; last: WordAt; kind: StrokeKind; erase: boolean; base: BookMarks };

type StrokeOptions = {
  /** The ribbon's article, on the page once `ready`. */
  rootRef: RefObject<HTMLElement | null>;
  ready: boolean;
  order: VerseOrder | null;
  marks: BookMarks;
  /** Keeps a stroke: how it changes the marks, laid over the newest stored copy. */
  save: (change: (marks: BookMarks) => BookMarks) => void;
  /** Whether a tool is in hand: a finger or a mouse paints only then. */
  armed: boolean;
  /** The stroke is starting: what it paints with, or nothing (no tool for this pointer). */
  begin: (pen: boolean) => StrokeKind | null;
  enabled: boolean;
};

const sameWord = (a: WordAt, b: WordAt) => a.verse === b.verse && a.index === b.index;

/** The marks to show: the kept ones, or those with the stroke being drawn. */
export function useMarkStrokes({ rootRef, ready, order, marks, save, armed, begin, enabled }: StrokeOptions): BookMarks {
  const [preview, setPreview] = useState<BookMarks | null>(null);
  const live = useRef({ order, marks, save, armed, begin });
  useLayoutEffect(() => {
    live.current = { order, marks, save, armed, begin };
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || !ready) return undefined;
    let stroke: Stroke | null = null;
    let shown: BookMarks | null = null;
    let frame: number | null = null;

    const draw = () => {
      frame = null;
      setPreview(shown);
    };
    const show = (next: BookMarks | null) => {
      shown = next;
      if (frame === null) frame = window.requestAnimationFrame(draw);
    };

    const onDown = (event: PointerEvent) => {
      if (stroke || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const pen = event.pointerType === 'pen';
      const { order: currentOrder, marks: kept, armed: inHand, begin: beginStroke } = live.current;
      if (!currentOrder || (!inHand && !pen)) return;
      const word = wordAtPoint(root, event.clientX, event.clientY);
      if (!word) return;
      const kind = beginStroke(pen);
      if (!kind) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      const erase = strokeErases(kept, word, kind);
      stroke = { pointerId: event.pointerId, start: word, last: word, kind, erase, base: kept };
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone: the stroke ends with its own up or cancel.
      }
      show(applyStroke(kept, currentOrder, word, word, kind, erase));
    };

    const onMove = (event: PointerEvent) => {
      const { order: currentOrder } = live.current;
      if (!stroke || event.pointerId !== stroke.pointerId || !currentOrder) return;
      const word = wordAtPoint(root, event.clientX, event.clientY);
      if (!word || sameWord(word, stroke.last)) return;
      stroke.last = word;
      show(applyStroke(stroke.base, currentOrder, stroke.start, word, stroke.kind, stroke.erase));
    };

    const onUp = (event: PointerEvent) => {
      if (!stroke || event.pointerId !== stroke.pointerId) return;
      const { order: currentOrder, save: keep } = live.current;
      const { start, last, kind, erase } = stroke;
      stroke = null;
      if (currentOrder) keep((current) => applyStroke(current, currentOrder, start, last, kind, erase));
      show(null);
    };

    const onCancel = (event: PointerEvent) => {
      if (!stroke || event.pointerId !== stroke.pointerId) return;
      // The page took the pull for a scroll: the words stay as they were.
      stroke = null;
      show(null);
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

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('selectstart', onSelectStart);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('selectstart', onSelectStart);
      if (frame !== null) window.cancelAnimationFrame(frame);
      setPreview(null);
    };
  }, [enabled, ready, rootRef]);

  return preview ?? marks;
}
