'use client';

import { useEffect, useState } from 'react';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataEngine, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { fillRequiredField, fillRequiredFieldError, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { useTranslation } from '@locales/useTranslation';

import SeriesFormFields, { missingSeriesField, seriesFormPatch, seriesFormValues, type SeriesFormValues } from './SeriesFormFields';
import { SeriesMetadataHistory } from './SeriesMetadataHistory';

import type { DocumentData } from '@/data-engine/types';
import type { Series } from '@/models/models';

export const SERIES_METADATA_SELECTION = ['title', 'theme', 'description', 'bookOrTopic', 'status', 'color', 'startDate', 'duration'].map(field => [field]);

/** Opening pins metadata once; later observations cannot replace the form's ancestor. */
export function EngineEditSeriesModal({ seriesId, onClose }: { seriesId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { owner } = useDataEngine();
  const form = useDataForm({ collection: 'series', id: seriesId }, 'series-metadata', SERIES_METADATA_SELECTION);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading && form.recoveryReady, version: form.recoveryVersion,
    list: async () => (await form.listRecoverable()).map(source => ({ id: source.scopeId,
      title: String(source.record.baseline.value?.title ?? seriesId),
      preview: source.record.stage.filter(field => field.exists && typeof field.value === 'string').map(field => String(field.value)).join('\n').slice(0, 500),
      discard: () => form.discardRecovery(source) })),
    recover: form.recover });
  const generation = form.openingGeneration;
  const values = seriesFormValues(form.data as unknown as Series | undefined);
  // An empty required field is the form's own message; the sync status speaks only of delivery.
  // Kept as words, so a language switch re-says it (BUG-20261003-said-refusal-keeps-old-language).
  const [missing, setMissing] = useState<FailureWords | null>(null);
  const change = (patch: Partial<SeriesFormValues>) => {
    setMissing(null);
    void form.update(current => ({ ...current, ...patch, ...('title' in patch ? { theme: patch.title! } : {}) }) as DocumentData).catch(() => undefined);
  };
  const save = async () => {
    const empty = missingSeriesField(values);
    setMissing(empty ? fillRequiredField(empty) : null);
    if (empty) return;
    const action = form.captureDocumentMetadataAction();
    await form.save(current => {
      const values = seriesFormValues(current as unknown as Series);
      const emptyNow = missingSeriesField(values);
      if (emptyNow) throw fillRequiredFieldError(emptyNow);
      const { title, theme, ...fields } = seriesFormPatch(values);
      const opening = form.initialData;
      // Defaults used to render old records are not changes the person made.
      const edits = Object.fromEntries(Object.entries({ ...fields, color: current.color === undefined ? undefined : fields.color })
        .filter(([field]) => current[field] !== opening?.[field]));
      const keepName = opening && seriesFormValues(opening as unknown as Series).title.trim() === title;
      return deepCleanUndefined({ ...current, ...edits,
        ...(keepName ? { title: opening.title, theme: opening.theme } : { title, theme }) }) as DocumentData;
    }, action);
    onClose();
  };
  return <FormDialog noValidate title={t('workspaces.series.editSeries')} eyebrow={t('navigation.series')}
    description={t('workspaces.series.form.editHint')} onClose={() => { void form.cancel().then(onClose).catch(() => undefined); }} unsaved={form.dirty} showCloseButton onSubmit={event => { event.preventDefault(); void save().catch(() => undefined); }}
    footer={
      <FormActions onCancel={() => { void form.cancel().then(onClose).catch(() => undefined); }}
        cancelLabel={t('workspaces.series.actions.cancel')} submitLabel={t('workspaces.series.actions.saveChanges')}
        saving={loading || form.busy} submitDisabled={!form.active || !form.status?.canSave} unsaved={form.dirty} />
    }>
    <div className="space-y-5">
      <fieldset disabled={loading || !form.active || form.busy}>
        <SeriesFormFields values={values} onChange={change} colorPickerTitle={t('workspaces.series.editSeries')} />
      </fieldset>
      {owner && generation && <SeriesMetadataHistory key={JSON.stringify([owner, seriesId, generation])}
        owner={owner} generation={generation} seriesId={seriesId} current={form.data}
        disabled={!form.active || !form.durable || form.busy}
        onRestore={(field, value) => form.update(current => {
          const next = { ...current };
          if (value === null) delete next[field];
          else {
            next[field] = value;
            if (field === 'title') next.theme = value;
          }
          return next;
        })} />}
      {missing && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{sayFailure(missing, t)}</p>}
      <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error} errorWords={form.errorWords} onRetry={form.retry}
      onKeepLocal={form.keepLocal} onAcceptRemote={form.acceptRemote}
        recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
        onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />
    </div>
  </FormDialog>;
}
