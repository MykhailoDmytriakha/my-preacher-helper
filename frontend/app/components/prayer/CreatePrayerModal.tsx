'use client';

import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { PrayerRequest } from '@/models/models';

interface Props {
  onClose: () => void;
  onSubmit: (payload: Pick<PrayerRequest, 'title'> & Partial<Pick<PrayerRequest, 'description' | 'tags'>>) => Promise<void>;
  initialValues?: Partial<PrayerRequest>;
  mode?: 'create' | 'edit';
}

export default function CreatePrayerModal({ onClose, onSubmit, initialValues, mode = 'create' }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [tagsInput, setTagsInput] = useState((initialValues?.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = mode === 'edit';
  const i18nPrefix = isEdit ? 'prayer.edit' : 'prayer.create';

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t(`${i18nPrefix}.title`)}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('prayer.create.titleLabel')} <span className="text-red-500">*</span>
            </label>
            <TextareaAutosize
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('prayer.create.titlePlaceholder') as string}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none text-sm"
              minRows={2}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('prayer.create.descriptionLabel')}
            </label>
            <TextareaAutosize
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('prayer.create.descriptionPlaceholder') as string}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none text-sm"
              minRows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('prayer.create.tagsLabel')}
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('prayer.create.tagsPlaceholder') as string}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-400 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              {t(`${i18nPrefix}.cancel`)}
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="inline-flex min-w-[170px] items-center justify-center gap-2 px-4 py-2 text-sm bg-rose-500 hover:bg-rose-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              aria-busy={saving}
            >
              {saving && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
              <span>{saving ? t('buttons.saving') : t(`${i18nPrefix}.submit`)}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
