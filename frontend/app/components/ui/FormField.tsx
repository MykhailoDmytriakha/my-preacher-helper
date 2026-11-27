import { useId } from 'react';

import { FORM_COLORS } from '@/utils/themeColors';

import type { ReactNode } from 'react';


export const FORM_INPUT_CLASS = `w-full resize-none rounded-xl border px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition ${FORM_COLORS.field}`;

/** Native fields use their label; compound controls share a labelled group. */
export default function FormField({ label, required = false, group = false, children }:
  { label: ReactNode; required?: boolean; group?: boolean; children: ReactNode }) {
  const labelId = useId();
  const caption = <span id={group ? labelId : undefined} className="text-sm font-semibold text-gray-800 dark:text-gray-200">
    {label}{required && ' *'}
  </span>;
  const layout = 'block space-y-2';
  return group
    ? <div role="group" aria-labelledby={labelId} className={layout}>{caption}{children}</div>
    : <label className={layout}>{caption}{children}</label>;
}
