'use client';

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/** How long a button is held to do its long action — about the time Android and iOS take for their own. */
export const LONG_PRESS_MS = 500;
/** A finger that moves this far is scrolling, not holding. */
const MOVE_TOLERANCE_PX = 10;
/** The click a browser may send after the lift that ended a hold is not a press. */
const CLICK_AFTER_HOLD_MS = 400;

/** idle · holding (pressed, the time not yet run) · armed (held long enough: lifting does the long action). */
export type LongPressState = 'idle' | 'holding' | 'armed';

type LongPressHandlers = {
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onPointerCancel?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * A PRESS AND A HOLD ON ONE BUTTON (the owner, 2026-10-23: «нажал — следующий шаг, нажал и держишь —
 * открывается сразу»). A press — a tap, a click, Enter or Space — does `onPress`. A hold without moving
 * fills the button (`holding`, then `armed`) and does `onLongPress` when the finger lifts: the place opens
 * once the finger is off the screen, so the text that comes under it is not touched by the end of the hold,
 * and a hold can still be given up by sliding off. Moving, leaving the button or a scroll taking the touch
 * cancels it, and the click a browser still sends after a press given up so is no press: moved away is changed mind. The system's own long press — Android's menu, Safari's callout — is off on the button; the
 * button's classes also turn off text selection and the callout (`select-none [-webkit-touch-callout:none]`).
 * Without `onLongPress` the button is an ordinary one.
 */
export function useLongPress({ onPress, onLongPress }: { onPress: () => void; onLongPress?: () => void }): { state: LongPressState; handlers: LongPressHandlers } {
  const [state, setState] = useState<LongPressState>('idle');
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  /** The press was given up — moved away or left the button: the click that may follow it does nothing. */
  const abandoned = useRef(false);
  const heldUntil = useRef(0);

  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const reset = () => {
    stopTimer();
    origin.current = null;
    armed.current = false;
    setState('idle');
  };
  useEffect(() => stopTimer, []);

  if (!onLongPress) return { state: 'idle', handlers: { onClick: () => onPress() } };

  return {
    state,
    handlers: {
      onClick: (event) => {
        // Enter or Space clicks with no pointer behind it (`detail` 0): always a press, whatever a pointer did
        // before — a press dragged off the button sends no click, and its mark must not eat a key's (Codex review).
        const byPointer = event.detail > 0;
        const ignored = byPointer && (abandoned.current || performance.now() < heldUntil.current);
        abandoned.current = false;
        if (ignored) {
          event.preventDefault();
          return;
        }
        onPress();
      },
      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        stopTimer();
        armed.current = false;
        abandoned.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        setState('holding');
        timer.current = window.setTimeout(() => {
          timer.current = null;
          armed.current = true;
          setState('armed');
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event) => {
        const from = origin.current;
        if (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) <= MOVE_TOLERANCE_PX) return;
        abandoned.current = true;
        reset();
      },
      onPointerUp: () => {
        const held = armed.current;
        reset();
        if (!held) return;
        // A duration on the page's own clock, which never jumps with the wall clock.
        heldUntil.current = performance.now() + CLICK_AFTER_HOLD_MS;
        onLongPress();
      },
      // A touch leaves its button right after the lift, before the click: only a press still held is given up.
      onPointerLeave: () => {
        if (origin.current) abandoned.current = true;
        reset();
      },
      onPointerCancel: reset,
      onContextMenu: (event) => event.preventDefault(),
    },
  };
}
