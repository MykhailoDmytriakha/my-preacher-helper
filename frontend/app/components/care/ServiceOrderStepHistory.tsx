'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { ServiceOrderStepHistoryPage } from '@/data-engine/serviceOrderStepAction';
import type { ServiceOrderStep } from '@/models/models';

type Page = ServiceOrderStepHistoryPage<'flagged' | 'title', boolean | string>;
type Entry = Page['entries'][number];
type HistoryField = { field: 'flagged'; onRestore: (step: ServiceOrderStep, value: boolean) => Promise<unknown> }
  | { field: 'title'; onRestore: (step: ServiceOrderStep, value: string) => Promise<unknown> };

export function ServiceOrderStepHistory({ owner, orderId, generation, steps, disabled, ...selected }: {
  owner: string;
  orderId: string;
  generation: string;
  steps: readonly ServiceOrderStep[];
  disabled: boolean;
} & HistoryField) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const titleField = selected.field === 'title';
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, Page>({
    owner, generation, id: orderId, path: '/api/data-engine/documents/serviceOrders/' + encodeURIComponent(orderId)
      + (titleField ? '/step-title-history' : '/step-flag-history'),
    resourceId: page => page.orderId,
  });
  const words = (value: string | boolean) => typeof value === 'string' ? value || t('serviceOrders.flagHistory.untitled')
    : t(value ? 'serviceOrders.flagHistory.marked' : 'serviceOrders.flagHistory.unmarked');
  const entries = history?.entries.flatMap(record => record.fields.filter(entry => entry.field === selected.field)
    .map(entry => ({ key: record.id + ':' + entry.rowId, entry }))) ?? [];
  const byId = new Map(steps.map(step => [step.id, step]));
  const restore = async (step: ServiceOrderStep, value: boolean | string) => {
    setRestoring(true); setRestoreFailed(false);
    try {
      if (selected.field === 'title' && typeof value === 'string') await selected.onRestore(step, value);
      if (selected.field === 'flagged' && typeof value === 'boolean') await selected.onRestore(step, value);
    }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const heading = t(titleField ? 'serviceOrders.stepTitleHistory.title' : 'serviceOrders.flagHistory.title');
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panel} className={button} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t(titleField ? 'serviceOrders.stepTitleHistory.loading' : 'serviceOrders.flagHistory.loading')}</p>}
      {failed && <p role="alert">{t(titleField ? 'serviceOrders.stepTitleHistory.unavailable' : 'serviceOrders.flagHistory.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t(titleField ? 'serviceOrders.stepTitleHistory.restoreFailed' : 'serviceOrders.flagHistory.restoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t(titleField ? 'serviceOrders.stepTitleHistory.empty' : 'serviceOrders.flagHistory.empty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">
        {entries.map(({ key, entry }) => {
          const step = byId.get(entry.rowId);
          return <li key={key} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <p className="font-medium">{step?.title || t(step ? 'serviceOrders.flagHistory.untitled' : 'serviceOrders.flagHistory.removed')}</p>
            <p>{t('serviceOrders.flagHistory.comparison', { earlier: words(entry.value), kept: words(entry.winnerValue) })}</p>
            {step && <button type="button" className={button} disabled={disabled || restoring || (titleField ? step.title : Boolean(step.flagged)) === entry.value}
              onClick={() => void restore(step, entry.value)}>{t(titleField ? 'serviceOrders.stepTitleHistory.restore' : 'serviceOrders.flagHistory.restore')}</button>}
          </li>;
        })}
      </ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('serviceOrders.flagHistory.more')}
      </button>}
    </section>}
  </div>;
}
