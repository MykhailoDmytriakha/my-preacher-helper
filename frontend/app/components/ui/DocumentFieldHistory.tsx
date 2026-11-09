'use client';

import { useId, useState } from 'react';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { storedFieldValue } from '@/utils/storedFieldValue';
import { useTranslation } from '@locales/useTranslation';

import type { GroupStatusHistoryPage, GroupTitleHistoryPage, PlanTemplateNameHistoryPage, PrayerTitleHistoryPage, SermonChurchHistoryPage, SermonGoalTypeHistoryPage, SermonTitleHistoryPage, SermonVerseHistoryPage, ServiceOrderTitleHistoryPage, StudyNoteTitleHistoryPage } from '@/data-engine/documentFieldAction';
import type { Church } from '@/models/models';

type DocumentHistoryPage = PlanTemplateNameHistoryPage | StudyNoteTitleHistoryPage | ServiceOrderTitleHistoryPage | PrayerTitleHistoryPage | GroupTitleHistoryPage | GroupStatusHistoryPage | SermonTitleHistoryPage | SermonVerseHistoryPage | SermonChurchHistoryPage | SermonGoalTypeHistoryPage;
type HistoryValue = string | Church | null;
type HistoryEntry = { id: string; value: HistoryValue; winner: HistoryValue };
type HistoryPage = { entries: HistoryEntry[]; nextCursor: string | null };
type HistorySession = { owner: string; generation: string } & (
  (({ orderId: string } | { templateId: string } | { noteId: string } | { prayerId: string } | { groupId: string; field?: 'status' } | { sermonId: string; field?: 'verse' | 'goal-type' }) & { restore: (value: string) => Promise<void> })
  | { sermonId: string; field: 'church'; restore: (value: Church | null) => Promise<void> }
);

function sameHistoryValue(left: HistoryValue, right: HistoryValue): boolean {
  return left === right || Boolean(left && right && typeof left === 'object' && typeof right === 'object'
    && left.id === right.id && left.name === right.name && left.city === right.city);
}

const unavailable = 'Field history unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

const historyLabels = {
  title: {
    heading: 'common.titleHistory', loading: 'common.titleHistoryLoading', unavailable: 'common.titleHistoryUnavailable',
    failed: 'common.titleHistoryRestoreFailed', empty: 'common.titleHistoryEmpty', kept: 'common.titleHistoryKept',
    current: 'common.titleHistoryCurrent', restore: 'common.titleHistoryRestore', more: 'common.titleHistoryMore',
  },
  status: {
    heading: 'common.statusHistory', loading: 'common.statusHistoryLoading', unavailable: 'common.statusHistoryUnavailable',
    failed: 'common.statusHistoryRestoreFailed', empty: 'common.statusHistoryEmpty', kept: 'common.statusHistoryKept',
    current: 'common.statusHistoryCurrent', restore: 'common.statusHistoryRestore', more: 'common.statusHistoryMore',
  },
  church: {
    heading: 'common.churchHistory', loading: 'common.churchHistoryLoading', unavailable: 'common.churchHistoryUnavailable',
    failed: 'common.churchHistoryRestoreFailed', empty: 'common.churchHistoryEmpty', kept: 'common.churchHistoryKept',
    current: 'common.churchHistoryCurrent', restore: 'common.churchHistoryRestore', more: 'common.churchHistoryMore',
  },
  'goal-type': {
    heading: 'common.goalTypeHistory', loading: 'common.goalTypeHistoryLoading', unavailable: 'common.goalTypeHistoryUnavailable',
    failed: 'common.goalTypeHistoryRestoreFailed', empty: 'common.goalTypeHistoryEmpty', kept: 'common.goalTypeHistoryKept',
    current: 'common.goalTypeHistoryCurrent', restore: 'common.goalTypeHistoryRestore', more: 'common.goalTypeHistoryMore',
  },
  verse: {
    heading: 'common.verseHistory', loading: 'common.verseHistoryLoading', unavailable: 'common.verseHistoryUnavailable',
    failed: 'common.verseHistoryRestoreFailed', empty: 'common.verseHistoryEmpty', kept: 'common.verseHistoryKept',
    current: 'common.verseHistoryCurrent', restore: 'common.verseHistoryRestore', more: 'common.verseHistoryMore',
  },
} as const;

export function DocumentFieldHistory({ session, current, disabled }: { session: HistorySession; current: HistoryValue; disabled: boolean }) {
  const { t } = useTranslation();
  const { owner, generation } = session;
  const { collection, resourceId, key } = 'groupId' in session
    ? { collection: 'groups', resourceId: session.groupId, key: 'groupId' }
    : 'sermonId' in session
      ? { collection: 'sermons', resourceId: session.sermonId, key: 'sermonId' }
      : 'prayerId' in session
        ? { collection: 'prayerRequests', resourceId: session.prayerId, key: 'prayerId' }
        : 'noteId' in session
          ? { collection: 'studyNotes', resourceId: session.noteId, key: 'noteId' }
          : 'templateId' in session
            ? { collection: 'planTemplates', resourceId: session.templateId, key: 'templateId' }
            : { collection: 'serviceOrders', resourceId: session.orderId, key: 'orderId' };
  const field = ('field' in session && session.field) || 'title';
  const labels = historyLabels[field];
  const endpoint = field + '-history';
  const heading = t(labels.heading);
  const format = (value: HistoryValue) => {
    if (typeof value !== 'string') return value ? [value.name, value.city].filter(Boolean).join(', ') : t(field === 'title' ? 'common.untitled' : 'calendar.unspecifiedChurch');
    if (field === 'goal-type') return String(storedFieldValue(t, 'sermons.preparation.preachingGoal', 'type', value));
    return field === 'status' ? String(storedFieldValue(t, 'groups', 'status', value)) : value || t('common.untitled');
  };
  const isCurrent = (value: HistoryValue) => 'noteId' in session
    ? (current ?? '') === (value ?? '') : sameHistoryValue(current, value);
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<'load' | 'restore'>();
  const load = async (cursor?: string) => {
    setLoading(true);
    setError(undefined);
    if (!cursor) setPage(null);
    try {
      const params = new URLSearchParams({ generation, ...(cursor && { cursor }) });
      const { value } = await requestOwnerJson<DocumentHistoryPage>(
        `/api/data-engine/documents/${collection}/${encodeURIComponent(resourceId)}/${endpoint}?${params}`,
        { expectedOwner: owner, answerStatuses: [], messages },
      );
      const returnedId = Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
      if (value.owner !== owner || returnedId !== resourceId || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(unavailable);
      const entries = value.entries.map(entry => 'status' in entry
        ? { id: entry.id, value: entry.status, winner: entry.winnerStatus }
        : 'verse' in entry ? { id: entry.id, value: entry.verse, winner: entry.winnerVerse }
          : 'type' in entry ? { id: entry.id, value: entry.type, winner: entry.winnerType }
            : 'church' in entry ? { id: entry.id, value: entry.church, winner: entry.winnerChurch }
            : { id: entry.id, value: entry.title, winner: entry.winnerTitle });
      setPage(previous => ({ nextCursor: value.nextCursor, entries: [...(cursor ? previous?.entries ?? [] : []), ...entries] }));
    } catch { setError('load'); }
    finally { setLoading(false); }
  };
  const restore = async (next: HistoryValue) => {
    setRestoring(true);
    setError(undefined);
    try {
      if ('field' in session && session.field === 'church') {
        if (typeof next !== 'string') await session.restore(next);
      } else if (typeof next === 'string') await session.restore(next);
      else if (next === null && 'noteId' in session) await session.restore('');
    }
    catch { setError('restore'); }
    finally { setRestoring(false); }
  };
  return <div className={collection === "groups" ? "text-sm" : "mt-3 text-sm"}>
    <button type="button" aria-expanded={open} aria-controls={panel} disabled={loading}
      className="min-h-8 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      onClick={() => { setOpen(!open); if (!open) void load(); }}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t(labels.loading)}</p>}
      {error && <p role="alert">{error === 'load' ? t(labels.unavailable)
        : t(labels.failed)}</p>}
      {page?.entries.length === 0 && <p>{t(labels.empty)}</p>}
      {page && page.entries.length > 0 && <ul className="space-y-2">
        {page.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="min-w-0 break-words">
            <p className="font-medium">{format(entry.value)}</p>
            <p>{t(labels.kept, { title: format(entry.winner) })}</p>
          </div>
          <button type="button" disabled={disabled || restoring || isCurrent(entry.value)}
            className="min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
            onClick={() => void restore(entry.value)}>{isCurrent(entry.value) ? t(labels.current)
              : t(labels.restore)}</button>
        </li>)}
      </ul>}
      {page?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        onClick={() => void load(page.nextCursor!)}>{t(labels.more)}</button>}
    </section>}
  </div>;
}
