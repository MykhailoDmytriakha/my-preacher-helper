'use client';

import { useTranslation } from 'react-i18next';

import { useLasting } from './useLasting';

import type { CollectionState } from './collections';

/**
 * The collection's local overlay never implies server confirmation or completeness. "May be
 * incomplete" is said once it lasts: every scheduled re-read of a list passes through incomplete
 * for a moment, and a notice that comes and goes with it moves the whole list under the reader.
 */
export function DataCollectionStatus({ state }: { state: CollectionState | null | undefined }) {
  const { t } = useTranslation();
  const pending = state?.documents?.filter(document => document.pending) ?? [];
  const incomplete = useLasting(!state?.complete);
  if (!pending.length && !incomplete) return null;
  return <div role="status" className="mb-3 rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-700">
    {pending.length > 0 && <p>{t(pending.some(document => document.needsAttention) ? 'dataSync.collectionAttention' : 'dataSync.phase.queued')}</p>}
    {incomplete && <p>{t('dataSync.collectionIncomplete')}</p>}
  </div>;
}
