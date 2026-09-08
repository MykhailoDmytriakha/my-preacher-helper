'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
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

  if (typeof document === 'undefined') return null;

  return (
    <FormDialog title={t('prayer.update.title')} eyebrow={t('navigation.prayer')} tone="rose" size="compact" onClose={onClose} dismissOnBackdrop>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('prayer.update.dictate')}</span>
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center" title={transcriptionUnavailableLabel}>
            <FocusRecorderButton size="small" onRecordingComplete={dictation.complete} isProcessing={dictation.isProcessing}
              disabled={saving || dictation.transcriptionBlocked} title={transcriptionUnavailableLabel}
              transcriptionError={dictation.error} onRetry={dictation.retry} retryCount={dictation.retryCount}
              maxRetries={dictation.maxRetries} onClearError={dictation.clear}
              onError={message => { setError(message); dictation.stopProcessing(); }} />
          </div>
        </div>
        <TextareaAutosize value={text} onChange={event => setText(event.target.value)}
          placeholder={t('prayer.update.placeholder')} aria-label={t('prayer.update.placeholder')}
          className={FORM_INPUT_CLASS} minRows={3} autoFocus />
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <FormActions onCancel={onClose} cancelLabel={t('prayer.update.cancel')} submitLabel={t('prayer.update.submit')}
          saving={saving} savingLabel={t('prayer.update.saving')} submitDisabled={dictation.isProcessing || !text.trim()}
          cancelDisabled={saving || dictation.isProcessing} tone="rose" />
      </form>
    </FormDialog>
  );
}
