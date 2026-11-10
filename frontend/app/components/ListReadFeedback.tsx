'use client';

import { useTranslation } from '@locales/useTranslation';

import type { ListReadState } from '@/utils/listReadState';

/** Explain the read without replacing available rows or printing an internal error sentence. */
export function ListReadFeedback({ state, className = '', showIncomplete = false }: {
  state: ListReadState;
  className?: string;
  showIncomplete?: boolean;
}) {
  const { t } = useTranslation();
  if (state === 'ready' || (state === 'incomplete' && !showIncomplete)) return null;
  const word = {
    failed: 'dataSync.backgroundFailure',
    loading: 'common.loading',
    incomplete: 'dataSync.collectionIncomplete',
  }[state];
  return <p role={state === 'failed' ? 'alert' : 'status'}
    className={`my-3 text-sm ${state === 'failed' ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'} ${className}`}>
    {t(word)}
  </p>;
}
