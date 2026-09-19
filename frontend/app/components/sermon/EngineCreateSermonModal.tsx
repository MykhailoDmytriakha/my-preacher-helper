'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import { isCollectionOnEngine, useDataMembership } from '@/data-engine/react.client';
import { churchForNewPreachDate } from '@/utils/church';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { hydrateSeries } from '@/utils/seriesDocument';

import SermonFormDialog from './SermonFormDialog';

import type { SermonFormValues } from './SermonFormDialog';
import type { DocumentData } from '@/data-engine/types';
import type { Church, PreachDate, Series } from '@/models/models';

/** The stage owns typing and the new ID; this view never writes through legacy callbacks. */
export function EngineCreateSermonModal({ recoveryId, allowPlannedDate = false, onClose, onQueued }: {
  recoveryId?: string; allowPlannedDate?: boolean; onClose: () => void; onQueued: (id: string) => void;
}) {
  const { t } = useTranslation(), action = useDataMembership();
  const [initial] = useState(() => ({ title: '', verse: '', date: new Date().toISOString(), thoughts: [] }));
  const [saving, setSaving] = useState(false), [openingSeries, setOpeningSeries] = useState(false);
  const attempted = useRef<object | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = () => recoveryId ? action.recover(recoveryId) : action.beginCreate('sermons', initial);
  useEffect(() => {
    if (!action.ready || attempted.current === action.recoveryIdentity) return;
    attempted.current = action.recoveryIdentity; void open().catch(() => undefined);
  });
  const creation = action.creation, value: DocumentData = creation?.value ?? initial;
  const dates = (value.preachDates ?? []) as unknown as PreachDate[];
  const seriesId = action.action?.kind === 'assign' ? action.action.targetId : '';
  const options = action.values.map(row => hydrateSeries({ ...row.value, id: row.id } as unknown as Series))
    .map(row => ({ id: row.id, label: row.title || row.theme }));
  const openSeries = async () => {
    setOpeningSeries(true);
    try { await action.openSeries(); } catch { /* The shared status owns the error. */ }
    finally { if (mounted.current) setOpeningSeries(false); }
  };
  const change = (patch: Partial<SermonFormValues>) => {
    if (!creation) return;
    if ('seriesId' in patch) {
      void action.update(patch.seriesId ? { kind: 'assign', targetId: patch.seriesId, refs: [{ type: 'sermon', refId: creation.resource.id }] } : null).catch(() => undefined);
    }
    if (Object.keys(patch).some(key => key !== 'seriesId')) void action.updateCreation(current => sermonDraftPatch(current, patch,
      creation.resource.id, t('calendar.unspecifiedChurch'))).catch(() => undefined);
  };
  const save = async () => {
    if (!creation || saving || !action.durable || action.phase !== 'editing') return;
    setSaving(true);
    try {
      await action.updateCreation(current => ({ ...current, title: String(current.title ?? '').trim(), verse: String(current.verse ?? '').trim() }));
      await action.save(); onQueued(creation.resource.id);
    } catch { /* The same stage preserves both the input and the delivery identity. */ }
    finally { if (mounted.current) setSaving(false); }
  };
  const cancel = async () => { if (action.phase === 'editing') await action.cancel(); onClose(); };
  return <SermonFormDialog heading={t('addSermon.newSermon')}
    values={{ title: String(value.title ?? ''), verse: String(value.verse ?? ''), church: value.church as unknown as Church | undefined,
      plannedDate: dates[0]?.date ?? '', seriesId }} onChange={change}
    onSubmit={event => { event.preventDefault(); void save(); }} onDismiss={onClose}
    onCancel={() => { void cancel().catch(() => undefined); }} submitLabel={t('addSermon.save')}
    saving={saving} readOnly={!creation || action.phase !== 'editing'} submitDisabled={!action.durable}
    showPlannedDate={allowPlannedDate || dates.length > 0} detailsHint={t('addSermon.groupLaterHint')}
    seriesOptions={creation?.seriesOpened ? options : undefined}
    seriesStatus={<div className="space-y-3 p-4">
      {isCollectionOnEngine('series') && creation && !creation.seriesOpened && action.phase === 'editing' && <button type="button"
        className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={openingSeries || saving} onClick={() => { void openSeries(); }}>
        {t(openingSeries ? 'workspaces.series.loadingSeries' : 'workspaces.series.actions.selectSeries')}
      </button>}
      <DataMembershipStatus action={{ ...action, retry: action.phase ? action.retry : open }} onDiscarded={onClose} />
    </div>} />;
}

/** These are fields of one new document; planned-date persistence is not a second write. */
function sermonDraftPatch(current: DocumentData, patch: Partial<SermonFormValues>, id: string, unspecifiedChurch: string): DocumentData {
  const next = { ...current };
  for (const field of ['title', 'verse', 'church'] as const) if (field in patch) {
    if (patch[field] === undefined) delete next[field]; else next[field] = patch[field] as DocumentData[string];
  }
  const existing = ((current.preachDates ?? []) as unknown as PreachDate[])[0];
  const date = patch.plannedDate ?? existing?.date ?? '';
  if ('plannedDate' in patch || ('church' in patch && date)) next.preachDates = date ? [{
    ...existing, id: existing?.id ?? `${id}-planned`, date, status: 'planned', createdAt: existing?.createdAt ?? String(current.date),
    church: churchForNewPreachDate(next.church as unknown as Church | undefined, unspecifiedChurch),
  }] as unknown as DocumentData[string] : [];
  return deepCleanUndefined(next);
}
