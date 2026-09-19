'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument } from '@/data-engine/react.client';
import { useAuth } from '@/providers/AuthProvider';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';

import SeriesFormFields, { seriesFormPatch, seriesFormValues, type SeriesFormValues } from './SeriesFormFields';

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
  const [failure, setFailure] = useState<string | null>(null);
  const attempted = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!recoveryId || document.loading || attempted.current) return;
    attempted.current = true;
    void document.recover(recoveryId).then(() => { if (mounted.current) setRestored(true); }, error => {
      if (mounted.current) setFailure(error instanceof Error ? error.message : 'Draft recovery failed');
    });
  }, [document, recoveryId]);
  const values = seriesFormValues((document.data ?? initial) as unknown as Series);
  const change = (patch: Partial<SeriesFormValues>) => {
    void document.update(current => ({ ...(current ?? initial), ...patch,
      ...('title' in patch ? { theme: patch.title! } : {}) }) as DocumentData).catch(() => undefined);
  };
  const create = async () => {
    if (saving || document.loading || !restored) return;
    setSaving(true); setFailure(null);
    try {
      await document.commit(current => {
        const draft = current ?? initial, form = seriesFormValues(draft as unknown as Series);
        if (!form.title.trim() || !form.bookOrTopic.trim()) throw new Error(t('common.fillRequiredField', {
          field: t(!form.title.trim() ? 'workspaces.series.form.title' : 'workspaces.series.form.bookOrTopic'),
        }));
        return deepCleanUndefined({ ...draft, ...seriesFormPatch(form) }) as DocumentData;
      });
      if (mounted.current) onQueued(seriesId);
    } catch (error) { if (mounted.current) setFailure(error instanceof Error ? error.message : 'Series creation failed'); }
    finally { if (mounted.current) setSaving(false); }
  };
  const busy = saving || document.loading || !restored;
  return <FormDialog title={t('workspaces.series.newSeries')} eyebrow={t('navigation.series')}
    description={t('workspaces.series.form.createHint')} onClose={onClose}>
    <form noValidate onSubmit={event => { event.preventDefault(); void create(); }} className="mt-6 space-y-5">
      <fieldset disabled={busy}>
        <SeriesFormFields values={values} onChange={change} colorPickerTitle={t('workspaces.series.newSeries')} />
      </fieldset>
      <DataSyncStatus status={document.status} error={failure ?? document.error} onRetry={async () => {
        if (recoveryId && !restored) { await document.recover(recoveryId); setRestored(true); setFailure(null); }
        else await document.retry();
      }} />
      <FormActions onCancel={onClose} cancelLabel={t('workspaces.series.actions.cancel')}
        submitLabel={t('workspaces.series.actions.createSeries')} saving={busy} />
    </form>
  </FormDialog>;
}
