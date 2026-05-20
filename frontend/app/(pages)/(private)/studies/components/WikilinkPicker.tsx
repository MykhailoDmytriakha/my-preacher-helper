'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStudyNotes } from '@/hooks/useStudyNotes';
import { getStudyText } from '@/utils/nodeTreeAdapter';

interface WikilinkPickerPosition {
  top: number;
  left: number;
}

interface WikilinkPickerProps {
  open: boolean;
  position?: WikilinkPickerPosition;
  onPick: (noteId: string) => void;
  onClose: () => void;
  currentNoteId?: string;
}

function getSnippet(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 30);
}

export default function WikilinkPicker({
  open,
  position,
  onPick,
  onClose,
  currentNoteId,
}: WikilinkPickerProps) {
  const { t } = useTranslation();
  const { notes, loading } = useStudyNotes();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const visibleNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return notes
      .filter((note) => note.id !== currentNoteId)
      .filter((note) => {
        if (!normalizedQuery) return true;
        const haystack = `${note.title ?? ''} ${getStudyText(note)}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });
  }, [currentNoteId, notes, query]);

  if (!open) return null;

  const popupStyle = {
    top: position?.top ?? 120,
    left: position?.left ?? 120,
  };

  return (
    <div
      role="dialog"
      aria-label={t('studiesWorkspace.wikilinkPicker.placeholder')}
      className="fixed z-[80] w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      style={popupStyle}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('studiesWorkspace.wikilinkPicker.placeholder')}
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      />

      {currentNoteId ? (
        <p className="mt-2 px-1 text-[11px] text-gray-500 dark:text-gray-400">
          {t('studiesWorkspace.wikilinkPicker.currentNoteHint')}
        </p>
      ) : null}

      <div className="mt-2 max-h-64 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
            {t('common.loading')}
          </div>
        ) : visibleNotes.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
            {t('studiesWorkspace.wikilinkPicker.empty')}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleNotes.map((note) => {
              const title = note.title?.trim() || t('studiesWorkspace.untitled');
              const snippet = getSnippet(getStudyText(note));

              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => {
                    onPick(note.id);
                    onClose();
                  }}
                  className="block w-full rounded-md px-3 py-2 text-left transition hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                >
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {title}
                  </span>
                  {snippet ? (
                    <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
                      {snippet}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
