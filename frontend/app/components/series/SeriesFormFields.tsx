'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import ColorPickerModal from '@/components/ColorPickerModal';
import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { SERIES_COLOR_PRESETS } from '@/utils/themeColors';

import type { Series } from '@/models/models';

export interface SeriesFormValues {
  title: string;
  description: string;
  bookOrTopic: string;
  color: string;
  status: Series['status'];
}

export function seriesFormValues(series?: Series): SeriesFormValues {
  return {
    title: series?.title ?? '', description: series?.description ?? '', bookOrTopic: series?.bookOrTopic ?? '',
    color: series?.color || SERIES_COLOR_PRESETS[0], status: series?.status ?? 'draft',
  };
}

export function seriesFormPatch(values: SeriesFormValues) {
  return {
    title: values.title.trim(), theme: values.title.trim(), description: values.description.trim() || undefined,
    bookOrTopic: values.bookOrTopic.trim(), color: values.color || undefined, status: values.status,
  };
}

interface SeriesFormFieldsProps {
  values: SeriesFormValues;
  onChange: (patch: Partial<SeriesFormValues>) => void;
  colorPickerTitle: string;
}

export default function SeriesFormFields({ values, onChange, colorPickerTitle }: SeriesFormFieldsProps) {
  const { t } = useTranslation();
  const [pickingColor, setPickingColor] = useState(false);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={t('workspaces.series.form.title')} required>
          <TextareaAutosize value={values.title} onChange={e => onChange({ title: e.target.value })}
            placeholder={t('workspaces.series.form.titlePlaceholder')} className={FORM_INPUT_CLASS} minRows={1} maxRows={3} required />
        </FormField>
        <FormField label={t('workspaces.series.form.bookOrTopic')} required>
          <input type="text" value={values.bookOrTopic} onChange={e => onChange({ bookOrTopic: e.target.value })}
            placeholder={t('workspaces.series.form.bookOrTopicPlaceholder')} className={FORM_INPUT_CLASS} required />
        </FormField>
      </div>
      <FormField label={t('workspaces.series.form.description')}>
        <RichMarkdownEditor value={values.description} onChange={description => onChange({ description })}
          placeholder={t('workspaces.series.form.descriptionPlaceholder')} minHeight="120px" />
      </FormField>
      <FormField label={t('workspaces.series.form.status')}>
        <select value={values.status} onChange={e => onChange({ status: e.target.value as Series['status'] })} className={FORM_INPUT_CLASS}>
          {(['draft', 'active', 'completed'] as const).map(status => <option key={status} value={status}>{t(`workspaces.series.form.statuses.${status}`)}</option>)}
        </select>
      </FormField>
      <div className="space-y-3">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('workspaces.series.form.color')}</span>
        <div className="flex flex-wrap gap-2">
          {SERIES_COLOR_PRESETS.map(color => (
            <button key={color} type="button" title={color} aria-label={color} aria-pressed={values.color === color} onClick={() => onChange({ color })}
              className={`h-9 w-9 rounded-full border-2 transition-all ${values.color === color ? 'border-blue-600 ring-2 ring-blue-600/20 dark:border-blue-400 dark:ring-blue-400/30 scale-110' : 'border-gray-200 hover:scale-105 dark:border-gray-700'}`}
              style={{ backgroundColor: color }} />
          ))}
          <button type="button" onClick={() => setPickingColor(true)} title={t('workspaces.series.form.customColor')}
            className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-gradient-to-br from-indigo-500 via-pink-500 to-amber-400 text-white shadow-sm transition hover:scale-105 ${!SERIES_COLOR_PRESETS.some(color => color === values.color) ? 'ring-2 ring-white/60 dark:ring-gray-900' : ''}`}>+</button>
        </div>
      </div>
      {pickingColor && createPortal(<ColorPickerModal tagName={colorPickerTitle} initialColor={values.color}
        onOk={color => { onChange({ color }); setPickingColor(false); }} onCancel={() => setPickingColor(false)} />, document.body)}
    </>
  );
}
