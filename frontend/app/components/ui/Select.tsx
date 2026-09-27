'use client';

import React from 'react';

import { ChevronIcon } from '@/components/Icons';
import {
  buildSelectClasses,
  SELECT_CHEVRON_CLASSES,
  type SelectAccent,
  type SelectSize,
  type SelectTone,
} from '@/utils/selectClasses';

export type { SelectAccent, SelectSize, SelectTone };

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** `sm` for a dense filter row, `md` for a field inside a form. */
  size?: SelectSize;
  /** `muted` for a control sitting on a panel that already has its own plate. */
  tone?: SelectTone;
  /** The focus ring's colour — the section's colour, not the control's own choice. */
  accent?: SelectAccent;
  /** Classes for the wrapper, not the control — width lives here (`sm:w-52`, `flex-1`). */
  wrapperClassName?: string;
}

/**
 * The app's dropdown: one arrow, always the same, always in the same place.
 *
 * Three different things used to happen to this one control. Most `<select>`s kept the
 * browser's own arrow, flush against the right edge — so a filter whose longest option is
 * long left dead space between its label and its arrow, and two filters side by side never
 * matched. A few hid that arrow with `appearance-none` and drew nothing in its place,
 * leaving a field that reads as a text input until it is clicked. Only the series filters
 * drew their own. This is that one, for everyone.
 *
 * Width is deliberately the caller's, on the wrapper: a filter row wants every filter the
 * same width whatever its longest option happens to be, which is exactly what the browser's
 * own sizing will not do.
 */
export default function Select({
  size = 'md',
  tone = 'field',
  accent = 'neutral',
  className,
  wrapperClassName,
  children,
  ...props
}: SelectProps) {
  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <select {...props} className={buildSelectClasses(size, tone, accent, className)}>
        {children}
      </select>
      {/* pointer-events-none: the arrow is paint; the click belongs to the select beneath it. */}
      <ChevronIcon
        aria-hidden="true"
        direction="down"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 ${SELECT_CHEVRON_CLASSES[size]}`}
      />
    </div>
  );
}
