'use client';

import { TrashIcon } from '@heroicons/react/24/outline';

import type { ButtonHTMLAttributes } from 'react';

/**
 * A DELETE ACTION DRAWN AS A TRASH CAN (owner, 2026-11-21). Quiet grey where a pointer can hover, red under it; red at
 * once where nothing hovers — a phone, an iPad without a trackpad — because there a tap is the only way to find out what
 * it does. The label is its name for a screen reader and its tooltip; the action itself asks before it deletes.
 */
export function DeleteIconButton({ label, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 [@media(hover:none)]:text-red-600 dark:[@media(hover:none)]:text-red-400 ${className}`}
    >
      <TrashIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
