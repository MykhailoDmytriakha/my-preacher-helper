"use client";

import { useCallback, useLayoutEffect, useRef, type UIEvent } from 'react';

export const TIME_WHEEL_ITEM_HEIGHT = 32;

/** Selection belongs to the person; delayed snapping only aligns its visual position. */
export function useTimeWheel(value: number, maximum: number, onChange: (value: number) => void, scope?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const snap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fromWheel = useRef(false);
  const previousScope = useRef(scope);

  const cancelSnap = useCallback(() => {
    if (snap.current !== null) clearTimeout(snap.current);
    snap.current = null;
  }, []);

  const align = useCallback((selected: number) => {
    cancelSnap();
    fromWheel.current = false;
    // An animated intermediate position must never become a new selected value.
    ref.current?.scrollTo({ top: selected * TIME_WHEEL_ITEM_HEIGHT, behavior: 'instant' });
  }, [cancelSnap]);

  useLayoutEffect(() => {
    const sameScope = previousScope.current === scope;
    previousScope.current = scope;
    if (sameScope && fromWheel.current) {
      fromWheel.current = false;
      return; // Leave the person's native gesture and inertia alone.
    }
    align(value);
  }, [align, scope, value]);

  useLayoutEffect(() => cancelSnap, [cancelSnap]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const selected = Math.min(maximum, Math.max(0, Math.round(event.currentTarget.scrollTop / TIME_WHEEL_ITEM_HEIGHT)));
    if (selected !== value) {
      fromWheel.current = true;
      onChange(selected);
    }
    cancelSnap();
    snap.current = setTimeout(() => align(selected), 150);
  }, [align, cancelSnap, maximum, onChange, value]);

  return { ref, onScroll, align };
}
