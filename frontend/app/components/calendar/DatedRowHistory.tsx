'use client';

import { format } from 'date-fns';
import { useId, useState } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { parseDateOnlyAsLocalDate, shownDayOf } from '@/utils/dateOnly';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import type { MeetingDateHistoryPage, PreachDateHistoryPage } from '@/data-engine/datedRowAction';

type DatedRowHistoryPage = PreachDateHistoryPage | MeetingDateHistoryPage;

export function DatedRowHistory({ owner, collection, id, generation, liveDates, disabled, onRestore, canRestore }: {
  owner: string;
  collection: 'sermons' | 'groups';
  id: string;
  generation: string;
  liveDates: ReadonlyMap<string, string>;
  disabled: boolean;
  onRestore: (rowId: string, date: string) => void | Promise<void>;
  canRestore?: (rowId: string, date: string) => boolean;
}) {
  const { t } = useTranslation();
  const { dateLocale } = useAppLocale();
  const panelId = useId();
  const endpoint = collection === 'groups' ? 'meeting-date-history' : 'preach-date-history';
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<DatedRowHistoryPage['entries'][number], DatedRowHistoryPage>({
    owner, generation, id,
    path: '/api/data-engine/documents/' + collection + '/' + encodeURIComponent(id) + '/' + endpoint,
    resourceId: value => collection === 'groups' && 'groupId' in value ? value.groupId
      : collection === 'sermons' && 'sermonId' in value ? value.sermonId : undefined,
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const restore = async (rowId: string, date: string) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(rowId, date); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const showDate = (date: string) => {
    if (date === '') return t(collection === 'groups' ? 'workspaces.groups.meetings.datePlaceholder' : 'calendar.dateNotSet');
    const value = parseDateOnlyAsLocalDate(shownDayOf(date));
    return value ? format(value, 'PP', { locale: dateLocale }) : date;
  };
  if (!editHistoryShown()) return null;
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panelId}
      className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
      disabled={disabled || loading} onClick={toggle}>
      {t('calendar.earlierDates')}
    </button>
    {open && <section id={panelId} aria-label={t('calendar.earlierDates')} className="space-y-2 text-sm">
      {loading && <p role="status">{t('calendar.loadingEarlierDates')}</p>}
      {failed && <p role="alert">{t('calendar.earlierDatesUnavailable')}</p>}
      {restoreFailed && <p role="alert">{t('calendar.restoreEarlierDateFailed')}</p>}
      {history?.entries.length === 0 && <p>{t('calendar.noEarlierDates')}</p>}
      {history && history.entries.length > 0 && <ul className="space-y-2">
        {history.entries.map(entry => <li key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <span>{t('calendar.earlierDateEntry', { date: showDate(entry.date), keptDate: showDate(entry.winnerDate) })}</span>
          <button type="button" disabled={disabled || restoring || !liveDates.has(entry.rowId) || liveDates.get(entry.rowId) === entry.date || canRestore?.(entry.rowId, entry.date) === false}
            className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
            onClick={() => void restore(entry.rowId, entry.date)}>{t('calendar.useEarlierDate')}</button>
        </li>)}
      </ul>}
      {history?.nextCursor && <button type="button" disabled={disabled || loading}
        className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
        onClick={() => void load(history.nextCursor!)}>{t('calendar.loadEarlierDates')}</button>}
    </section>}
  </div>;
}
