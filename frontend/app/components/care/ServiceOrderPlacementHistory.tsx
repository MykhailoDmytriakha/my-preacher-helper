'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import { serviceOrderPlacementWords } from './serviceOrderPlacementWords';

import type { ServiceOrderPlacementHistoryPage } from '@/data-engine/types';
import type { ServiceOrderPlacementHistorySession } from '@/hooks/useServiceOrdersEngine';

type Page = ServiceOrderPlacementHistoryPage;
type Entry = Page['entries'][number];

export function ServiceOrderPlacementHistory({ session, disabled }: { session: ServiceOrderPlacementHistorySession; disabled: boolean }) {
  const { owner, orderId, generation, restore } = session;
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, Page>({
    owner, generation, id: orderId, path: '/api/data-engine/documents/serviceOrders/' + encodeURIComponent(orderId) + '/placement-history',
    resourceId: page => page.orderId,
  });
  const restorePosition = async (entry: Entry) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await restore(entry.earlier); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const heading = t('serviceOrders.placementHistory.title');
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  return <div className="ml-2 space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panel} className={button} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('serviceOrders.placementHistory.loading')}</p>}
      {failed && <p role="alert">{t('serviceOrders.placementHistory.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t('serviceOrders.placementHistory.restoreFailed')}</p>}
      {history && !history.entries.length && !history.nextCursor && <p>{t('serviceOrders.placementHistory.empty')}</p>}
      {history?.entries.length ? <ul className="space-y-2">
        {history.entries.map(entry => <li key={entry.id} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="font-medium">{serviceOrderPlacementWords(entry.earlier, t)}</p>
          <p>{t('serviceOrders.placementHistory.kept', { place: serviceOrderPlacementWords(entry.kept, t) })}</p>
          <button type="button" className={button} disabled={disabled || restoring}
            onClick={() => void restorePosition(entry)}>{t('serviceOrders.placementHistory.restore')}</button>
        </li>)}
      </ul> : null}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('serviceOrders.placementHistory.more')}
      </button>}
    </section>}
  </div>;
}
