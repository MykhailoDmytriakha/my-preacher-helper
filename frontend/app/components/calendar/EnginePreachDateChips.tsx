'use client';

import { useState } from 'react';

import { useDataDocument, useDataEngine } from '@/data-engine/react.client';
import { editHistoryShown } from '@/utils/editHistory';
import { getEffectivePreachDateStatus } from '@/utils/preachDateStatus';

import { DatedRowHistory } from './DatedRowHistory';
import { EnginePreachDateModal } from './EnginePreachDateModal';
import { PreachDateChips } from './PreachDateChips';
import { PreachDateFieldHistory } from './PreachDateFieldHistory';

import type { PreachDateAction } from './preachDateForm';
import type { PreachDateFieldHistoryEntry } from '@/data-engine/preachDateFieldAction';
import type { PreachStatusHistoryEntry } from '@/data-engine/preachStatusAction';
import type { Sermon } from '@/models/models';

/**
 * The sermon's preach dates in the line under its title. Reads the stored sermon on the data
 * engine and writes only through the one preach-date window; read-only or deleted — the chips
 * still show their cards, but nothing can be added, changed or removed.
 */
export function EnginePreachDateChips({ sermonId }: { sermonId: string }) {
  const { owner } = useDataEngine();
  const document = useDataDocument({ collection: 'sermons', id: sermonId }, { autoSave: false, readOnlyCopy: true });
  const generation = document.confirmed?.metadata?.generation;
  const sermon = document.data as unknown as Sermon | null;
  const [action, setAction] = useState<PreachDateAction | null>(null);
  const disabled = document.readOnly || document.loading || !sermon || document.status?.phase === 'deleted';
  const restore = (entry: PreachDateFieldHistoryEntry | PreachStatusHistoryEntry, historyId: string) => {
    setAction({ kind: 'edit', dateId: entry.rowId,
      ...(entry.field === 'status' ? { restoreStatus: { ...entry, historyId } } : { restoreField: { ...entry, historyId } }) });
  };
  return <>
    <PreachDateChips preachDates={sermon?.preachDates ?? []} isPreached={Boolean(sermon?.isPreached)} disabled={disabled} onAction={setAction} />
    {/* Earlier values of the dates, behind the one history switch; an empty box here would still take a gap in the line. */}
    {editHistoryShown() && owner && generation && <div className="basis-full space-y-2">
      <DatedRowHistory key={JSON.stringify(['date', owner, sermonId, generation])}
        owner={owner} collection="sermons" id={sermonId} generation={generation} disabled={disabled}
        liveDates={new Map(sermon?.preachDates?.map(date => [date.id, date.date]))}
        canRestore={(rowId, date) => date !== '' || Boolean(sermon?.preachDates?.some(row =>
          row.id === rowId && getEffectivePreachDateStatus(row, Boolean(sermon.isPreached)) === 'planned'))}
        onRestore={(dateId, restoreDate) => setAction({ kind: 'edit', dateId, restoreDate })} />
      <PreachDateFieldHistory key={JSON.stringify(['details', owner, sermonId, generation])}
        owner={owner} sermonId={sermonId} generation={generation} dates={sermon?.preachDates ?? []} disabled={disabled}
        onRestore={restore} />
      <PreachDateFieldHistory key={JSON.stringify(['status', owner, sermonId, generation])}
        owner={owner} sermonId={sermonId} generation={generation} dates={sermon?.preachDates ?? []} disabled={disabled}
        kind="status" onRestore={restore} />
    </div>}
    {!document.readOnly && action && <EnginePreachDateModal key={JSON.stringify([action.kind, action.dateId, action.restoreDate, action.restoreField?.historyId, action.restoreStatus?.historyId])} sermonId={sermonId} action={action} onClose={() => setAction(null)} />}
  </>;
}
