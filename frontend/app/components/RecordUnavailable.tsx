'use client';

import { useState, type ReactNode } from 'react';

import { useTranslation } from '@locales/useTranslation';

import type { RecordPresence } from '@/data-engine/recordPresence';

/** Absence needs server proof; waiting and an unread cache always leave a way out. */
export function RecordUnavailable({ presence, checking = false, pageLoading = false, loadingFallback, onBack, onRetry, children }: {
  presence?: RecordPresence; checking?: boolean; pageLoading?: boolean; loadingFallback?: ReactNode; onBack: () => void;
  onRetry?: () => unknown | Promise<unknown>; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try { await onRetry(); } catch { /* The read's public state keeps the failure visible. */ }
    finally { setRetrying(false); }
  };
  // A read in flight has no absence verdict; retained words stay outside the placeholder.
  const pending = checking && presence?.kind !== 'absent' && presence?.kind !== 'deleting';
  if (pending) return <section className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6" data-record-pending data-page-loading={pageLoading ? '' : undefined}>
    <button type="button" onClick={onBack} className="font-semibold text-emerald-700 dark:text-emerald-300">{t('common.back')}</button>
    <p role="status" className="text-sm text-gray-600 dark:text-gray-300">{t('recordAvailability.checking')}</p>
    {pageLoading && loadingFallback}
    {children}
  </section>;
  const key = presence?.kind === 'absent' ? 'notFound'
    : presence?.kind === 'deleting' ? 'deleting' : 'notHereYet';
  return <section className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6" data-record-unavailable>
    <button type="button" onClick={onBack} className="font-semibold text-emerald-700 dark:text-emerald-300">{t('common.back')}</button>
    <div role="status" className="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <h1 className="text-xl font-semibold">{t(`recordAvailability.${key}`)}</h1>
      {presence?.kind !== 'absent' && presence?.kind !== 'deleting' && <p className="text-sm text-gray-600 dark:text-gray-300">{t('recordAvailability.checkConnection')}</p>}
      {(checking || retrying) && <p className="text-sm">{t('recordAvailability.checking')}</p>}
      {onRetry && <button type="button" disabled={retrying} onClick={() => { void retry(); }} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t('dataSync.retry')}</button>}
    </div>
    {children}
  </section>;
}
