'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { ServiceOrderFlagHistoryPage } from '@/data-engine/serviceOrderFlagAction';
import type { ServiceOrderStep } from '@/models/models';

type Entry = ServiceOrderFlagHistoryPage['entries'][number];

export function ServiceOrderFlagHistory({ owner, orderId, generation, steps, disabled, onRestore }: {
  owner: string;
  orderId: string;
  generation: string;
  steps: readonly ServiceOrderStep[];
  disabled: boolean;
  onRestore: (step: ServiceOrderStep, value: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, ServiceOrderFlagHistoryPage>({
    owner, generation, id: orderId, path: '/api/data-engine/documents/serviceOrders/' + encodeURIComponent(orderId) + '/step-flag-history',
    resourceId: page => page.orderId,
  });
  const words = (value: boolean) => t(value ? 'serviceOrders.flagHistory.marked' : 'serviceOrders.flagHistory.unmarked');
  const entries = history?.entries.flatMap(record => record.fields.map(entry => ({ key: record.id + ':' + entry.rowId, entry }))) ?? [];
  const byId = new Map(steps.map(step => [step.id, step]));
  const restore = async (step: ServiceOrderStep, value: boolean) => {
    setRestoring(true); setRestoreFailed(false);
    try { await onRestore(step, value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const heading = t('serviceOrders.flagHistory.title');
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panel} className={button} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('serviceOrders.flagHistory.loading')}</p>}
      {failed && <p role="alert">{t('serviceOrders.flagHistory.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t('serviceOrders.flagHistory.restoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('serviceOrders.flagHistory.empty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">
        {entries.map(({ key, entry }) => {
          const step = byId.get(entry.rowId);
          return <li key={key} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <p className="font-medium">{step?.title || t(step ? 'serviceOrders.flagHistory.untitled' : 'serviceOrders.flagHistory.removed')}</p>
            <p>{t('serviceOrders.flagHistory.comparison', { earlier: words(entry.value), kept: words(entry.winnerValue) })}</p>
            {step && <button type="button" className={button} disabled={disabled || restoring || Boolean(step.flagged) === entry.value}
              onClick={() => void restore(step, entry.value)}>{t('serviceOrders.flagHistory.restore')}</button>}
          </li>;
        })}
      </ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('serviceOrders.flagHistory.more')}
      </button>}
    </section>}
  </div>;
}
