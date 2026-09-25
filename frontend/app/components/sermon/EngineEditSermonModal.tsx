'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngineSeriesField } from '@/components/series/useEngineSeriesField';
import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { toDateOnlyKey } from '@/utils/dateOnly';

import SermonFormDialog from './SermonFormDialog';
import { SERMON_METADATA_SELECTION, sermonMetadataDateId, sermonMetadataPatch } from './sermonMetadataForm';

import type { SermonFormValues } from './SermonFormDialog';
import type { Church, Sermon } from '@/models/models';

/** The form pins its own fields; list props and later remote reads cannot change its ancestor. */
export function EngineEditSermonModal({ sermonId, onClose }: { sermonId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const form = useDataForm({ collection: 'sermons', id: sermonId }, 'sermon-metadata', SERMON_METADATA_SELECTION);
  const series = useEngineSeriesField({ type: 'sermon', refId: sermonId });
  const [newDate] = useState(() => ({ id: newClientId(), createdAt: new Date().toISOString() }));
  const [saving, setSaving] = useState(false);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? sermonId),
      preview: record.stage.filter(field => field.exists && typeof field.value === 'string').map(field => String(field.value)).join('\n').slice(0, 500) })),
    recover: form.recover });
  const initial = form.initialData as unknown as Sermon | null, value = form.data as unknown as Sermon | null;
  const plannedId = sermonMetadataDateId(initial, value, newDate.id, new Date(newDate.createdAt));
  const plannedDate = value?.preachDates?.find(date => date.id === plannedId);
  const change = (patch: Partial<SermonFormValues>) => {
    if ('seriesId' in patch) void series.change(patch.seriesId ?? '').catch(() => undefined);
    if (Object.keys(patch).some(key => key !== 'seriesId')) void form.update(current => sermonMetadataPatch(current, patch,
      plannedId, newDate.createdAt, t('calendar.unspecifiedChurch'))).catch(() => undefined);
  };
  const save = async () => {
    if (saving || form.busy || !form.active || !form.durable || form.status?.phase === 'deleted') return;
    setSaving(true);
    try {
      // Membership keeps its own immutable identity if the metadata capture needs a retry.
      await series.save();
      await form.save(current => ({ ...current, title: String(current.title).trim(), verse: String(current.verse).trim() }));
      onClose();
    } catch { /* Both public owners retain input and publish their own failure. */ }
    finally { setSaving(false); }
  };
  const cancel = async () => { await form.cancel(); await series.cancel(); onClose(); };
  return <SermonFormDialog heading={t('editSermon.editSermon')}
    values={{ title: value?.title ?? '', verse: value?.verse ?? '', church: value?.church as Church | undefined,
      plannedDate: toDateOnlyKey(plannedDate?.date) || '', seriesId: series.seriesId }} onChange={change}
    onSubmit={event => { event.preventDefault(); void save(); }} onDismiss={onClose}
    onCancel={() => { void cancel().catch(() => undefined); }} submitLabel={t('buttons.save')}
    saving={saving || form.busy} readOnly={loading || !form.active || form.status?.phase === 'deleted'}
    submitDisabled={!form.durable || series.unsettled || (!form.dirty && !series.changed)} showPlannedDate
    seriesOptions={series.enabled ? series.options : undefined} seriesLoading={series.loading} seriesDisabled={series.disabled}
    detailsHint={t('editSermon.plannedDateHint')}
    seriesStatus={<div className="space-y-3 p-4">
      <DataSyncStatus status={form.status} error={form.error} onRetry={form.retry}
        onKeepLocal={form.keepLocal} onAcceptRemote={form.acceptRemote}
        recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
        onListRecovery={recovery.refresh} onRecover={recovery.recover} />
      {series.enabled && <DataMembershipStatus action={{ ...series.action, retry: series.retry }} />}
    </div>} />;
}
