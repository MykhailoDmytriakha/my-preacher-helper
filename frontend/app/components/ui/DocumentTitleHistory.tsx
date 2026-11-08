'use client';

import { useId, useState } from 'react';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { useTranslation } from '@locales/useTranslation';

import type { GroupTitleHistoryPage, ServiceOrderTitleHistoryPage } from '@/data-engine/documentTitle';
type TitleHistoryPage = ServiceOrderTitleHistoryPage | GroupTitleHistoryPage;
type TitleHistorySession = ({ orderId: string } | { groupId: string }) & {
  owner: string; generation: string; restore: (title: string) => Promise<void>;
};

const unavailable = 'Title history unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

export function DocumentTitleHistory({ session, title, disabled }: { session: TitleHistorySession; title: string; disabled: boolean }) {
  const { t } = useTranslation();
  const { owner, generation } = session;
  const group = 'groupId' in session;
  const resourceId = group ? session.groupId : session.orderId;
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<TitleHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<'load' | 'restore'>();
  const load = async (cursor?: string) => {
    setLoading(true);
    setError(undefined);
    if (!cursor) setPage(null);
    try {
      const params = new URLSearchParams({ generation, ...(cursor && { cursor }) });
      const { value } = await requestOwnerJson<TitleHistoryPage>(
        `/api/data-engine/documents/${group ? 'groups' : 'serviceOrders'}/${encodeURIComponent(resourceId)}/title-history?${params}`,
        { expectedOwner: owner, answerStatuses: [], messages },
      );
      const returnedId = group && 'groupId' in value ? value.groupId : !group && 'orderId' in value ? value.orderId : undefined;
      if (value.owner !== owner || returnedId !== resourceId || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(unavailable);
      setPage(previous => ({ ...value, entries: [...(cursor ? previous?.entries ?? [] : []), ...value.entries] }));
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
      onClick={() => { setOpen(!open); if (!open) void load(); }}>{t('common.titleHistory')}</button>
    {open && <section id={panel} aria-label={t('common.titleHistory')} className="space-y-2">
      {loading && <p role="status">{t('common.titleHistoryLoading')}</p>}
      {error && <p role="alert">{t(error === 'load' ? 'common.titleHistoryUnavailable' : 'common.titleHistoryRestoreFailed')}</p>}
      {page?.entries.length === 0 && <p>{t('common.titleHistoryEmpty')}</p>}
      {page && page.entries.length > 0 && <ul className="space-y-2">
        {page.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="min-w-0 break-words">
            <p className="font-medium">{entry.title || t('common.untitled')}</p>
            <p>{t('common.titleHistoryKept', { title: entry.winnerTitle || t('common.untitled') })}</p>
          </div>
          <button type="button" disabled={disabled || restoring || title === entry.title}
            className="min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
            onClick={() => void restore(entry.title)}>{t(title === entry.title ? 'common.titleHistoryCurrent' : 'common.titleHistoryRestore')}</button>
        </li>)}
      </ul>}
      {page?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        onClick={() => void load(page.nextCursor!)}>{t('common.titleHistoryMore')}</button>}
    </section>}
  </div>;
}
