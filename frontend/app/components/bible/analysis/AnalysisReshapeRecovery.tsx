'use client';

import { SyncNotice } from '@/components/common/SyncNoticeDock';
import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import { useAnalysisReshapeActions } from '@/data-engine/react.client';
import { useTranslation } from '@locales/useTranslation';

/** Whole passage actions retain a visible recovery door after the reader closes. */
export function AnalysisReshapeRecovery() {
  const { t } = useTranslation(), work = useAnalysisReshapeActions();
  const visible = work.actions.filter(action => ['unknown', 'blocked', 'conflict', 'refused', 'unavailable'].includes(action.delivery.phase));
  if (!visible.length && !work.error) return null;
  return <SyncNotice><section aria-label={t('analysis.reshape.recovery')} className="mb-4 space-y-3 rounded-lg border border-amber-200 p-3 dark:border-amber-700">
    <h2 className="font-semibold">{t('analysis.reshape.recovery')}</h2>
    {work.error && !visible.length && <div className="space-y-2"><p role="alert">{work.error}</p>
      <button type="button" className="rounded-lg border px-3 py-1.5" onClick={() => { void work.retry().catch(() => undefined); }}>{t('dataSync.retry')}</button></div>}
    {visible.map(action => <div key={action.id} className="space-y-2">
      <p>{action.title}</p>
      <DataMembershipStatus action={action} />
    </div>)}
  </section></SyncNotice>;
}
