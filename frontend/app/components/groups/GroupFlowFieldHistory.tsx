'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { GroupFlowHistoryPage } from '@/data-engine/groupFlowTitleAction';
import type { GroupPageEditor } from '@/hooks/groupPageEditor';

type Entry = GroupFlowHistoryPage['entries'][number];

export function GroupFlowFieldHistory({ scope, field, rowId, rowCreatedAt, current, onRestore }: {
  scope: NonNullable<GroupPageEditor['flowTitleScope']>;
  field: 'block' | 'step' | 'status';
  rowId: string;
  rowCreatedAt: string;
  current: string | null;
  onRestore: (value: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { groupId, owner, generation, disabled } = scope;
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, GroupFlowHistoryPage>({
    owner, generation, id: groupId, resourceId: page => page.groupId,
    path: '/api/data-engine/documents/groups/' + encodeURIComponent(groupId)
      + (field === 'status' ? '/group-block-status-history' : '/group-' + field + '-title-history'),
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const entries = history?.entries.flatMap(entry => entry.fields
    .filter(item => item.rowId === rowId && item.rowCreatedAt === rowCreatedAt)
    .map(item => ({ id: entry.id, item }))) ?? [];
  const heading = t({ block: 'groupFlow.editor.blockNameHistory', step: 'groupFlow.editor.stepNameHistory', status: 'groupFlow.editor.blockStatusHistory' }[field]);
  const words = (value: string | null) => field === 'status' ? t('groupFlow.status.' + value)
    : value || t(field === 'block' ? 'common.untitled' : 'groupFlow.editor.useBlockName');
  const message = (suffix: string) => 'common.' + (field === 'status' ? 'statusHistory' : 'titleHistory') + suffix;
  const button = 'min-h-8 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';
  const restore = async (value: string | null) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };

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
