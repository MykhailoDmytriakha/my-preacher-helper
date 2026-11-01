'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { pulledRow, verseAfter, verseBefore } from './passagePick';

import type { VerseCopy } from './useVerseCopy';
import type { BookText } from '@/utils/bibleText';

type End = 'first' | 'last';
type Spot = { x: number; y: number };
/** A grip held: which end, by which pointer, and where that pointer last was (px in the viewport). */
type Pull = { end: End; pointerId: number; clientY: number };

/** How near the text's edge a pulled grip scrolls it, and by how much a step. */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 14;

/**
 * THE GRIPS OF A CHOSEN PASSAGE (the owner, 01.11: «было понятно, что можно его протянуть вверх или вниз, и тогда было
 * понятно, что это диапазон»): a pill on the top edge of the first verse chosen and one on the bottom edge of the last —
 * one verse or several, the grips say the run can be pulled. Pulled, a grip follows the mouse or the finger itself, frame by
 * frame, and the run takes a verse once the pointer is past that verse's middle; let go, the grip sits on the run's edge
 * (the owner, 01.11: the grip lagged behind the mouse, and a verse came at its edge, not at its half). Held at the pane's
 * edge, the text scrolls on under a still finger. One grip is pulled at a time; a choice let go of mid-pull ends the pull.
 * The arrow keys move an end a verse at a time, to a verse on screen. A pull keeps the passage's rule as a press does
 * (`useVerseCopy().moveEnd`). Drawn over the text card while verses are chosen for an analysis or a comment, measured from
 * the rows themselves.
 */
export function PassageGrips({ root, copy, text, drawn }: {
  /** The text card the ribbon is drawn in (`position: relative`). */
  root: RefObject<HTMLElement | null>;
  copy: VerseCopy;
  text: BookText | null;
  /** The chapters drawn of a big book: rows come and go. */
  drawn?: unknown;
}) {
  const { t } = useTranslation();
  const passage = copy.passage;
  const [spots, setSpots] = useState<{ first: Spot | null; last: Spot | null }>({ first: null, last: null });
  const pull = useRef<Pull | null>(null);
  // Takes the pull's listeners off the window.
  const unlisten = useRef<(() => void) | null>(null);
  // While a grip is pulled, where the pointer is (px in the card): the grip stands there, not on the run's edge.
  const [drag, setDrag] = useState<{ end: End; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  // What a frame works with: the latest passage and picker, not those of the render that asked for the frame.
  const live = useRef({ copy, passage });
  useLayoutEffect(() => { live.current = { copy, passage }; });
  const first = passage ? `${passage.chapter}:${passage.fromVerse}` : null;
  const last = passage ? `${passage.toChapter}:${passage.toVerse}` : null;

  useLayoutEffect(() => {
    const card = root.current;
    if (!card || !first || !last) { setSpots({ first: null, last: null }); return undefined; }
    const measure = () => {
      const box = card.getBoundingClientRect();
      const spotOf = (key: string, edge: 'top' | 'bottom'): Spot | null => {
        const row = card.querySelector<HTMLElement>(`[data-verse="${key}"]`)?.getBoundingClientRect();
        if (!row) return null;
        // On the edge of the row's light, which stands 6 px beyond the row (`CHOSEN_CLASSES`, `-inset-1.5`).
        return { x: row.left + row.width / 2 - box.left - card.clientLeft, y: (edge === 'top' ? row.top - 6 : row.bottom + 6) - box.top - card.clientTop };
      };
      setSpots({ first: spotOf(first, 'top'), last: spotOf(last, 'bottom') });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [root, first, last, drawn]);

  const stop = useCallback(() => {
    unlisten.current?.();
    unlisten.current = null;
    pull.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    setDrag(null);
  }, []);
  // A choice let go of mid-pull — ✕, Escape, another book — ends the pull: no pointer moves a later choice unpressed (Codex
  // review r3). Gone, the grips leave no frame behind.
  const choosing = passage !== null;
  useEffect(() => { if (!choosing) stop(); }, [choosing, stop]);
  useEffect(() => () => {
    unlisten.current?.();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  if (!passage || !text) return null;

  // The verse a pulled end stands at: past a row's middle, that row's verse (`pulledRow`).
  const verseAt = (y: number, end: End) => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-verse]') ?? [])];
    const row = rows[pulledRow(rows.map((one) => { const box = one.getBoundingClientRect(); return (box.top + box.bottom) / 2; }), y, end)];
    const [chapter, verse] = (row?.dataset.verse ?? '').split(':').map(Number);
    return row ? { chapter, verse } : null;
  };
  // The end follows the pointer, under the passage's rule; nothing is asked of the picker when it already stands there.
  const follow = (now: Pull) => {
    const { copy: picker, passage: run } = live.current;
    const verse = verseAt(now.clientY, now.end);
    if (!run || !verse) return;
    const at = endOf(run, now.end);
    if (verse.chapter !== at.chapter || verse.verse !== at.verse) picker.moveEnd(now.end, verse);
  };
  /** A step of the text towards the pointer near the pane's edge; whether the text moved — at its end it does not. */
  const scrollNear = (y: number) => {
    const pane = root.current?.closest<HTMLElement>('.overflow-y-auto');
    const top = pane ? pane.getBoundingClientRect().top : 0;
    const bottom = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
    const by = y > bottom - SCROLL_EDGE ? SCROLL_STEP : y < top + SCROLL_EDGE ? -SCROLL_STEP : 0;
    if (!by) return false;
    const before = pane ? pane.scrollTop : window.scrollY;
    if (pane) pane.scrollTop += by; else window.scrollBy(0, by);
    return (pane ? pane.scrollTop : window.scrollY) !== before;
  };
  // One frame: the text scrolls first, then the grip is placed and the end found — measured after the scroll, so the grip
  // stays under the pointer (Codex review r3: measured before, it lagged a step behind at the edge).
  const tick = () => {
    frame.current = null;
    const now = pull.current;
    const card = root.current;
    if (!now || !card) return;
    const scrolled = scrollNear(now.clientY);
    setDrag({ end: now.end, y: now.clientY - card.getBoundingClientRect().top - card.clientTop });
    follow(now);
    if (scrolled) frame.current = requestAnimationFrame(tick);
  };
  const onPointerDown = (end: End) => (event: PointerEvent<HTMLButtonElement>) => {
    // The grip's own press: no verse is pressed under it, and the page does not scroll or select while it is pulled.
    event.preventDefault();
    event.stopPropagation();
    // One grip at a time: a second finger on the other grip does not take the first one's pull.
    if (pull.current) return;
    // The default taken away, the press would not focus the grip: the arrows go on from the grip pressed.
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pull.current = { end, pointerId: event.pointerId, clientY: event.clientY };
    // The pull is followed on the window, not on the grip: a grip whose verse scrolls out of the chapters drawn goes, and
    // its release still ends the pull (Codex review r3). Everything read in them is read through refs.
    const move = (moved: globalThis.PointerEvent) => {
      const now = pull.current;
      if (!now || now.pointerId !== moved.pointerId) return;
      now.clientY = moved.clientY;
      // One state change a frame, however fast the pointer moves.
      if (frame.current === null) frame.current = requestAnimationFrame(tick);
    };
    const release = (released: globalThis.PointerEvent) => {
      const now = pull.current;
      if (!now || now.pointerId !== released.pointerId) return;
      // Let go before the frame came: the end still goes where the pointer was let go. A press with no move moves nothing.
      if (frame.current !== null) { now.clientY = released.clientY; follow(now); }
      // The click the browser may send after the lift is this pull's, not a press on a verse (`useVerseCopy().pullEnded`);
      // a pull the browser broke off sends none.
      live.current.copy.pullEnded(released.type === 'pointerup' ? released.pointerId : null);
      stop();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    unlisten.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  };
  const onKeyDown = (end: End) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next = event.key === 'ArrowUp' ? verseBefore(text, endOf(passage, end)) : verseAfter(text, endOf(passage, end));
    // To a verse on screen only: one of a chapter not drawn (a big book) would take the grip, and the focus, off the page.
    if (next && root.current?.querySelector(`[data-verse="${next.chapter}:${next.verse}"]`)) copy.moveEnd(end, next, 'arrow');
  };
  const grip = (end: End, edge: Spot | null) => {
    const spot = edge && drag?.end === end ? { x: edge.x, y: drag.y } : edge;
    return spot ? (
    <button
      key={end}
      type="button"
      data-passage-grip={end}
      aria-label={t(end === 'first' ? 'bible.passageGripFirst' : 'bible.passageGripLast')}
      title={t(end === 'first' ? 'bible.passageGripFirst' : 'bible.passageGripLast')}
      onPointerDown={onPointerDown(end)}
      onKeyDown={onKeyDown(end)}
      onClick={(event) => event.stopPropagation()}
      style={{ left: spot.x, top: spot.y }}
      className={`pointer-events-auto absolute h-3 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none rounded-full border-2 border-white bg-indigo-600 shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-gray-900 dark:bg-indigo-400 ${drag?.end === end ? 'scale-110' : 'transition-transform hover:scale-110'}`}
    />
    ) : null;
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]" data-testid="passage-grips">
      {grip('first', spots.first)}
      {grip('last', spots.last)}
    </div>
  );
}

/** Where one end of a passage stands. */
const endOf = (passage: { chapter: number; fromVerse: number; toChapter: number; toVerse: number }, end: End) =>
  (end === 'first' ? { chapter: passage.chapter, verse: passage.fromVerse } : { chapter: passage.toChapter, verse: passage.toVerse });
