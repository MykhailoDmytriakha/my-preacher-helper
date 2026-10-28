'use client';

import { useTranslation } from 'react-i18next';

import type { ReactNode } from 'react';

/**
 * WORDS FROM LAST TIME THAT NEVER REACHED THE SERVER, offered back — never applied by themselves
 * (`hooks/useDurableDraft.ts`): a draft left by a failed save must not win over text edited later on another
 * device. `preview` shows the words waiting, so yesterday's text does not go back over a newer one unseen
 * (BUG-20260815-draft-recovery-offers-a-number-not-the-text).
 */
export function UnsavedDraftOffer({ preview, onRestore, onDiscard, className = '' }: {
  preview?: ReactNode;
  onRestore: () => void;
  onDiscard: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="status" className={`flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="min-w-0">
        <p className="font-medium text-amber-900 dark:text-amber-200">{t('unsavedDraft.title')}</p>
        <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{t('unsavedDraft.description')}</p>
        {preview ? <div className="mt-2 max-h-28 overflow-auto rounded-lg bg-white/70 px-3 py-2 dark:bg-black/20">{preview}</div> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onRestore} className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700">
          {t('unsavedDraft.restore')}
        </button>
        <button type="button" onClick={onDiscard} className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20">
          {t('unsavedDraft.discard')}
        </button>
      </div>
    </div>
  );
}
