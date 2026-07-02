'use client';

import { LightBulbIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PointNoteProps {
  /** Current note text (undefined/empty = no note). */
  note?: string;
  /** Persist a new value; `undefined` clears the note. */
  onChange: (note: string | undefined) => void;
  isReadOnly?: boolean;
  /** Left indent so the note lines up under the point / sub-point text. */
  indentClass?: string;
  /**
   * Extra classes for the empty "+ note" affordance — the PARENT owns the hover group,
   * so it decides how the affordance reveals (e.g. `lg:group-hover/subpoint:opacity-100`).
   */
  addRevealClass?: string;
}

/**
 * Reminder note ("what I want to say here") shown under a plan point or sub-point —
 * a skeleton hint jotted BEFORE the point is filled with full thoughts, kept separate
 * from them. Buttonless editing: click away (blur) or Enter saves, Escape cancels; a
 * faint × deletes (undo-able upstream). Self-contained edit state, so it drops into any
 * editor (the plan-editor board and the structure-page columns share this one component).
 */
const PointNote: React.FC<PointNoteProps> = ({
  note,
  onChange,
  isReadOnly = false,
  indentClass = '',
  addRevealClass = 'opacity-100',
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // Distinguishes a real blur-save from an Escape-cancel (Escape also blurs the field).
  const blurSaveRef = useRef(true);

  const startEdit = () => {
    if (isReadOnly) return;
    blurSaveRef.current = true;
    setText(note ?? '');
    setEditing(true);
  };

  const commit = () => {
    const next = text.trim() || undefined;
    // Skip the persist/toast when nothing actually changed (e.g. opened the field
    // and clicked away, or edited back to the original) — no spurious write.
    if (next !== note) onChange(next);
    setEditing(false);
  };

  const cancel = () => {
    blurSaveRef.current = false; // the imminent blur must NOT save
    setEditing(false);
  };

  const commitFromBlur = () => {
    if (!blurSaveRef.current) {
      blurSaveRef.current = true;
      return;
    }
    commit();
  };

  if (editing) {
    return (
      <div className={`${indentClass} mt-1`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitFromBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={t('planEditor.note.placeholder')}
          rows={2}
          className="w-full resize-none px-2 py-1 text-xs bg-amber-50 dark:bg-amber-900/15 text-slate-700 dark:text-amber-50/90 rounded border border-amber-300 dark:border-amber-700/50 focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-amber-700/40 dark:placeholder:text-amber-200/30"
          autoFocus
        />
      </div>
    );
  }

  if (note) {
    return (
      <div
        className={`${indentClass} mt-1 flex items-start gap-1 text-xs italic text-slate-500 dark:text-gray-400 ${
          isReadOnly ? '' : 'cursor-text hover:text-slate-700 dark:hover:text-gray-300'
        }`}
        onClick={isReadOnly ? undefined : startEdit}
        title={isReadOnly ? undefined : t('planEditor.note.label')}
      >
        <LightBulbIcon className="mt-px h-3 w-3 flex-shrink-0 not-italic text-amber-500/80 dark:text-amber-400/70" />
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{note}</span>
        {!isReadOnly && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(undefined);
            }}
            className="not-italic flex-shrink-0 rounded p-0.5 text-slate-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50"
            aria-label={t('planEditor.note.delete')}
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  if (isReadOnly) return null;

  return (
    <button
      onClick={startEdit}
      className={`${indentClass} mt-1 inline-flex items-center gap-1 rounded text-xs text-slate-400 dark:text-gray-500 transition-colors hover:text-amber-600 dark:hover:text-amber-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50 ${addRevealClass}`}
      aria-label={t('planEditor.note.label')}
    >
      <LightBulbIcon className="h-3 w-3" />
      <span>{t('planEditor.note.add')}</span>
    </button>
  );
};

export default PointNote;
