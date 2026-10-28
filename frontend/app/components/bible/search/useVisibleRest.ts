'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `onRest` once when `key` has stood `ms` of VISIBLE time with `inSight` true: the clock stops while the tab is
 * hidden or what it waits on is covered, and starts again from naught when `key` changes. A browser slows a hidden
 * tab's timers, so the time is counted, not awaited (Codex, 2026-10-27).
 */
export function useVisibleRest(key: string | null, inSight: boolean, ms: number, onRest: () => void): void {
  const rest = useRef(onRest);
  const spent = useRef<{ key: string | null; ms: number }>({ key: null, ms: 0 });
  useEffect(() => {
    rest.current = onRest;
  });
  useEffect(() => {
    if (spent.current.key !== key) spent.current = { key, ms: 0 };
    if (key === null || !inSight || spent.current.ms >= ms) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let since = 0;
    const start = () => {
      if (timer !== null || document.visibilityState === 'hidden') return;
      since = performance.now();
      timer = setTimeout(() => {
        timer = null;
        spent.current.ms = ms;
        rest.current();
      }, ms - spent.current.ms);
    };
    const stop = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      spent.current.ms += performance.now() - since;
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [key, inSight, ms]);
}
