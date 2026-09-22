'use client';

import { CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataDocumentProvider, useDataDocument } from '@/data-engine/react.client';

import { EnginePreachDateModal } from './EnginePreachDateModal';
import { PreachDateRows } from './PreachDateRows';

import type { PreachDateAction } from './preachDateForm';
import type { Sermon } from '@/models/models';

export function EnginePreachDateList({ sermonId }: { sermonId: string }) {
  return <DataDocumentProvider resource={{ collection: 'sermons', id: sermonId }} options={{ autoSave: false }}>
    <DateHistory sermonId={sermonId} />
  </DataDocumentProvider>;
}
function DateHistory({ sermonId }: { sermonId: string }) {
  const { t } = useTranslation();
  const document = useDataDocument({ collection: 'sermons', id: sermonId }, { autoSave: false });
  const sermon = document.data as unknown as Sermon | null;
  const [action, setAction] = useState<PreachDateAction | null>(null);
  const disabled = document.loading || !sermon || document.status?.phase === 'deleted';
  return <div className="space-y-4">
    <DataSyncStatus status={document.status} error={document.error} onRetry={document.retry} />
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <CalendarDaysIcon className="w-4 h-4" />{t('calendar.title')}
      </h3>
      <button disabled={disabled} onClick={() => setAction({ kind: 'add', status: 'planned' })}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors disabled:opacity-50">
        <PlusIcon className="w-3.5 h-3.5" />{t('calendar.addPreachDate')}
      </button>
    </div>
    <PreachDateRows preachDates={sermon?.preachDates ?? []} isPreached={Boolean(sermon?.isPreached)} disabled={disabled}
      onEdit={date => setAction({ kind: 'edit', dateId: date.id })} onDelete={dateId => setAction({ kind: 'delete', dateId })} />
    {action && <EnginePreachDateModal key={`${action.kind}:${action.dateId ?? 'new'}`} sermonId={sermonId} action={action} onClose={() => setAction(null)} />}
  </div>;
}
