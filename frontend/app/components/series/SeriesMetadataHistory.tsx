'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { SeriesHistoryField, SeriesMetadataHistoryPage, SeriesTimedField } from '@/data-engine/seriesFieldAction';
import type { DocumentData } from '@/data-engine/types';

export function SeriesMetadataHistory({ owner, seriesId, generation, current, disabled, onRestore }: {
  owner: string; seriesId: string; generation: string; current: DocumentData | null;
  disabled: boolean; onRestore: (field: SeriesTimedField, value: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, load, toggle } = useOwnerHistory<SeriesMetadataHistoryPage['entries'][number], SeriesMetadataHistoryPage>({
    owner, generation, id: seriesId,
    path: '/api/data-engine/documents/series/' + encodeURIComponent(seriesId) + '/metadata-history',
    resourceId: page => page.seriesId,
  });
  const restore = async (entry: SeriesHistoryField) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(entry.field, entry.value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const describe = (field: SeriesTimedField, value: string | null) => {
    if (value === null) return t('workspaces.series.history.notSet');
    return field === 'status' ? t('workspaces.series.form.statuses.' + value) : value;
  };
  const heading = t('workspaces.series.history.heading');
  return <div className="space-y-2 text-sm">
    <button type="button" className="min-h-8 font-medium text-blue-700 hover:underline dark:text-blue-400"
      aria-expanded={open} aria-controls={panel} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t('workspaces.series.history.loading')}</p>}
      {failed && <p role="alert">{t('workspaces.series.history.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t('workspaces.series.history.restoreFailed')}</p>}
      {history?.entries.length === 0 && <p>{t('workspaces.series.history.empty')}</p>}
      {history && history.entries.length > 0 && <ul className="space-y-2">
        {history.entries.flatMap(entry => entry.fields.map(field => {
          const currentValue = current?.[field.field] ?? null;
          const same = currentValue === field.value;
          return <li key={entry.id + ':' + field.field} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <div className="min-w-0 break-words">
              <p className="font-medium">{t('workspaces.series.form.' + field.field)}</p>
              <p>{describe(field.field, field.value)}</p>
              <p>{t('workspaces.series.history.kept', { value: describe(field.field, field.winner) })}</p>
            </div>
            <button type="button" disabled={disabled || restoring || same || (field.value === null && field.field !== 'color')}
              className="min-h-8 font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400"
              onClick={() => void restore(field)}>{t(same ? 'workspaces.series.history.current' : 'workspaces.series.history.restore')}</button>
          </li>;
        }))}
      </ul>}
      {history?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 font-medium text-blue-700 hover:underline dark:text-blue-400"
        onClick={() => void load(history.nextCursor!)}>{t('workspaces.series.history.more')}</button>}
    </section>}
  </div>;
}
