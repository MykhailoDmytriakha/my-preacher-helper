'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * An action from a window over the reader — "Open" in the window of links, "Open in this translation"
 * in the window of a verse marked in another Bible: the window closes first and the reader acts a frame
 * later. On iOS the window pins the page (`useScrollLock`) and, released, puts it back where it was — a
 * jump made while it was pinned was undone, the passage lit out of sight, and a place written down then
 * is not the one read. The pending action is kept until the frame runs, so an effect run again in
 * between schedules it anew instead of losing it.
 */
export function useFollowAfterClose<Args extends unknown[]>(open: boolean, close: () => void, follow: (...args: Args) => void) {
  const pendingRef = useRef<Args | null>(null);
  useEffect(() => {
    const pending = pendingRef.current;
    if (open || !pending) return undefined;
    const frame = window.requestAnimationFrame(() => {
      pendingRef.current = null;
      follow(...pending);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [follow, open]);
  return useCallback((...args: Args) => {
    pendingRef.current = args;
    close();
  }, [close]);
}

