'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument } from '@/data-engine/react.client';
import { useAuth } from '@/providers/AuthProvider';
import { refusalWords, saidError, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';

import SeriesFormFields, { missingSeriesField, seriesFormPatch, seriesFormValues, type SeriesFormValues } from './SeriesFormFields';

import type { DocumentData } from '@/data-engine/types';
import type { Series } from '@/models/models';

/** Creation is an absent-document draft; only explicit Create captures its delivery. */
export function EngineCreateSeriesModal({ seriesId, recoveryId, onClose, onQueued }: {
  seriesId: string; recoveryId?: string; onClose: () => void; onQueued: (id: string) => void;
}) {
  const { t } = useTranslation(), { user } = useAuth();
  const [initial] = useState(() => ({ ...seriesFormValues(), theme: '', userId: user?.uid ?? '',
    items: [], sermonIds: [], seriesKind: 'sermon', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const document = useDataDocument({ collection: 'series', id: seriesId }, { create: true, autoSave: false, slot: 'series-create' });
  const [saving, setSaving] = useState(false), [restored, setRestored] = useState(!recoveryId);
  const [failure, setFailure] = useState<FailureWords | null>(null);
  // An empty required field is the form's own message; the sync status speaks only of delivery.
  const [missing, setMissing] = useState<string | null>(null);
  const attempted = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!recoveryId || document.loading || attempted.current) return;
    attempted.current = true;
    void document.recover(recoveryId).then(() => { if (mounted.current) setRestored(true); }, error => {
      if (mounted.current) setFailure(refusalWords(error, 'dataSync.documentFailed'));
    });
  }, [document, recoveryId]);
  const values = seriesFormValues((document.data ?? initial) as unknown as Series);
  const change = (patch: Partial<SeriesFormValues>) => {
    setMissing(null);
    void document.update(current => ({ ...(current ?? initial), ...patch,
      ...('title' in patch ? { theme: patch.title! } : {}) }) as DocumentData).catch(() => undefined);
  };
  const create = async () => {
    if (saving || document.loading || !restored) return;
    const empty = missingSeriesField(values);
    setMissing(empty ? t('common.fillRequiredField', { field: t(empty) }) : null);
    if (empty) return;
    setSaving(true); setFailure(null);
    try {
      await document.commit(current => {
        const draft = current ?? initial, form = seriesFormValues(draft as unknown as Series);
        const emptyNow = missingSeriesField(form);
        if (emptyNow) throw saidError(t('common.fillRequiredField', { field: t(emptyNow) }));
        return deepCleanUndefined({ ...draft, ...seriesFormPatch(form) }) as DocumentData;
      });
      if (mounted.current) onQueued(seriesId);
    } catch (error) { if (mounted.current) setFailure(refusalWords(error, 'dataSync.documentFailed')); }
    finally { if (mounted.current) setSaving(false); }
  };
  const busy = saving || document.loading || !restored;
  return <FormDialog noValidate title={t('workspaces.series.newSeries')} eyebrow={t('navigation.series')}
    description={t('workspaces.series.form.createHint')} onClose={onClose} showCloseButton onSubmit={event => { event.preventDefault(); void create(); }}
    footer={
      <FormActions onCancel={onClose} cancelLabel={t('workspaces.series.actions.cancel')}
        submitLabel={t('workspaces.series.actions.createSeries')} saving={busy} />
    }>
    <div className="space-y-5">
      <fieldset disabled={busy}>
        <SeriesFormFields values={values} onChange={change} colorPickerTitle={t('workspaces.series.newSeries')} />
      </fieldset>
      {missing && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{missing}</p>}
      <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={failure ? sayFailure(failure, t) : document.error} onRetry={async () => {
        if (recoveryId && !restored) { await document.recover(recoveryId); setRestored(true); setFailure(null); }
        else await document.retry();
      }} />
    </div>
  </FormDialog>;
}
