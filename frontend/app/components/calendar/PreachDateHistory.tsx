'use client';

import { format } from 'date-fns';
import { useId, useState } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { parseDateOnlyAsLocalDate } from '@/utils/dateOnly';
import { useTranslation } from '@locales/useTranslation';

import type { PreachDateHistoryPage } from '@/data-engine/preachDateAction';

const unavailable = 'Preaching date history unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

export function PreachDateHistory({ owner, sermonId, generation, liveDates, disabled, onRestore }: {
  owner: string;
  sermonId: string;
  generation: string;
  liveDates: ReadonlyMap<string, string>;
  disabled: boolean;
  onRestore: (rowId: string, date: string) => void;
}) {
  const { t } = useTranslation();
  const { dateLocale } = useAppLocale();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<PreachDateHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    if (!cursor) setHistory(null);
    try {
      const params = new URLSearchParams({ generation, ...(cursor && { cursor }) });
      const { value } = await requestOwnerJson<PreachDateHistoryPage>(
        `/api/data-engine/documents/sermons/${encodeURIComponent(sermonId)}/preach-date-history?${params}`,
        { expectedOwner: owner, answerStatuses: [], messages },
      );
      if (value.owner !== owner || value.sermonId !== sermonId || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(messages.failed);
      setHistory(previous => ({ ...value, entries: [...(cursor ? previous?.entries ?? [] : []), ...value.entries] }));
    } catch { setFailed(true); }
    finally { setLoading(false); }
  };
  const showDate = (date: string) => {
    const value = parseDateOnlyAsLocalDate(date);
    return value ? format(value, 'PP', { locale: dateLocale }) : date;
  };
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panelId}
      className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
      disabled={disabled || loading} onClick={() => { setOpen(!open); if (!open) void load(); }}>
      {t('calendar.earlierDates')}
    </button>
    {open && <div id={panelId} className="space-y-2 text-sm">
      {loading && <p role="status">{t('calendar.loadingEarlierDates')}</p>}
      {failed && <p role="alert">{t('calendar.earlierDatesUnavailable')}</p>}
      {history?.entries.length === 0 && <p>{t('calendar.noEarlierDates')}</p>}
      {history && history.entries.length > 0 && <ul className="space-y-2">
        {history.entries.map(entry => <li key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <span>{t('calendar.earlierDateEntry', { date: showDate(entry.date), keptDate: showDate(entry.winnerDate) })}</span>
          <button type="button" disabled={disabled || !liveDates.has(entry.rowId) || liveDates.get(entry.rowId) === entry.date}
            className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
            onClick={() => onRestore(entry.rowId, entry.date)}>{t('calendar.useEarlierDate')}</button>
        </li>)}
      </ul>}
      {history?.nextCursor && <button type="button" disabled={disabled || loading}
        className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50"
        onClick={() => void load(history.nextCursor!)}>{t('calendar.loadEarlierDates')}</button>}
    </div>}
  </div>;
}
