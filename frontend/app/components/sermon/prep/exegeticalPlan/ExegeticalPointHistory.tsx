'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import type { ExegeticalPointHistoryEntry, ExegeticalPointHistoryPage, ExegeticalPointVersion } from '@/data-engine/exegeticalPointAction';

export function ExegeticalPointHistory({ owner, sermonId, generation, disabled, onRestore }: {
  owner: string; sermonId: string; generation: string; disabled: boolean;
  onRestore: (entry: ExegeticalPointHistoryEntry) => Promise<void>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, load, toggle } = useOwnerHistory<ExegeticalPointHistoryEntry, ExegeticalPointHistoryPage>({
    owner, generation, id: sermonId,
    path: '/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + '/exegetical-point-history',
    resourceId: page => page.sermonId,
  });
  const restore = async (entry: ExegeticalPointHistoryEntry) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(entry); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const heading = t('dataSync.exegeticalHistory.heading');
  const describe = (version: ExegeticalPointVersion | null) => version
    ? String(version.point.title || t('common.untitled')) : t('dataSync.exegeticalPointRemoved');
  if (!editHistoryShown()) return null;
  return <div className="space-y-2 text-sm">
    <button type="button" className="min-h-8 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      aria-expanded={open} aria-controls={panel} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t('dataSync.exegeticalHistory.loading')}</p>}
      {failed && <p role="alert">{t('dataSync.exegeticalHistory.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t('dataSync.exegeticalHistory.restoreFailed')}</p>}
      {history?.entries.length === 0 && <p>{t('dataSync.exegeticalHistory.empty')}</p>}
      {history && history.entries.length > 0 && <ul className="space-y-2">
        {history.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="min-w-0 break-words">
            <p className="font-medium">{describe(entry.value)}</p>
            <p>{entry.origin === 'comparison' ? t('dataSync.exegeticalHistory.comparison') : t('dataSync.exegeticalHistory.kept', { title: describe(entry.winner) })}</p>
          </div>
          <button type="button" disabled={disabled || restoring}
            className="min-h-8 font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
            onClick={() => void restore(entry)}>
            {t(entry.value ? 'dataSync.exegeticalHistory.restore' : 'dataSync.exegeticalHistory.restoreRemoval')}
          </button>
        </li>)}
      </ul>}
      {history?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        onClick={() => void load(history.nextCursor!)}>{t('dataSync.exegeticalHistory.more')}</button>}
    </section>}
  </div>;
}
