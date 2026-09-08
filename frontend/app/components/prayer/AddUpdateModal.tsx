'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { useTextDictation } from '@/hooks/useTextDictation';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { FocusRecorderButton } from '@components/FocusRecorderButton';

interface Props {
  onClose: () => void;
  onSubmit: (text: string, recoveryDraft: string) => WriteSubmission;
}

export default function AddUpdateModal({ onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dictation = useTextDictation({
    onStart: () => setError(null),
    onText: dictatedText => setText(previous => {
      const prefix = previous.replace(/\s+$/, '');
      return `${prefix}${prefix ? '\n\n' : ''}${dictatedText}`;
    }),
    onEmpty: () => setError(t('prayer.update.dictationEmpty')),
    fallbackErrorKey: 'prayer.update.dictationError',
  });
  const transcriptionUnavailableLabel = dictation.transcriptionBlocked ? t('settings.usage.transcriptionUsageExhausted') : undefined;
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    setSaving(true);
    try {
      // usePrayerRequests' add-update recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(onSubmit(text.trim(), text), () => undefined);
      onClose();
    } catch {
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('prayer.update.title')}
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {t('prayer.update.dictate')}
              </span>
              <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center" title={transcriptionUnavailableLabel}>
                <FocusRecorderButton
                  size="small"
                  onRecordingComplete={dictation.complete}
                  isProcessing={dictation.isProcessing}
                  disabled={saving || dictation.transcriptionBlocked}
                  title={transcriptionUnavailableLabel}
                  transcriptionError={dictation.error}
                  onRetry={dictation.retry}
                  retryCount={dictation.retryCount}
                  maxRetries={dictation.maxRetries}
                  onClearError={dictation.clear}
                  onError={(message) => {
                    setError(message);
                    dictation.stopProcessing();
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label={t('buttons.close')}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <TextareaAutosize
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('prayer.update.placeholder') as string}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none text-sm"
            minRows={3}
            autoFocus
          />

          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || dictation.isProcessing}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              {t('prayer.update.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || dictation.isProcessing || !text.trim()}
              className="px-4 py-2 text-sm bg-rose-500 hover:bg-rose-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving ? t('prayer.update.saving') : t('prayer.update.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
