'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A handler that keeps one identity for the life of the component and always calls the latest one passed: a memoized
 * part of the screen is not drawn again only because its parent made a new closure (the Bible search's hundred results
 * drew again on every letter typed, 2026-10-27).
 */
export function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
