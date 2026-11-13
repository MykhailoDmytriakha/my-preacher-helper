'use client';

import { useEffect, useRef, useState } from 'react';

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

/** Fade only the ends of a horizontal row that currently hide content. */
export function useSlidingRow<T extends HTMLElement>() {
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
  return { rowRef, fade: FADED_ENDS[ends] };
}
