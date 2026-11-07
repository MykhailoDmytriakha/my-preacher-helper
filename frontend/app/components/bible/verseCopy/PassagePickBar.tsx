'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';

import { useTranslation } from '@locales/useTranslation';

import type { PickedPassage } from './passagePick';
import type { VerseCopy } from './useVerseCopy';
import type { ReactNode } from 'react';

/**
 * THE BAR WHILE VERSES ARE CHOSEN FOR A PASSAGE (case 2026-10-12-block-diagram, 3.4 and phase 9; canvas «Разбор структуры»):
 * the copy bar's shape — the passage, how many verses, and what the passage is for: «Разобрать» an analysis, «Написать
 * комментарий» a comment, «Применить» or «Готово» for verses chosen again. No «whole paragraph»: the texts carry no
 * paragraphs yet, and the button offered one verse (the owner, 2026-10-29).
 */
export function PassagePickBar({ copy, wide, onOpen, action, icon, cancelLabel, busy = false }: {
  busy?: boolean;
  copy: VerseCopy;
  wide: boolean;
  onOpen: (passage: PickedPassage) => void;
  /** The button's words. */
  action: string;
  /** The button's sign, `h-5 w-5`. */
  icon: ReactNode;
  /** What ✕ says to a screen reader. */
  cancelLabel: string;
}) {
  const { t } = useTranslation();
  const passage = copy.passage;
  if (!copy.picked || !passage) return null;
  const place = copy.placeOf(copy.picked);
  const count = t('bible.verseCount', { count: copy.picked.length });
  const clear = (
    <button type="button" disabled={busy} onClick={copy.clear} aria-label={cancelLabel} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
  const openButton = (
    <button type="button" disabled={busy} aria-busy={busy} onClick={() => onOpen(passage)} className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 ${wide ? '' : 'flex-1'}`}>
      {icon}
      {action}
    </button>
  );
  const shell = 'fixed z-[110] rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900';
  return wide ? (
    <div role="region" aria-label={place} data-verse-bar="" className={`${shell} bottom-6 left-1/2 flex w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 py-2.5 pl-2.5 pr-2.5`}>
      {clear}
      <div className="min-w-[7.5rem] flex-1">
        <div className="truncate font-bold text-gray-900 dark:text-white">{place}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{count}</div>
      </div>
      {openButton}
    </div>
  ) : (
    <div role="region" aria-label={place} data-verse-bar="" className={`${shell} inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] p-3`}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{place}</span>
        <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">{count}</span>
        {clear}
      </div>
      <div className="flex gap-2">
        {openButton}
      </div>
    </div>
  );
}
