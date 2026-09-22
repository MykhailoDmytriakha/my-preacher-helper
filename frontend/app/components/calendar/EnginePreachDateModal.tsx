'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { getTodayDateOnlyKey, toDateOnlyKey } from '@/utils/dateOnly';

import { PreachDateFields } from './PreachDateFields';
import { patchPreachDate, preachDateTarget, preparePreachDate, PREACH_DATE_SELECTION } from './preachDateForm';

import type { PreachDateAction } from './preachDateForm';
import type { PreachDate, Sermon } from '@/models/models';

/** Dates and the fallback status share one pinned, durable action and one delivery. */
export function EnginePreachDateModal({ sermonId, action, onClose }: {
  sermonId: string; action: PreachDateAction; onClose: () => void;
}) {
  const { t } = useTranslation();
  const form = useDataForm({ collection: 'sermons', id: sermonId }, `preach-date:${action.kind}:${action.dateId ?? 'new'}`, PREACH_DATE_SELECTION);
  const [newRow] = useState<PreachDate>(() => ({ id: newClientId(), createdAt: new Date().toISOString(), date: getTodayDateOnlyKey(),
    church: { id: '', name: '', city: '' }, status: action.status ?? 'planned' }));
  const initialized = useRef<object | null>(null);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const initial = form.initialData as unknown as Sermon | null, value = form.data as unknown as Sermon | null;
  const target = preachDateTarget(initial, value, action, newRow.id);
  useEffect(() => {
    if (!form.active || initialized.current === form.recoveryIdentity) return;
    initialized.current = form.recoveryIdentity;
    if (!form.dirty && !['conflict', 'refused', 'deleted'].includes(form.status?.phase ?? '')) {
      void form.update(current => preparePreachDate(current, action, { ...newRow, id: target })).catch(() => undefined);
    }
  }, [form, action, newRow, target]);
  const row = value?.preachDates?.find(date => date.id === target);
  const removal = action.kind === 'unmark' || action.kind === 'delete';
  const valid = removal || Boolean(row && toDateOnlyKey(row.date) && row.church.name.trim());
  const readOnly = loading || !form.active || form.busy || form.status?.phase === 'deleted';
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? sermonId), preview: ((record.stage[0]?.value ?? []) as unknown as PreachDate[])
        .map(date => [date.date, date.church.name, date.audience, date.notes].filter(Boolean).join(' · ')).join('\n').slice(0, 500) })), recover: form.recover });
  const save = async () => {
    if (readOnly || !valid || !form.dirty || !form.durable || !form.status?.canSave) return;
    try { await form.save(); onClose(); } catch { /* The shared form retains the draft and reports delivery. */ }
  };
  const title = action.kind === 'unmark' ? 'optionMenu.markAsNotPreached' : action.kind === 'mark' ? 'optionMenu.markAsPreached'
    : action.kind === 'delete' ? 'calendar.deleteConfirm' : action.kind === 'edit' ? 'calendar.editPreachDate' : 'calendar.addPreachDate';
  return <FormDialog title={t(title)} onClose={onClose} showCloseButton onSubmit={event => { event.preventDefault(); void save(); }}
    footer={<FormActions onCancel={() => { void form.cancel().then(onClose).catch(() => undefined); }} cancelLabel={t('buttons.cancel')}
      submitLabel={t(action.kind === 'delete' ? 'common.delete' : 'buttons.save')} savingLabel={t('buttons.saving')}
      saving={form.busy} cancelDisabled={form.busy} submitDisabled={readOnly || !valid || !form.dirty || !form.durable || !form.status?.canSave} />}>
    <DataSyncStatus status={form.status} error={form.error} onRetry={form.retry}
      onKeepLocal={valid ? form.keepLocal : undefined} onAcceptRemote={form.acceptRemote}
      recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
      onListRecovery={recovery.refresh} onRecover={recovery.recover} />
    {removal ? <p>{action.kind === 'delete' ? initial?.preachDates?.find(date => date.id === target)?.date : value?.title}</p>
      : row && <PreachDateFields value={{ date: toDateOnlyKey(row.date) ?? '', church: row.church, audience: row.audience ?? '', notes: row.notes ?? '' }}
        disabled={readOnly} onChange={patch => { void form.update(current => patchPreachDate(current, target, patch)).catch(() => undefined); }} />}
  </FormDialog>;
}
