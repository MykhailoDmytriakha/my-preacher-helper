'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { MembershipRef } from '@/data-engine/membershipIntent';
import type { useDataMembership } from '@/data-engine/react.client';
import type { SeriesHistorySelection, SeriesMembershipHistoryEntry, SeriesMembershipHistoryPage } from '@/data-engine/seriesMembershipHistory';

const prefix = 'workspaces.series.membershipHistory.';

export function SeriesMembershipHistory({ owner, member, generation, action, currentSeriesId, disabled }: {
  owner: string;
  member: MembershipRef;
  generation?: string | null;
  action: Pick<ReturnType<typeof useDataMembership>, 'values' | 'restoreAssignment'>;
  currentSeriesId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const collection = member.type === 'sermon' ? 'sermons' : 'groups';
  const { open, history, loading, failed, load, toggle } = useOwnerHistory<SeriesMembershipHistoryEntry, SeriesMembershipHistoryPage>({
    owner, generation, id: member.refId,
    path: '/api/data-engine/documents/' + collection + '/' + encodeURIComponent(member.refId) + '/series-membership-history',
    resourceId: page => page.collection === collection ? page.memberId : undefined,
  });
  const restore = async (selection: SeriesHistorySelection | null) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await action.restoreAssignment(member, selection); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const label = (selection: SeriesHistorySelection | null) => selection ? selection.label || t('common.unknown') : t('addSermon.noSeriesOption');
  const heading = t(prefix + 'heading');
  return <div className="space-y-2 text-sm">
    <button type="button" aria-expanded={open} aria-controls={panel} disabled={loading}
      className="min-h-8 font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t(prefix + 'loading')}</p>}
      {failed && <p role="alert">{t(prefix + 'unavailable')}</p>}
      {restoreFailed && <p role="alert">{t(prefix + 'restoreFailed')}</p>}
      {history?.entries.length === 0 && <p>{t(prefix + 'empty')}</p>}
      {!!history?.entries.length && <ul className="space-y-2">{history.entries.map(entry => {
        const former = entry.former;
        const available = !former || action.values.some(row => row.id === former.id && row.generation === former.generation);
        const same = available && currentSeriesId === (former?.id ?? '');
        return <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="min-w-0 break-words">
            <p className="font-medium">{label(former)}</p>
            <p>{t(prefix + 'kept', { value: label(entry.current) })}</p>
            {!available && <p>{t(prefix + 'formerUnavailable')}</p>}
          </div>
          <button type="button" disabled={disabled || restoring || same || !available}
            className="min-h-8 font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400"
            onClick={() => void restore(former)}>{t(prefix + (same ? 'current' : 'restore'))}</button>
        </li>;
      })}</ul>}
      {history?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 font-medium text-blue-700 hover:underline dark:text-blue-400"
        onClick={() => void load(history.nextCursor!)}>{t(prefix + 'more')}</button>}
    </section>}
  </div>;
}
