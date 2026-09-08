"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { Series } from '@/models/models';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';

import SeriesFormFields, { seriesFormPatch, seriesFormValues, type SeriesFormValues } from './SeriesFormFields';

interface EditSeriesModalProps {
  series: Series;
  onClose: () => void;
  onUpdate: (seriesId: string, updates: Partial<Series>) => WriteSubmission;
}

export default function EditSeriesModal({ series, onClose, onUpdate }: EditSeriesModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => seriesFormValues(series));
  const formEditedRef = useRef(false);
  // Fresh cache data may replace an untouched form, never a person's draft.
  useEffect(() => {
    if (!formEditedRef.current) setValues(seriesFormValues(series));
  }, [series]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeFields = (patch: Partial<SeriesFormValues>) => {
    formEditedRef.current = true;
    setValues(previous => ({ ...previous, ...patch }));
    if ('title' in patch || 'description' in patch || 'bookOrTopic' in patch) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setSaving(true);
      await awaitAcceptance(onUpdate(series.id, {
        ...seriesFormPatch(values)
      // useSeries' update recovery descriptor reports a late refusal while this screen is mounted.
      }), () => undefined);

      onClose();
    } catch (error) {
      /**
       * One refusal, one reporter (docs/recoverable-writes.md): this entity's recovery
       * descriptor carries the text and follows the person off this screen. The editor
       * stays open holding what was typed; a transient failure still shows here,
       * because nothing else explains it.
       */
      if (isStaleWriteError(error)) {
        /**
         * The series page's conflict banner already holds this text and offers "keep mine
         * / take theirs". This modal covers the page, so staying open would hide the only
         * place the choice can be made. Stepping aside loses nothing.
         */
        onClose();
        return;
      }
      setError(
        writeFailureTranslationKey(error, '') === 'writeRecovery.refused'
          ? ''
          : t('common.saveError')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog title={t('workspaces.series.editSeries')} eyebrow={t('navigation.series')} description={t('workspaces.series.form.editHint')} onClose={onClose}>
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">{error}</div>}
      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <SeriesFormFields values={values} onChange={changeFields} colorPickerTitle={t('workspaces.series.editSeries')} />
        <FormActions onCancel={onClose} cancelLabel={t('workspaces.series.actions.cancel')} submitLabel={t('workspaces.series.actions.saveChanges')} saving={saving} />
      </form>
    </FormDialog>
  );
}
