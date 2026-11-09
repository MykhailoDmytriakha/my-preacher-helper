'use client';

import { format } from 'date-fns';
import { useId } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { serializeContent } from '@/utils/contentFingerprint';
import { parseDateOnlyAsLocalDate } from '@/utils/dateOnly';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import { canRestorePreachDateField, canRestorePreachStatus } from './preachDateForm';

import type { PreachDateFieldHistoryEntry } from '@/data-engine/preachDateFieldAction';
import type { PreachStatusHistoryEntry } from '@/data-engine/preachStatusAction';
import type { PreachDate } from '@/models/models';

type ValueEntry = PreachDateFieldHistoryEntry | PreachStatusHistoryEntry;
type ValueRecord = { id: string; acceptedAt: string; fields: ValueEntry[] };
type ValuePage = { owner: string; sermonId: string; generation: string; nextCursor: string | null; entries: ValueRecord[] };

const link = 'min-h-8 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50';

export function PreachDateFieldHistory({ owner, sermonId, generation, dates, disabled, kind = 'details', onRestore }: {
  owner: string;
  sermonId: string;
  generation: string;
  dates: readonly PreachDate[];
  disabled: boolean;
  kind?: 'details' | 'status';
  onRestore: (entry: ValueEntry, historyId: string) => void;
}) {
  const { t } = useTranslation();
  const { dateLocale } = useAppLocale();
  const panel = useId();
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<ValueRecord, ValuePage>({
    owner, generation, id: sermonId,
    path: '/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + (kind === 'status' ? '/preach-status-history' : '/preach-date-field-history'),
    resourceId: value => value.sermonId,
  });
  const heading = t(kind === 'status' ? 'calendar.preachStatusHistory' : 'calendar.preachDetailHistory');
  const entries = history?.entries.flatMap(item => item.fields.flatMap(entry => {
    const row = dates.find(candidate => candidate.id === entry.rowId && candidate.createdAt === entry.rowCreatedAt);
    return row ? [{ id: JSON.stringify([item.id, entry.rowId, entry.field]), row, entry }] : [];
  })) ?? [];
  const display = (value: ValueEntry['value'], field: ValueEntry['field']) => {
    if (field === 'status' && (value === 'preached' || value === 'planned')) {
      return t(value === 'preached' ? 'calendar.status.preached' : 'calendar.status.planned');
    }
    if (value === null) return t('calendar.preachDetailUnset');
    if (typeof value !== 'object') return String(value) || t('calendar.preachDetailBlank');
    return [value.name, value.city].filter(part => typeof part === 'string' && part).join(' · ');
  };
  if (!editHistoryShown()) return null;
  return <div>
    <button type="button" className={link} disabled={loading} aria-expanded={open} aria-controls={panel} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('calendar.loadingPreachDetails')}</p>}
      {failed && <p role="alert">{t('calendar.preachDetailsUnavailable')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('calendar.noPreachDetails')}</p>}
      {entries.length > 0 && <ul className="space-y-2">{entries.map(({ id, row, entry }) => {
        const date = parseDateOnlyAsLocalDate(row.date);
        const field = entry.field;
        const label = t(field === 'status' ? 'calendar.preachStatusLabel' : field === 'audience' ? 'calendar.audience' : field === 'churchCity' ? 'calendar.city' : 'calendar.church');
        const current = field === 'status' ? row.status ?? null : field === 'audience' ? row.audience ?? null : field === 'churchCity' ? row.church.city ?? null : row.church;
        const canRestore = field === 'status' ? canRestorePreachStatus(row, entry) : canRestorePreachDateField(row, entry);
        return <li key={id} className="space-y-1 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="font-medium">{label} · {date ? format(date, 'PP', { locale: dateLocale }) : row.date || t('calendar.dateNotSet')}</p>
          <p className="break-words">{display(entry.value, field)}</p>
          <p className="break-words">{t('calendar.preachDetailKept', { value: display(entry.winnerValue, field) })}</p>
          <button type="button" className={link}
            disabled={disabled || !canRestore || serializeContent(current) === serializeContent(entry.value)}
            onClick={() => onRestore(entry, id)}>{t('calendar.useEarlierPreachDetail')}</button>
        </li>;
      })}</ul>}
      {history?.nextCursor && <button type="button" className={link} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('calendar.loadEarlierPreachDetails')}
      </button>}
    </section>}
  </div>;
}
