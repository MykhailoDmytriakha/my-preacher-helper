'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * WHILE A SERMON IS PREACHED, THE SCREEN SAYS NOTHING BUT THE SERMON (owner, 2026-11-17: «на странице
 * проповеди, когда проповедуется, ничего не должно выскакивать, ничего не должно отвлекать»).
 *
 * A screen that must not be interrupted holds the app quiet; every notice that would otherwise appear
 * over it — a sync status, the offline line, a recovery prompt — asks `useQuietScreen()` and waits.
 * Nothing is dropped: the same notice speaks as soon as the hold is released, on the screen the person
 * returns to (BUG-20261117-preaching-screen-shows-sync-notice). Work behind a notice keeps running: a
 * quiet screen hides words, it never unmounts a worker.
 *
 * The chrome that knows the address holds it (`PrivateChrome`), so a notice does not need to know which
 * screen is being preached from.
 */

let holds = 0;
const listeners = new Set<() => void>();

const tell = () => { listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Whether some screen holds the app quiet right now. */
export const screenIsQuiet = (): boolean => holds > 0;

/** Holds the app quiet until the returned function is called; calling it twice releases once. */
export function holdQuietScreen(): () => void {
  holds += 1;
  tell();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    tell();
  };
}

/** True while a screen holds the app quiet; a notice reading it stays silent until then. */
export function useQuietScreen(): boolean {
  return useSyncExternalStore(subscribe, screenIsQuiet, () => false);
}

/**
 * Holds the app quiet while `active`. A layout effect, so a notice rendered in the same commit is
 * silenced before the screen is painted rather than flashing for a frame.
 */
export function useHoldQuietScreen(active: boolean): void {
  useLayoutEffect(() => (active ? holdQuietScreen() : undefined), [active]);
}
