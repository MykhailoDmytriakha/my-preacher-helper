'use client';

import { useId, useState } from 'react';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { storedFieldValue } from '@/utils/storedFieldValue';
import { useTranslation } from '@locales/useTranslation';

import type { GroupStatusHistoryPage, GroupTitleHistoryPage, ServiceOrderTitleHistoryPage } from '@/data-engine/documentFieldAction';
type DocumentHistoryPage = ServiceOrderTitleHistoryPage | GroupTitleHistoryPage | GroupStatusHistoryPage;
type HistoryEntry = { id: string; value: string; winner: string };
type HistoryPage = { entries: HistoryEntry[]; nextCursor: string | null };
type HistorySession = ({ orderId: string } | { groupId: string; field?: 'status' }) & {
  owner: string; generation: string; restore: (title: string) => Promise<void>;
};

const unavailable = 'Title history unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

export function DocumentFieldHistory({ session, current, disabled }: { session: HistorySession; current: string; disabled: boolean }) {
  const { t } = useTranslation();
  const { owner, generation } = session;
  const group = 'groupId' in session;
  const resourceId = group ? session.groupId : session.orderId;
  const status = group && session.field === 'status';
  const endpoint = status ? 'status-history' : 'title-history';
  const heading = t(status ? 'common.statusHistory' : 'common.titleHistory');
  const format = (value: string) => status ? String(storedFieldValue(t, 'groups', 'status', value)) : value || t('common.untitled');
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
        `/api/data-engine/documents/${group ? 'groups' : 'serviceOrders'}/${encodeURIComponent(resourceId)}/${endpoint}?${params}`,
        { expectedOwner: owner, answerStatuses: [], messages },
      );
      const returnedId = group && 'groupId' in value ? value.groupId : !group && 'orderId' in value ? value.orderId : undefined;
      if (value.owner !== owner || returnedId !== resourceId || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(unavailable);
      const entries = value.entries.map(entry => 'status' in entry
        ? { id: entry.id, value: entry.status, winner: entry.winnerStatus }
        : { id: entry.id, value: entry.title, winner: entry.winnerTitle });
      setPage(previous => ({ nextCursor: value.nextCursor, entries: [...(cursor ? previous?.entries ?? [] : []), ...entries] }));
    } catch { setError('load'); }
    finally { setLoading(false); }
  };
  const restore = async (next: string) => {
    setRestoring(true);
    setError(undefined);
    try { await session.restore(next); }
    catch { setError('restore'); }
    finally { setRestoring(false); }
  };
  return <div className={group ? "text-sm" : "mt-3 text-sm"}>
    <button type="button" aria-expanded={open} aria-controls={panel} disabled={loading}
      className="min-h-8 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      onClick={() => { setOpen(!open); if (!open) void load(); }}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t(status ? 'common.statusHistoryLoading' : 'common.titleHistoryLoading')}</p>}
      {error && <p role="alert">{error === 'load' ? t(status ? 'common.statusHistoryUnavailable' : 'common.titleHistoryUnavailable')
        : t(status ? 'common.statusHistoryRestoreFailed' : 'common.titleHistoryRestoreFailed')}</p>}
      {page?.entries.length === 0 && <p>{t(status ? 'common.statusHistoryEmpty' : 'common.titleHistoryEmpty')}</p>}
      {page && page.entries.length > 0 && <ul className="space-y-2">
        {page.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="min-w-0 break-words">
            <p className="font-medium">{format(entry.value)}</p>
            <p>{t(status ? 'common.statusHistoryKept' : 'common.titleHistoryKept', { title: format(entry.winner) })}</p>
          </div>
          <button type="button" disabled={disabled || restoring || current === entry.value}
            className="min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
            onClick={() => void restore(entry.value)}>{current === entry.value ? t(status ? 'common.statusHistoryCurrent' : 'common.titleHistoryCurrent')
              : t(status ? 'common.statusHistoryRestore' : 'common.titleHistoryRestore')}</button>
        </li>)}
      </ul>}
      {page?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        onClick={() => void load(page.nextCursor!)}>{t(status ? 'common.statusHistoryMore' : 'common.titleHistoryMore')}</button>}
    </section>}
  </div>;
}
