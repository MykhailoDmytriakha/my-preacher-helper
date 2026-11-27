'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Runs the choice anyway if the menu never hands focus back (a later library that stops doing it). */
const HANDOFF_FALLBACK_MS = 300;

/**
 * A WINDOW CHOSEN IN A HEADLESS UI MENU OPENS ONCE THE MENU HAS HANDED FOCUS BACK TO ITS BUTTON.
 *
 * Choosing an item closes the menu, and a frame later the menu gives focus back to its button — unless a
 * control it counts as focusable holds it by then. The app's windows focus themselves (`tabindex="-1"`, so a
 * phone keeps its keyboard down: `useModalLayer`), which the menu does not count. Opened at once from the item,
 * the window had the keyboard for a frame and lost it to the button behind it: Enter pressed the button under
 * the window (2026-11-26, the theme's «⋯» on `care/questions/[themeId]`). So the choice waits for the button's
 * focus, and then for the rest of that frame: chosen by Enter, the menu hands focus back twice in one frame (from
 * the item and from its key handler), and a window opened on the first would lose the keyboard to the second.
 * The window then takes focus last and gives it back to the button when it closes.
 *
 * Use: `onFocus={menu.onButtonFocus}` on the `MenuButton`, `onClick={menu.later(open)}` on each item's button.
 */
export function useAfterMenuCloses() {
  const pending = useRef<(() => void) | null>(null);
  const fallback = useRef<number | undefined>(undefined);
  const run = useCallback(() => {
    const action = pending.current;
    pending.current = null;
    window.clearTimeout(fallback.current);
    action?.();
  }, []);
  // A task, not at once: it runs after every frame callback the menu queued alongside this one.
  const onButtonFocus = useCallback(() => {
    if (!pending.current) return;
    window.clearTimeout(fallback.current);
    fallback.current = window.setTimeout(run, 0);
  }, [run]);
  const later = useCallback((action: () => void) => () => {
    pending.current = action;
    window.clearTimeout(fallback.current);
    fallback.current = window.setTimeout(run, HANDOFF_FALLBACK_MS);
  }, [run]);
  useEffect(() => () => window.clearTimeout(fallback.current), []);
  return { later, onButtonFocus };
}
