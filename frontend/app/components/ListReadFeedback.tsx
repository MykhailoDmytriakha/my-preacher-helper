'use client';

import { useTranslation } from '@locales/useTranslation';

import type { ListReadState } from '@/utils/listReadState';

/** Explain the read without replacing available rows or printing an internal error sentence. */
export function ListReadFeedback({ state, className = '' }: { state: ListReadState; className?: string }) {
  const { t } = useTranslation();
  if (state === 'ready') return null;
  return <p role={state === 'failed' ? 'alert' : 'status'}
    className={`my-3 text-sm ${state === 'failed' ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'} ${className}`}>
    {t(state === 'failed' ? 'dataSync.backgroundFailure' : 'common.loading')}
  </p>;
}
