'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { pinnedPageScrollTop } from '@/hooks/useScrollLock';

import type { ReadingSurface } from './readingSurface';

/** A span of the screen, in viewport pixels. */
export type ScreenSpan = { top: number; bottom: number };

/** The air left between a thing brought into sight and the edge it was brought to, px. */
const SIGHT_MARGIN = 12;
/** How long a written comment is looked for on the page after its save, in frames (~1.5 s): its row may come a little later. */
const WRITTEN_FRAMES = 90;
/** After the finger or the button is lifted: the click the browser may send then lands where it was pressed. */
const AFTER_LIFT_MS = 120;

/**
 * HOW FAR THE TEXT MOVES SO A THING IS SEEN (visual pass, 2026-11-07): by how many pixels to scroll — up negative, down
 * positive — for `box` to stand inside `room` with a little air; 0 when it does already. Up when it is above the room (a
 * heading written over the top verse goes under the header), down when it is below (a verse chosen low goes under the bar
 * of the verses chosen) — but never so far that its top leaves the room: a thing taller than the room shows its start.
 */
export function sightShift(box: ScreenSpan, room: ScreenSpan, margin = SIGHT_MARGIN): number {
  if (box.top < room.top) return box.top - room.top - margin;
  if (box.bottom > room.bottom) return Math.max(0, Math.min(box.bottom - room.bottom + margin, box.top - room.top - margin));
  return 0;
}

/**
 * Scrolls the reader's surface (the page on a phone, the text's pane on a wide screen) so `box` stands in `room`. Not
 * `utils/revealBelow`: that one scrolls the page only and knows the sticky top only — a control above the text on
 * arrival; here what scrolls is the reader's surface, and the room has a lower edge too (the bar of the verses chosen).
 */
function bringIntoSight(surface: ReadingSurface, box: ScreenSpan, room: ScreenSpan): void {
  const shift = sightShift(box, room);
  // Never farther than a screen: what is farther is not where the person is — the heading of a paragraph chosen from ten
  // chapters above, read at its end — and the text is not carried there (Codex review, 2026-11-07).
  if (shift !== 0 && Math.abs(shift) <= surface.height()) surface.scrollTo(surface.top() + shift);
}

type VerseAt = { chapter: number; verse: number };
const order = (at: VerseAt) => at.chapter * 1000 + at.verse;
const keyOf = (at: VerseAt) => `${at.chapter}:${at.verse}`;

/**
 * The verse the person just pressed or held, from the choice before and after it: the one verse that started it, a verse
 * added, or — a hold taking every verse up to it — the far end of what came: below the choice, its last; above, its first.
 * Null when nothing came (a verse let go): nothing new to see.
 */
export function touchedVerse(before: readonly VerseAt[] | null, after: readonly VerseAt[] | null): VerseAt | null {
  if (!after?.length) return null;
  const had = new Set((before ?? []).map(keyOf));
  const came = after.filter((at) => !had.has(keyOf(at))).sort((a, b) => order(a) - order(b));
  if (!came.length) return null;
  if (!before?.length) return came[0];
  const lastBefore = Math.max(...before.map(order));
  const last = came[came.length - 1];
  return order(last) > lastBefore ? last : came[0];
}

/**
 * THE VERSE JUST CHOSEN STAYS IN SIGHT (visual pass, 2026-11-07): on a phone the bar of the verses chosen takes the lower
 * quarter of the screen, and a verse held there went under it — the bar named «Кол 3:24», the verse itself was hidden. Once
 * the finger or the button is lifted — moved while still pressed, the text would slide under it — the text moves up just
 * enough for the verse to stand above the bar. Only for a verse that came into the choice: one let go, or the person
 * scrolling with the bar open, moves nothing.
 */
export function useChosenVerseInSight({ picked, textRef, surfaceRef, readingInsetRef }: {
  picked: readonly VerseAt[] | null;
  textRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<ReadingSurface>;
  readingInsetRef: RefObject<number>;
}): void {
  // Every pointer on the screen, by its id: a finger resting on the text while the Pencil holds a verse keeps the text
  // still after the Pencil is lifted (Codex review, 2026-11-07 — one flag for all pointers let it slide under the finger).
  const pressed = useRef(new Set<number>());
  useEffect(() => {
    const down = (event: PointerEvent) => { pressed.current.add(event.pointerId); };
    const up = (event: PointerEvent) => { pressed.current.delete(event.pointerId); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
  const before = useRef<readonly VerseAt[] | null>(null);
  useEffect(() => {
    const touched = touchedVerse(before.current, picked);
    before.current = picked;
    if (!touched) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = () => {
      // A new press since: that gesture's own — this one waits for its lift too.
      if (pressed.current.size) return;
      window.removeEventListener('pointerup', lifted, true);
      window.removeEventListener('pointercancel', lifted, true);
      const row = textRef.current?.querySelector<HTMLElement>(`[data-verse="${keyOf(touched)}"]`);
      const bar = document.querySelector<HTMLElement>('[data-verse-bar]');
      const surface = surfaceRef.current;
      if (!row || !bar || !surface) return;
      const box = row.getBoundingClientRect();
      bringIntoSight(surface, box, { top: surface.edge() + (readingInsetRef.current ?? 0), bottom: Math.min(bar.getBoundingClientRect().top, surface.bottom()) });
    };
    // Every lift starts the wait again; the text moves once no pointer is down and the browser's click after the lift has
    // landed where it was pressed. A hold that chose on the lift itself waits the same.
    function lifted() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(look, AFTER_LIFT_MS);
    }
    window.addEventListener('pointerup', lifted, true);
    window.addEventListener('pointercancel', lifted, true);
    lifted();
    return () => {
      window.removeEventListener('pointerup', lifted, true);
      window.removeEventListener('pointercancel', lifted, true);
      if (timer) clearTimeout(timer);
    };
  }, [picked, readingInsetRef, surfaceRef, textRef]);
}

/**
 * WHAT WAS JUST WRITTEN COMES INTO SIGHT (visual pass, 2026-11-07): a paragraph written on the verse at the top of the screen
 * got its heading above that verse — under the header, unseen: the window closed and nothing seemed to happen. After a
 * save the comment's own row — a heading or the words under a verse, by its `data-comment` — is looked for a
 * moment, the page pinned under the window let go first, and the text moves just enough for it to stand in the room
 * under the header. Only the person's own save calls it: a comment arriving from another device never moves the text.
 */
export function useRevealWritten({ textRef, surfaceRef, readingInsetRef }: {
  textRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<ReadingSurface>;
  readingInsetRef: RefObject<number>;
}): (id: string) => void {
  const frame = useRef<number | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return useCallback((id: string) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    let left = WRITTEN_FRAMES;
    const look = () => {
      frame.current = null;
      const root = textRef.current;
      const surface = surfaceRef.current;
      // A heading's block or a comment's whole row — mark, place and words (`CommentsOnText`): the first in the page is the outer.
      const found = root?.querySelector<HTMLElement>(`[data-comment="${CSS.escape(id)}"]`);
      if (found && surface && pinnedPageScrollTop() === null) {
        bringIntoSight(surface, found.getBoundingClientRect(), { top: surface.edge() + (readingInsetRef.current ?? 0), bottom: surface.bottom() });
        return;
      }
      left -= 1;
      if (left > 0) frame.current = requestAnimationFrame(look);
    };
    frame.current = requestAnimationFrame(look);
  }, [readingInsetRef, surfaceRef, textRef]);
}
