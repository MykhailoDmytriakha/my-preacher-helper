'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import { useDataMembership } from '@/data-engine/react.client';
import { churchForNewPreachDate } from '@/utils/church';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { heldInSomeTab, holdWhileOpen } from '@/utils/openInTab';
import { hydrateSeries } from '@/utils/seriesDocument';

import SermonFormDialog from './SermonFormDialog';

import type { SermonFormValues } from './SermonFormDialog';
import type { DocumentData } from '@/data-engine/types';
import type { Church, PreachDate, Series } from '@/models/models';

/**
 * The stage owns typing and the new ID; this view never writes through legacy callbacks.
 * A sermon made from something (an analysis in the Bible, 2026-10-30) starts with its passage written and the link to it
 * (`sourceNoteIds`, the one stored fact of «built on this note»), said under the verse by `verseNote`.
 */
export function EngineCreateSermonModal({ recoveryId, preSelectedSeriesId, allowPlannedDate = false, initialVerse = '', sourceNoteIds, verseNote, layerClassName, onClose, onQueued }: {
  recoveryId?: string; preSelectedSeriesId?: string; allowPlannedDate?: boolean;
  initialVerse?: string; sourceNoteIds?: string[]; verseNote?: ReactNode; layerClassName?: string;
  onClose: () => void; onQueued: (id: string) => void;
}) {
  const { t } = useTranslation(), action = useDataMembership();
  const [initial] = useState(() => ({ title: '', verse: initialVerse, date: new Date().toISOString(), thoughts: [],
    ...(sourceNoteIds?.length ? { sourceNoteIds: [...sourceNoteIds] } : {}) }));
  const [saving, setSaving] = useState(false), [openingSeries, setOpeningSeries] = useState(false);
  const attempted = useRef<object | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = async () => {
    if (recoveryId) return action.recover(recoveryId);
    // No sermon is kept half-made (the owner, 2026-10-31: «вот это промежуточное состояние… не хранить»). What a page that is
    // gone left is settled before a new one starts: one before its Save is thrown away; one whose Save was pressed but not
    // yet handed over is saved — the Save was the person's (Codex, 31.10). One open in another tab of this browser is not this
    // window's to settle (`openInTab.ts`). When this browser cannot tell, nothing is thrown away, while a pressed Save is still
    // finished: thrown away by mistake it is lost, finished twice it is the same sermon handed over under the same identity.
    for (const record of await action.listRecoverable({ closedOnly: true })) {
      if (record.creation?.resource.collection !== 'sermons' || !['editing', 'saving'].includes(record.phase)) continue;
      const open = await heldInSomeTab(creationLock(record.scopeId));
      if (open === true || (open === null && record.phase === 'editing')) continue;
      try {
        await action.recover(record.scopeId);
        if (record.phase === 'editing') await action.cancel();
        else { await action.save(); action.dismiss(); }
      } catch { action.dismiss(); /* Left as it was: the next opening tries again. */ }
    }
    return action.beginCreate('sermons', initial, preSelectedSeriesId);
  };
  useEffect(() => {
    if (!action.ready || attempted.current === action.recoveryIdentity) return;
    attempted.current = action.recoveryIdentity; void open().catch(() => undefined);
  });
  const creation = action.creation, value: DocumentData = creation?.value ?? initial;
  // While its sermon is open here, other tabs see it open and leave it be.
  const openScope = creation ? action.scopeId : null;
  useEffect(() => (openScope ? holdWhileOpen(creationLock(openScope)) : undefined), [openScope]);
  const dates = (value.preachDates ?? []) as unknown as PreachDate[];
  const seriesId = action.action?.kind === 'assign' ? action.action.targetId : '';
  const options = action.values.map(row => hydrateSeries({ ...row.value, id: row.id } as unknown as Series))
    .map(row => ({ id: row.id, label: row.title || row.theme }));
  const seriesAttempt = useRef<string | null>(null);
  // The catalog that did not come: the row gives way to the shared status and a button to ask again.
  const [seriesFailed, setSeriesFailed] = useState(false);
  const openSeries = async () => {
    setOpeningSeries(true);
    try { await action.openSeries(); if (mounted.current) setSeriesFailed(false); }
    catch { if (mounted.current) setSeriesFailed(true); /* The shared status owns the error's words. */ }
    finally { if (mounted.current) setOpeningSeries(false); }
  };
  // The series show at once, never behind a button (the owner, 2026-10-31: «должна показываться серия, а не так, что
  // кнопка «Выбрать серию», а потом серия»). Without the catalog the sermon is still saved alone.
  useEffect(() => {
    if (!creation || creation.seriesOpened || seriesAttempt.current === creation.resource.id || action.phase !== 'editing') return;
    seriesAttempt.current = creation.resource.id; void openSeries();
  });
  const change = (patch: Partial<SermonFormValues>) => {
    if (!creation) return;
    if ('seriesId' in patch) {
      void action.update(patch.seriesId ? { kind: 'assign', targetId: patch.seriesId, refs: [{ type: 'sermon', refId: creation.resource.id }] } : null).catch(() => undefined);
    }
    if (Object.keys(patch).some(key => key !== 'seriesId')) void action.updateCreation(current => sermonDraftPatch(current, patch,
      creation.resource.id, t('calendar.unspecifiedChurch'))).catch(() => undefined);
  };
  const save = async () => {
    if (!creation || creation.requestedSeriesId || saving || !action.durable || action.phase !== 'editing') return;
    setSaving(true);
    try {
      // The trim and the Save in one moment: both change the stage at once, its writes queued in order, so no page closed in
      // between can leave a pressed Save looking like an unsaved draft (Codex, 31.10).
      const trimmed = action.updateCreation(current => ({ ...current, title: String(current.title ?? '').trim(), verse: String(current.verse ?? '').trim() }));
      const saved = action.save();
      // The Save is what counts: a trim whose own write failed is carried by the Save's write (Codex, 31.10).
      const [, done] = await Promise.allSettled([trimmed, saved]);
      if (done.status === 'fulfilled') onQueued(creation.resource.id);
    } catch { /* The same stage preserves both the input and the delivery identity. */ }
    finally { if (mounted.current) setSaving(false); }
  };
  // The creation starts empty but for what the screen gave it (a series, a passage), so whatever else it holds is the person's.
  const unsaved = Boolean(String(value.title ?? '').trim() || String(value.verse ?? '').trim() !== initialVerse.trim() || value.church || dates.length
    || (seriesId && seriesId !== preSelectedSeriesId));
  const cancel = async () => { if (action.phase === 'editing') await action.cancel(); onClose(); };
  return <SermonFormDialog heading={t('addSermon.newSermon')}
    values={{ title: String(value.title ?? ''), verse: String(value.verse ?? ''), church: value.church as unknown as Church | undefined,
      plannedDate: dates[0]?.date ?? '', seriesId }} onChange={change}
    onSubmit={event => { event.preventDefault(); void save(); }}
    onCancel={() => { void cancel().catch(onClose); }} unsaved={unsaved} submitLabel={t('addSermon.save')}
    saving={saving} readOnly={!creation || action.phase !== 'editing'} submitDisabled={!action.durable || Boolean(creation?.requestedSeriesId)}
    showPlannedDate={allowPlannedDate || dates.length > 0} detailsHint={t('addSermon.groupLaterHint')}
    verseNote={verseNote} layerClassName={layerClassName}
    seriesOptions={creation?.seriesOpened ? options : seriesFailed ? undefined : []} seriesLoading={!creation?.seriesOpened && !seriesFailed}
    // Nothing to say — no room either: an empty status stood as a blank band under the series.
    seriesStatus={<div className="space-y-3 p-4 empty:hidden">
      {creation?.requestedSeriesId && <div>
        <p>{t('addSermon.pendingSeries')}</p>
        <button type="button" className="rounded-lg border px-3 py-2" onClick={() => { void action.update(null).catch(() => undefined); }}>
          {t('addSermon.createWithoutSeries')}
        </button>
      </div>}
      {seriesFailed && creation && !creation.seriesOpened && action.phase === 'editing' && <button type="button"
        className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={openingSeries || saving} onClick={() => { void openSeries(); }}>
        {t(openingSeries ? 'workspaces.series.loadingSeries' : 'workspaces.series.actions.selectSeries')}
      </button>}
      <DataMembershipStatus action={{ ...action, retry: async () => {
        if (!action.phase) { await open(); return; }
        await action.retry();
        if (creation?.requestedSeriesId) await action.openSeries();
      } }} onDiscarded={onClose} />
    </div>} />;
}

/** These are fields of one new document; planned-date persistence is not a second write. */
/** The lock a sermon's creation holds while its window is open in a tab. */
const creationLock = (scopeId: string) => `sermon-creation:${scopeId}`;

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
