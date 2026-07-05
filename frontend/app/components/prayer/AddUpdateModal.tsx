'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { buildTranscriptionErrorMessage, transcribeAudioWithRetry, TranscriptionClientError } from '@/utils/transcriptionRetryClient';
import { FocusRecorderButton } from '@components/FocusRecorderButton';

interface Props {
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

export default function AddUpdateModal({ onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Voice recovery: keep the recording alive so a failed transcription never loses the thought.
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceRetryCount, setVoiceRetryCount] = useState(0);
  const storedVoiceBlobRef = useRef<Blob | null>(null);
  const VOICE_MAX_RETRIES = 3;

  const runVoiceTranscription = async (audioBlob: Blob) => {
    setError(null);
    setVoiceError(null);
    setDictating(true);
    try {
      const result = await transcribeAudioWithRetry(audioBlob, { endpoint: '/api/thoughts/transcribe' });
      const dictatedText = (result.polishedText || result.originalText || '').trim();
      if (!dictatedText) {
        setError(t('prayer.update.dictationEmpty'));
        return;
      }

      setText((previousText) => {
        const trimmedPreviousText = previousText.replace(/\s+$/, '');
        const separator = trimmedPreviousText ? '\n\n' : '';
        return `${trimmedPreviousText}${separator}${dictatedText}`;
      });
      // Success — the thought is now saved as text; drop the in-memory safety copy.
      storedVoiceBlobRef.current = null;
      setVoiceError(null);
      setVoiceRetryCount(0);
    } catch (err) {
      // Never lose the thought: keep the recording for the in-session recovery panel.
      storedVoiceBlobRef.current = audioBlob;
      const message = err instanceof TranscriptionClientError
        ? buildTranscriptionErrorMessage(err, t)
        : (err instanceof Error ? err.message : t('prayer.update.dictationError'));
      setVoiceError(message);
    } finally {
      setDictating(false);
    }
  };

  const handleDictationComplete = (audioBlob: Blob) => {
    setVoiceRetryCount(0);
    void runVoiceTranscription(audioBlob);
  };

  const handleRetryVoice = () => {
    const blob = storedVoiceBlobRef.current;
    if (!blob) return;
    setVoiceRetryCount((count) => count + 1);
    void runVoiceTranscription(blob);
  };

  const handleClearVoiceError = () => {
    storedVoiceBlobRef.current = null;
    setVoiceError(null);
    setVoiceRetryCount(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await onSubmit(text.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
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
              <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center">
                <FocusRecorderButton
                  size="small"
                  onRecordingComplete={handleDictationComplete}
                  isProcessing={dictating}
                  disabled={saving}
                  transcriptionError={voiceError}
                  onRetry={handleRetryVoice}
                  retryCount={voiceRetryCount}
                  maxRetries={VOICE_MAX_RETRIES}
                  onClearError={handleClearVoiceError}
                  onError={(message) => {
                    setError(message);
                    setDictating(false);
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

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || dictating}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              {t('prayer.update.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || dictating || !text.trim()}
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
