'use client';

import { CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument } from '@/data-engine/react.client';

import { EnginePreachDateModal } from './EnginePreachDateModal';
import { PreachDateRows } from './PreachDateRows';

import type { PreachDateAction } from './preachDateForm';
import type { Sermon } from '@/models/models';

/** Reuses the sermon workspace editor; standalone history keeps its own read-only fallback. */
export function EnginePreachDateList({ sermonId, showDocumentStatus = true }: {
  sermonId: string;
  showDocumentStatus?: boolean;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const document = useDataDocument({ collection: 'sermons', id: sermonId }, { autoSave: false, readOnlyCopy: true });
  const sermon = document.data as unknown as Sermon | null;
  const [action, setAction] = useState<PreachDateAction | null>(null);
  const disabled = document.readOnly || document.loading || !sermon || document.status?.phase === 'deleted';
  return <section aria-labelledby={headingId} className="space-y-4">
    {showDocumentStatus && document.readOnly && <p role="status">{document.readOnlyReason}</p>}
    {showDocumentStatus && <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} onRetry={document.retry} />}
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
    {!document.readOnly && action && <EnginePreachDateModal key={`${action.kind}:${action.dateId ?? 'new'}`} sermonId={sermonId} action={action} onClose={() => setAction(null)} />}
  </section>;
}
