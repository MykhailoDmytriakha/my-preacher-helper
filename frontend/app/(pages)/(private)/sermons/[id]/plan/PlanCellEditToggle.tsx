'use client';

import { FileText, Pencil } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useTranslation } from '@locales/useTranslation';

/**
 * THE EDIT / READ SWITCH OF ONE PLAN CELL, STANDING WITH ITS TEXT.
 *
 * It used to sit in the point's header among save, generate and delete, and switched every cell
 * of the point at once — far from the text it opened, and not about any one text (owner,
 * 2026-11-21). Each cell — the point's own text and each sub-point's — now carries its own switch:
 * in the corner of the text while reading, at the end of the editor's toolbar while writing.
 * Every plan screen (written by hand, from thoughts, from the note) uses this one control.
 */
export function PlanCellEditToggle({ editing, onToggle, className = '', takeFocus = false }: {
  editing: boolean;
  onToggle: () => void;
  className?: string;
  /** The cell was just closed from its toolbar: the switch it returns to takes the focus back. */
  takeFocus?: boolean;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (takeFocus) button.current?.focus(); }, [takeFocus]);
  const label = t(editing ? 'plan.viewMode' : 'plan.editMode');
  return (
    <button
      ref={button}
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white ${className}`}
    >
      {editing ? <FileText className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
    </button>
  );
}
