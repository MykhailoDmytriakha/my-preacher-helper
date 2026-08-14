'use client';

import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import { PrayerRequest } from '@/models/models';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  announceIfPersisted,
  awaitAcceptance,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';

export type PrayerFormPayload = Pick<PrayerRequest, 'title'> &
  Partial<Pick<PrayerRequest, 'description' | 'tags'>> & {
    /** Exact input before persistence normalises whitespace and tags. */
    recoveryDraft: string;
  };

interface Props {
  onClose: () => void;
  onSubmit: (payload: PrayerFormPayload) => WriteSubmission;
  initialValues?: Partial<PrayerRequest>;
  mode?: 'create' | 'edit';
  closeOnSuccess?: boolean;
}

export default function CreatePrayerModal({ onClose, onSubmit, initialValues, mode = 'create', closeOnSuccess = true }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [tagsInput, setTagsInput] = useState((initialValues?.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

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
      const acceptance = await awaitAcceptance(
        onSubmit({
          title: title.trim(),
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
          recoveryDraft: recoveryText([title, description, tagsInput]),
        }),
        // usePrayerRequests' create/update recovery descriptor reports a late refusal while this screen is mounted.
        () => undefined
      );
      // A server-persisted edit retains the pre-contract confirmation. Creates are
      // queue-owned, so they intentionally stay silent even when accepted.
      if (isEdit) announceIfPersisted(acceptance, () => toast.success(t('prayer.toast.updated')));
      if (closeOnSuccess) {
        onClose();
        setSaving(false);
      }
    } catch (err) {
      // A REFUSAL is not a crash — say it in the person's language. The raw guard
      // message ("Refused a stale write to \"core\": built from revision 0…") leaked
      // into this box during live validation: technically true, useless to read, and
      // in English on a Russian screen.
      if (isStaleWriteError(err)) {
        // The page's conflict banner carries this text AND the two choices; this modal
        // covers it, so it steps aside rather than describing a choice it cannot offer.
        onClose();
        return;
      }
      /**
       * SILENT. Every prayer write has a recovery descriptor (`useWriteRecovery` in
       * usePrayerRequests), and it reports terminal failures with the person's text and a
       * retry. This editor showed its own message on top — sometimes the raw technical
       * one — so a single failed save arrived as two messages, one of them untranslated.
       * The editor's whole duty here is to stay open holding what was typed.
       */
      setError(null);
      setSaving(false);
    }
  };

  const isEdit = mode === 'edit';
  const i18nPrefix = isEdit ? 'prayer.edit' : 'prayer.create';

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t(`${i18nPrefix}.title`)}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-gray-200"
          >
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
              disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
            />
          </div>

          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
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
