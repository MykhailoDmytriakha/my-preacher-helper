'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import { groupFlowFieldText } from './groupFlowComparison';

import type { GroupFlowHistoryPage } from '@/data-engine/groupFlowTitleAction';
import type { GroupPageEditor } from '@/hooks/groupPageEditor';

type Entry = GroupFlowHistoryPage['entries'][number];

export function GroupFlowFieldHistory({ scope, field, rowId, rowCreatedAt, current, onRestore }: {
  scope: NonNullable<GroupPageEditor['flowTitleScope']>;
  field: 'block' | 'step' | 'status' | 'duration';
  rowId: string;
  rowCreatedAt: string;
  current: string | number | null;
  onRestore: (value: string | number | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { groupId, owner, generation, disabled } = scope;
  const route = { block: 'group-block-title', step: 'group-step-title', status: 'group-block-status', duration: 'group-step-duration' }[field];
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, GroupFlowHistoryPage>({
    owner, generation, id: groupId, resourceId: page => page.groupId,
    path: '/api/data-engine/documents/groups/' + encodeURIComponent(groupId)
      + '/' + route + '-history',
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const entries = history?.entries.flatMap(entry => entry.fields
    .filter(item => item.rowId === rowId && item.rowCreatedAt === rowCreatedAt)
    .map(item => ({ id: entry.id, item }))) ?? [];
  const heading = t({ block: 'groupFlow.editor.blockNameHistory', step: 'groupFlow.editor.stepNameHistory',
    status: 'groupFlow.editor.blockStatusHistory', duration: 'groupFlow.editor.durationHistory' }[field]);
  const words = (value: string | number | null) => groupFlowFieldText(t, field, value);
  const message = (suffix: string) => ({
    block: 'common.titleHistory', step: 'common.titleHistory', status: 'common.statusHistory', duration: 'groupFlow.editor.durationHistory',
  }[field] + suffix);
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  const restore = async (value: string | number | null) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };

  if (!editHistoryShown()) return null;
  return <div className="mt-1 space-y-2">
    <button type="button" aria-expanded={open} aria-controls={id} className={button} onClick={toggle} disabled={loading}>{heading}</button>
    {open && <section id={id} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t(message('Loading'))}</p>}
      {failed && <p role="alert">{t(message('Unavailable'))}</p>}
      {restoreFailed && <p role="alert">{t(message('RestoreFailed'))}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t(message('Empty'))}</p>}
      {entries.length > 0 && <ul className="space-y-2">{entries.map(({ id: entryId, item }) =>
        <li key={entryId} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="font-medium">{words(item.value)}</p>
          <p>{t(message('Kept'), { title: words(item.winnerValue) })}</p>
          <button type="button" className={button} disabled={disabled || restoring || current === item.value}
            onClick={() => void restore(item.value)}>{t(message(current === item.value ? 'Current' : 'Restore'))}</button>
        </li>)}</ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t(message('More'))}
      </button>}
    </section>}
  </div>;
}
