'use client';

import { format } from 'date-fns';
import { useId } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { serializeContent } from '@/utils/contentFingerprint';
import { parseDateOnlyAsLocalDate } from '@/utils/dateOnly';
import { useTranslation } from '@locales/useTranslation';

import { canRestorePreachDateField } from './preachDateForm';

import type { PreachDateFieldHistoryEntry, PreachDateFieldHistoryPage } from '@/data-engine/preachDateFieldAction';
import type { PreachDate } from '@/models/models';

const link = 'min-h-8 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50';

export function PreachDateFieldHistory({ owner, sermonId, generation, dates, disabled, onRestore }: {
  owner: string;
  sermonId: string;
  generation: string;
  dates: readonly PreachDate[];
  disabled: boolean;
  onRestore: (entry: PreachDateFieldHistoryEntry, historyId: string) => void;
}) {
  const { t } = useTranslation();
  const { dateLocale } = useAppLocale();
  const panel = useId();
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<PreachDateFieldHistoryPage['entries'][number], PreachDateFieldHistoryPage>({
    owner, generation, id: sermonId,
    path: '/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + '/preach-date-field-history',
    resourceId: value => value.sermonId,
  });
  const heading = t('calendar.preachDetailHistory');
  const entries = history?.entries.flatMap(item => item.fields.flatMap(entry => {
    const row = dates.find(candidate => candidate.id === entry.rowId && candidate.createdAt === entry.rowCreatedAt);
    return row ? [{ id: item.id + ':' + entry.field, row, entry }] : [];
  })) ?? [];
  const display = (value: PreachDateFieldHistoryEntry['value']) => {
    if (value === null) return t('calendar.preachDetailUnset');
    if (typeof value === 'string') return value || t('calendar.preachDetailBlank');
    return [value.name, value.city].filter(part => typeof part === 'string' && part).join(' · ');
  };
  return <div>
    <button type="button" className={link} disabled={loading} aria-expanded={open} aria-controls={panel} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('calendar.loadingPreachDetails')}</p>}
      {failed && <p role="alert">{t('calendar.preachDetailsUnavailable')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('calendar.noPreachDetails')}</p>}
      {entries.length > 0 && <ul className="space-y-2">{entries.map(({ id, row, entry }) => {
        const date = parseDateOnlyAsLocalDate(row.date);
        const label = t(entry.field === 'audience' ? 'calendar.audience' : entry.field === 'churchCity' ? 'calendar.city' : 'calendar.church');
        const current = entry.field === 'audience' ? row.audience ?? null : entry.field === 'churchCity' ? row.church.city ?? null : row.church;
        return <li key={id} className="space-y-1 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="font-medium">{label} · {date ? format(date, 'PP', { locale: dateLocale }) : row.date}</p>
          <p className="break-words">{display(entry.value)}</p>
          <p className="break-words">{t('calendar.preachDetailKept', { value: display(entry.winnerValue) })}</p>
          <button type="button" className={link}
            disabled={disabled || !canRestorePreachDateField(row, entry) || serializeContent(current) === serializeContent(entry.value)}
            onClick={() => onRestore(entry, id)}>{t('calendar.useEarlierPreachDetail')}</button>
        </li>;
      })}</ul>}
      {history?.nextCursor && <button type="button" className={link} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('calendar.loadEarlierPreachDetails')}
      </button>}
    </section>}
  </div>;
}
