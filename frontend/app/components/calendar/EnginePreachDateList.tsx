'use client';

import { CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useId, useState } from 'react';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument, useDataEngine } from '@/data-engine/react.client';
import { useTranslation } from '@locales/useTranslation';

import { DatedRowHistory } from './DatedRowHistory';
import { EnginePreachDateModal } from './EnginePreachDateModal';
import { PreachDateFieldHistory } from './PreachDateFieldHistory';
import { PreachDateRows } from './PreachDateRows';

import type { PreachDateAction } from './preachDateForm';
import type { PreachDateFieldHistoryEntry } from '@/data-engine/preachDateFieldAction';
import type { PreachStatusHistoryEntry } from '@/data-engine/preachStatusAction';
import type { Sermon } from '@/models/models';

/** Reuses the sermon workspace editor; standalone history keeps its own read-only fallback. */
export function EnginePreachDateList({ sermonId, showDocumentStatus = true }: {
  sermonId: string;
  showDocumentStatus?: boolean;
}) {
  const { t } = useTranslation();
  const { owner } = useDataEngine();
  const headingId = useId();
  const document = useDataDocument({ collection: 'sermons', id: sermonId }, { autoSave: false, readOnlyCopy: true });
  const generation = document.confirmed?.metadata?.generation;
  const sermon = document.data as unknown as Sermon | null;
  const [action, setAction] = useState<PreachDateAction | null>(null);
  const disabled = document.readOnly || document.loading || !sermon || document.status?.phase === 'deleted';
  const restore = (entry: PreachDateFieldHistoryEntry | PreachStatusHistoryEntry, historyId: string) => {
    setAction({ kind: 'edit', dateId: entry.rowId,
      ...(entry.field === 'status' ? { restoreStatus: { ...entry, historyId } } : { restoreField: { ...entry, historyId } }) });
  };
  return <section aria-labelledby={headingId} className="space-y-4">
    {showDocumentStatus && document.readOnly && <p role="status">{document.readOnlyReason}</p>}
    {showDocumentStatus && <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry} />}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <CalendarDaysIcon className="w-4 h-4" />{t('calendar.historyTitle')}
      </h3>
      <button disabled={disabled} onClick={() => setAction({ kind: 'add', status: 'planned' })}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors disabled:opacity-50">
        <PlusIcon className="w-3.5 h-3.5" />{t('calendar.addPreachDate')}
      </button>
    </div>
    <PreachDateRows preachDates={sermon?.preachDates ?? []} isPreached={Boolean(sermon?.isPreached)} disabled={disabled}
      onEdit={date => setAction({ kind: 'edit', dateId: date.id })} onDelete={dateId => setAction({ kind: 'delete', dateId })} />
    {owner && generation && <DatedRowHistory key={JSON.stringify(['date', owner, sermonId, generation])}
      owner={owner} collection="sermons" id={sermonId} generation={generation} disabled={disabled}
      liveDates={new Map(sermon?.preachDates?.map(date => [date.id, date.date]))}
      onRestore={(dateId, restoreDate) => setAction({ kind: 'edit', dateId, restoreDate })} />}
    {owner && generation && <PreachDateFieldHistory key={JSON.stringify(['details', owner, sermonId, generation])}
      owner={owner} sermonId={sermonId} generation={generation} dates={sermon?.preachDates ?? []} disabled={disabled}
      onRestore={restore} />}
    {owner && generation && <PreachDateFieldHistory key={JSON.stringify(['status', owner, sermonId, generation])}
      owner={owner} sermonId={sermonId} generation={generation} dates={sermon?.preachDates ?? []} disabled={disabled}
      kind="status" onRestore={restore} />}
    {!document.readOnly && action && <EnginePreachDateModal key={JSON.stringify([action.kind, action.dateId, action.restoreDate, action.restoreField?.historyId, action.restoreStatus?.historyId])} sermonId={sermonId} action={action} onClose={() => setAction(null)} />}
  </section>;
}
