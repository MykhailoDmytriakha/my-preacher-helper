'use client';

import { useTranslation } from 'react-i18next';

import type { CollectionState } from './collections';

/** The collection's local overlay never implies server confirmation or completeness. */
export function DataCollectionStatus({ state }: { state: CollectionState | null | undefined }) {
  const { t } = useTranslation();
  const pending = state?.documents?.filter(document => document.pending) ?? [];
  if (!pending.length && state?.complete) return null;
  return <div role="status" className="mb-3 rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-700">
    {pending.length > 0 && <p>{t(pending.some(document => document.needsAttention) ? 'dataSync.collectionAttention' : 'dataSync.phase.queued')}</p>}
    {!state?.complete && <p>{t('dataSync.collectionIncomplete')}</p>}
  </div>;
}
