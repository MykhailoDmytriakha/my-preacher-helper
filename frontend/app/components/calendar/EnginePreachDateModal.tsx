'use client';

import { useEffect, useRef, useState } from 'react';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { contentFingerprint } from '@/utils/contentFingerprint';
import { getTodayDateOnlyKey, toDateOnlyKey } from '@/utils/dateOnly';
import { useTranslation } from '@locales/useTranslation';

import { PreachDateFields } from './PreachDateFields';
import { canRestorePreachDateField, patchPreachDate, preachDateTarget, preparePreachDate, PREACH_DATE_SELECTION } from './preachDateForm';

import type { PreachDateAction } from './preachDateForm';
import type { DocumentData } from '@/data-engine/types';
import type { PreachDate, Sermon } from '@/models/models';

/** Dates and the fallback status share one pinned, durable action and one delivery. */
export function EnginePreachDateModal({ sermonId, action, onClose }: {
  sermonId: string; action: PreachDateAction; onClose: () => void;
}) {
  const { t } = useTranslation();
  const restoreKey = action.restoreField ? ':field:' + action.restoreField.historyId : '';
  const slot = `preach-date:${action.kind}:${action.dateId ?? 'new'}${action.restoreDate ? ':' + action.restoreDate : ''}${restoreKey}`;
  const form = useDataForm({ collection: 'sermons', id: sermonId }, slot, PREACH_DATE_SELECTION);
  const [newRow] = useState<PreachDate>(() => ({ id: newClientId(), createdAt: new Date().toISOString(), date: getTodayDateOnlyKey(),
    church: { id: '', name: '', city: '' }, status: action.status ?? 'planned' }));
  const initialized = useRef<object | null>(null);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const initial = form.initialData as unknown as Sermon | null, value = form.data as unknown as Sermon | null;
  const target = preachDateTarget(initial, value, action, newRow.id);
  const initialRow = initial?.preachDates?.find(date => date.id === target);
  const unavailableRestore = Boolean(form.active && action.restoreField && (!initialRow || !canRestorePreachDateField(initialRow, action.restoreField)));
  useEffect(() => {
    if (!form.active || unavailableRestore || initialized.current === form.recoveryIdentity) return;
    initialized.current = form.recoveryIdentity;
    if (!form.dirty && !['conflict', 'refused', 'deleted'].includes(form.status?.phase ?? '')) {
      const detail = action.restoreField?.field;
      void form.update(current => preparePreachDate(current, action, { ...newRow, id: target }), detail ? { detail, rowId: target } : undefined).catch(() => undefined);
    }
  }, [form, action, newRow, target, unavailableRestore]);
  const row = value?.preachDates?.find(date => date.id === target);
  const removal = action.kind === 'unmark' || action.kind === 'delete';
  // The form stages its own starting row on open, so it is dirty before anyone types: what the
  // person changed is the difference from that starting row.
  const unsaved = (() => {
    try {
      const prepared = initial && preparePreachDate(initial as unknown as DocumentData, action, { ...newRow, id: target }) as unknown as Sermon;
      return Boolean(prepared && value) && contentFingerprint(prepared ? prepared.preachDates ?? [] : []) !== contentFingerprint(value?.preachDates ?? []);
    } catch { return false; }
  })();
  const valid = removal || Boolean(row && toDateOnlyKey(row.date) && row.church.name.trim());
  const readOnly = loading || unavailableRestore || !form.active || form.busy || form.status?.phase === 'deleted';
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading && form.recoveryReady, version: form.recoveryVersion,
    list: async () => (await form.listRecoverable()).map(source => ({ id: source.scopeId,
      title: String(source.record.baseline.value?.title ?? sermonId), preview: ((source.record.stage[0]?.value ?? []) as unknown as PreachDate[])
        .map(date => [date.date, date.church.name, date.audience, date.notes].filter(Boolean).join(' · ')).join('\n').slice(0, 500),
      discard: () => form.discardRecovery(source) })), recover: form.recover });
  const save = async () => {
    if (readOnly || !valid || !form.dirty || !form.durable || !form.status?.canSave) return;
    try {
      if (action.kind === 'edit' || (action.kind === 'mark' && initial?.preachDates?.some(date => date.id === target))) {
        await form.save(undefined, { preachDateId: target });
      }
      else await form.save();
      onClose();
    } catch { /* The shared form retains the draft and reports delivery. */ }
  };
  const title = action.kind === 'unmark' ? 'optionMenu.markAsNotPreached' : action.kind === 'mark' ? 'optionMenu.markAsPreached'
    : action.kind === 'delete' ? 'calendar.deleteConfirm' : action.kind === 'edit' ? 'calendar.editPreachDate' : 'calendar.addPreachDate';
  return <FormDialog title={t(title)} onClose={() => { void form.cancel().then(onClose).catch(() => undefined); }} unsaved={unsaved} showCloseButton onSubmit={event => { event.preventDefault(); void save(); }}
    footer={<FormActions onCancel={() => { void form.cancel().then(onClose).catch(() => undefined); }} cancelLabel={t('buttons.cancel')}
      submitLabel={t(action.kind === 'delete' ? 'common.delete' : 'buttons.save')} savingLabel={t('buttons.saving')}
      saving={form.busy} cancelDisabled={form.busy} unsaved={unsaved} submitDisabled={readOnly || !valid || !form.dirty || !form.durable || !form.status?.canSave} />}>
    <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error} errorWords={form.errorWords} onRetry={form.retry}
      onKeepLocal={valid ? form.keepLocal : undefined} onAcceptRemote={form.acceptRemote}
      recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
      onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />
    {unavailableRestore ? <p role="alert">{t('calendar.preachDetailUnavailableForDate')}</p> : removal ? <p>{action.kind === 'delete' ? initial?.preachDates?.find(date => date.id === target)?.date : value?.title}</p>
      : row && <PreachDateFields value={{ date: row.date ?? '', church: row.church, audience: row.audience ?? '', notes: row.notes ?? '' }}
        disabled={readOnly} onChange={(patch, churchDetail) => {
          const detail = patch.audience !== undefined ? 'audience' : churchDetail;
          void form.update(current => patchPreachDate(current, target, patch), detail ? { detail, rowId: target } : undefined).catch(() => undefined);
        }} />}
  </FormDialog>;
}
