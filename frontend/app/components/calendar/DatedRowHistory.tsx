'use client';

import { format } from 'date-fns';
import { useId, useState } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { parseDateOnlyAsLocalDate, shownDayOf } from '@/utils/dateOnly';
import { useTranslation } from '@locales/useTranslation';

import type { MeetingDateHistoryPage, PreachDateHistoryPage } from '@/data-engine/datedRowAction';

const unavailable = 'Date history unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

type DatedRowHistoryPage = PreachDateHistoryPage | MeetingDateHistoryPage;

export function DatedRowHistory({ owner, collection, id, generation, liveDates, disabled, onRestore }: {
  owner: string;
  collection: 'sermons' | 'groups';
  id: string;
  generation: string;
  liveDates: ReadonlyMap<string, string>;
  disabled: boolean;
  onRestore: (rowId: string, date: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { dateLocale } = useAppLocale();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<DatedRowHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const load = async (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    if (!cursor) setHistory(null);
    try {
      const params = new URLSearchParams({ generation, ...(cursor && { cursor }) });
      const endpoint = collection === 'groups' ? 'meeting-date-history' : 'preach-date-history';
      const { value } = await requestOwnerJson<DatedRowHistoryPage>(
        `/api/data-engine/documents/${collection}/${encodeURIComponent(id)}/${endpoint}?${params}`,
        { expectedOwner: owner, answerStatuses: [], messages },
      );
      const resourceId = collection === 'groups' && 'groupId' in value ? value.groupId
        : collection === 'sermons' && 'sermonId' in value ? value.sermonId : undefined;
      if (value.owner !== owner || resourceId !== id || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(messages.failed);
      setHistory(previous => ({ ...value, entries: [...(cursor ? previous?.entries ?? [] : []), ...value.entries] }));
    } catch { setFailed(true); }
    finally { setLoading(false); }
  };
  const restore = async (rowId: string, date: string) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(rowId, date); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const showDate = (date: string) => {
    if (date === '') return t('workspaces.groups.meetings.datePlaceholder');
    const value = parseDateOnlyAsLocalDate(shownDayOf(date));
    return value ? format(value, 'PP', { locale: dateLocale }) : date;
  };
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panelId}
      className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
      disabled={disabled || loading} onClick={() => { setOpen(!open); if (!open) void load(); }}>
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
          <button type="button" disabled={disabled || restoring || !liveDates.has(entry.rowId) || liveDates.get(entry.rowId) === entry.date}
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
