'use client';

import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { announceIfPersisted, awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';

interface Props {
  onClose: () => void;
  onSubmit: (answerText?: string, recoveryDraft?: string) => WriteSubmission;
}

export default function MarkAnsweredModal({ onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [answerText, setAnswerText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (text?: string) => {
    setError(null);
    setSaving(true);
    try {
      const acceptance = await awaitAcceptance(
        onSubmit(text?.trim() || undefined, text),
        // usePrayerRequests' status recovery descriptor reports a late refusal while this screen is mounted.
        () => undefined
      );
      announceIfPersisted(acceptance, () => toast.success(t('prayer.toast.statusChanged')));
      onClose();
    } catch (errorValue) {
      // A refusal belongs to the open editor: keep the answer exactly where it was
      // typed and use the shared wording instead of silently doing nothing.
      if (isStaleWriteError(errorValue)) {
        /**
         * A STALE REFUSAL IS A CHOICE, and the choice lives on the page: the conflict
         * banner already holds this exact answer text and offers "keep mine / take
         * theirs". This modal is `fixed inset-0 z-50`, so leaving it open buries that
         * banner under an overlay nothing can be clicked through — the person was left
         * with a Save that appeared to do nothing. Stepping aside loses no text.
         */
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
    } finally {
      setSaving(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-5 w-5 text-green-500 shrink-0" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('prayer.markAnswered.title')}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-2">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          {t('prayer.markAnswered.subtitle')}
        </p>

        <TextareaAutosize
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          placeholder={t('prayer.markAnswered.placeholder') as string}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 resize-none text-sm"
          minRows={3}
          autoFocus
        />

        {error && <p className="mt-2 text-sm text-red-500" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={() => handleSubmit(undefined)}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
          >
            {t('prayer.markAnswered.skip')}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(answerText)}
            disabled={saving || !answerText.trim()}
            className="px-4 py-2 text-sm bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {saving ? '...' : t('prayer.markAnswered.submit')}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
