'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * An item cut by the row's edge fades out instead of standing there as a broken pill (a capsule's rounding
 * cut one to a sliver). Only an end that hides items fades: at rest the row's first and last items stand
 * whole.
 */
const FADED_ENDS = {
  none: '',
  start: '[mask-image:linear-gradient(to_right,transparent,#000_1.5rem)]',
  end: '[mask-image:linear-gradient(to_left,transparent,#000_1.5rem)]',
  both: '[mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]',
} as const;

/**
 * A ROW THAT SLIDES UNDER THE FINGER when it is wider than its place — the Bible's place trail, Studies' tabs on a
 * phone. Its hidden ends fade, so the eye sees there is more beyond the edge; and the item the row is on — the one
 * `currentSelector` finds inside it — stands in the middle whenever `current` changes, so a row opened on its last
 * tab does not show the first ones only. The row must be the item's offset parent (positioned, or the item's own
 * frame). `fade` goes on the row's classes.
 */
export function useSlidingRow<T extends HTMLElement>(currentSelector: string, current: unknown, { center = true }: { center?: boolean } = {}) {
  const rowRef = useRef<T | null>(null);
  const [ends, setEnds] = useState<keyof typeof FADED_ENDS>('none');
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const measure = () => {
      const start = row.scrollLeft > 1;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setEnds(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
    };
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    sizes?.observe(row);
    if (row.firstElementChild) sizes?.observe(row.firstElementChild);
    return () => {
      row.removeEventListener('scroll', measure);
      sizes?.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    if (!center) return;
    const row = rowRef.current;
    const item = row?.querySelector<HTMLElement>(currentSelector);
    if (!row || !item) return;
    row.scrollLeft = Math.max(0, item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2);
  }, [center, current, currentSelector]);
  return { rowRef, fade: FADED_ENDS[ends] };
}
