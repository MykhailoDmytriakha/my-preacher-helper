import { FORM_COLORS } from '@/utils/themeColors';

import type { ReactNode } from 'react';


export const FORM_INPUT_CLASS = `w-full rounded-xl border px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition ${FORM_COLORS.field}`;

/** The caller owns its native input and validation; this owns consistent labeling. */
export default function FormField({ label, required = false, children }: { label: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}{required && ' *'}</span>
      {children}
    </label>
  );
}
