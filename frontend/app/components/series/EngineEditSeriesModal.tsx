'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';

import SeriesFormFields, { seriesFormPatch, seriesFormValues, type SeriesFormValues } from './SeriesFormFields';

import type { DocumentData } from '@/data-engine/types';
import type { Series } from '@/models/models';

export const SERIES_METADATA_SELECTION = ['title', 'theme', 'description', 'bookOrTopic', 'status', 'color', 'startDate', 'duration'].map(field => [field]);

/** Opening pins metadata once; later observations cannot replace the form's ancestor. */
export function EngineEditSeriesModal({ seriesId, onClose }: { seriesId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const form = useDataForm({ collection: 'series', id: seriesId }, 'series-metadata', SERIES_METADATA_SELECTION);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? seriesId),
      preview: record.stage.filter(field => field.exists && typeof field.value === 'string').map(field => String(field.value)).join('\n').slice(0, 500) })),
    recover: form.recover });
  const values = seriesFormValues(form.data as unknown as Series | undefined);
  const change = (patch: Partial<SeriesFormValues>) => {
    void form.update(current => ({ ...current, ...patch, ...('title' in patch ? { theme: patch.title! } : {}) }) as DocumentData).catch(() => undefined);
  };
  const save = async () => {
    await form.save(current => {
      const values = seriesFormValues(current as unknown as Series);
      if (!values.title.trim() || !values.bookOrTopic.trim()) throw new Error(t('common.fillRequiredField', {
        field: t(!values.title.trim() ? 'workspaces.series.form.title' : 'workspaces.series.form.bookOrTopic'),
      }));
      return deepCleanUndefined({ ...current, ...seriesFormPatch(values) }) as DocumentData;
    });
    onClose();
  };
  return <FormDialog title={t('workspaces.series.editSeries')} eyebrow={t('navigation.series')}
    description={t('workspaces.series.form.editHint')} onClose={onClose}>
    <form noValidate onSubmit={event => { event.preventDefault(); void save().catch(() => undefined); }} className="mt-6 space-y-5">
      <fieldset disabled={loading || !form.active || form.busy}>
        <SeriesFormFields values={values} onChange={change} colorPickerTitle={t('workspaces.series.editSeries')} />
      </fieldset>
      <DataSyncStatus status={form.status} error={form.error} onRetry={form.retry}
      onKeepLocal={form.keepLocal} onAcceptRemote={form.acceptRemote}
        recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
        onListRecovery={recovery.refresh} onRecover={recovery.recover} />
      <FormActions onCancel={() => { void form.cancel().then(onClose).catch(() => undefined); }}
        cancelLabel={t('workspaces.series.actions.cancel')} submitLabel={t('workspaces.series.actions.saveChanges')}
        saving={loading || form.busy} submitDisabled={!form.active || !form.status?.canSave} />
    </form>
  </FormDialog>;
}
