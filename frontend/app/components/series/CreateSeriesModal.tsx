"use client";

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { Series } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';

import SeriesFormFields, { seriesFormPatch, seriesFormValues } from './SeriesFormFields';

interface CreateSeriesModalProps {
  onClose: () => void;
  onCreate: (series: Omit<Series, 'id'>) => WriteSubmission;
  initialSermonIds?: string[];
}

export default function CreateSeriesModal({ onClose, onCreate, initialSermonIds = [] }: CreateSeriesModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [values, setValues] = useState(seriesFormValues);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSaving(true);
      await awaitAcceptance(onCreate({
        ...seriesFormPatch(values),
        sermonIds: initialSermonIds,
        userId: user?.uid || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      // useSeries' create recovery descriptor reports a late refusal while this screen is mounted.
      }), () => undefined);

      onClose();
    } catch (error) {
        /**
         * The refusal is reported by this entity's recovery descriptor, which carries
         * the person's text and follows them off this screen. This editor's job is to
         * stay open and keep what they typed — saying it here as well showed one
         * refused action as two failures.
         */
      console.error('Failed to create series:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog title={t('workspaces.series.newSeries')} eyebrow={t('navigation.series')} description={t('workspaces.series.form.createHint')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <SeriesFormFields values={values} onChange={patch => setValues(previous => ({ ...previous, ...patch }))} colorPickerTitle={t('workspaces.series.newSeries')} />
        {initialSermonIds.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
            {t('workspaces.series.form.initialSermonsHint', { count: initialSermonIds.length })}
          </div>
        )}
        <FormActions onCancel={onClose} cancelLabel={t('workspaces.series.actions.cancel')} submitLabel={t('workspaces.series.actions.createSeries')} saving={saving} />
      </form>
    </FormDialog>
  );
}
