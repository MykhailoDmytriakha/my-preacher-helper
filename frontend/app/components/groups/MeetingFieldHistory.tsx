'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import type { GroupMeetingField, GroupMeetingFieldHistoryEntry, GroupMeetingFieldHistoryPage } from '@/data-engine/groupMeetingFieldAction';

type HistoryEntry = GroupMeetingFieldHistoryPage['entries'][number];
const button = 'min-h-8 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 disabled:opacity-50';

export function MeetingFieldHistory({ owner, id, generation, rowId, rowCreatedAt, current, disabled, onRestore }: {
  owner: string;
  id: string;
  generation: string;
  rowId: string;
  rowCreatedAt: string;
  current: Record<GroupMeetingField, string | null>;
  disabled: boolean;
  onRestore: (rowId: string, rowCreatedAt: string, field: GroupMeetingField, value: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<HistoryEntry, GroupMeetingFieldHistoryPage>({
    owner, generation, id, path: '/api/data-engine/documents/groups/' + encodeURIComponent(id) + '/meeting-field-history',
    resourceId: value => value.groupId,
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const restore = async (entry: GroupMeetingFieldHistoryEntry) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(entry.rowId, entry.rowCreatedAt, entry.field, entry.value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const label = (field: GroupMeetingField) => t(field === 'location' ? 'workspaces.groups.meetings.location' : 'workspaces.groups.meetings.audience');
  const format = (value: string | null) => value === null ? t('workspaces.groups.meetings.historyUnset')
    : value || t('workspaces.groups.meetings.historyBlank');
  const heading = t('workspaces.groups.meetings.fieldHistory');
  const entries = history?.entries.flatMap(record => record.fields.filter(entry => entry.rowId === rowId && entry.rowCreatedAt === rowCreatedAt)
    .map(entry => ({ id: record.id + ':' + entry.field, entry }))) ?? [];
  if (!editHistoryShown()) return null;
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} aria-controls={panel} className={button} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('workspaces.groups.meetings.historyLoading')}</p>}
      {failed && <p role="alert">{t('workspaces.groups.meetings.historyUnavailable')}</p>}
      {restoreFailed && <p role="alert">{t('workspaces.groups.meetings.historyRestoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('workspaces.groups.meetings.historyEmpty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">
        {entries.map(({ id: key, entry }) => <li key={key} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="font-medium">{label(entry.field)}</p>
          <p className="break-words">{format(entry.value)}</p>
          <p className="break-words">{t('workspaces.groups.meetings.historyKept', { value: format(entry.winnerValue) })}</p>
          <button type="button" className={button} disabled={disabled || restoring || current[entry.field] === entry.value}
            onClick={() => void restore(entry)}>{t('workspaces.groups.meetings.historyRestore', { field: label(entry.field) })}</button>
        </li>)}
      </ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('workspaces.groups.meetings.historyMore')}
      </button>}
    </section>}
  </div>;
}
