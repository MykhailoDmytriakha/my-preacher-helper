'use client';

import React, { useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { useTextDictation } from '@/hooks/useTextDictation';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { awaitWriteOperation, type WriteOperation } from '@/utils/recoverableWrite';
import { FocusRecorderButton } from '@components/FocusRecorderButton';
import { useTranslation } from '@locales/useTranslation';

interface Props {
  prayerId?: string;
  onClose: () => void;
  onSubmit: (text: string) => WriteOperation;
}

export default function AddUpdateModal({ prayerId, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<FailureWords | null>(null);

  const dictation = useTextDictation({
    recordingContext: prayerId ? { context: 'prayer', contextId: prayerId } : undefined,
    onStart: () => setError(null),
    onText: dictatedText => setText(previous => {
      const prefix = previous.replace(/\s+$/, '');
      return `${prefix}${prefix ? '\n\n' : ''}${dictatedText}`;
    }),
    onEmpty: () => setError({ key: 'prayer.update.dictationEmpty' }),
    fallbackErrorKey: 'prayer.update.dictationError',
  });
  const transcriptionUnavailableLabel = dictation.blockedLabelKey ? t(dictation.blockedLabelKey) : undefined;
  const isBusy = saving || dictation.isProcessing || dictation.isRecording;
  const guardedClose = () => {
    if (isBusy) return;
    void askBeforeDiscard(text.length > 0 || Boolean(dictation.error), onClose);
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current || isBusy || dictation.error || !text.trim()) return;
    savingRef.current = true;
    setError(null);
    setSaving(true);
    try {
      // The hook reports capture failure; the engine owns the captured update afterwards.
      const submission = onSubmit(text.trim());
      await awaitWriteOperation(submission, () => undefined);
      if ('persistence' in submission) void submission.persistence.then(() => dictation.accept()).catch(() => undefined);
      else void Promise.resolve(dictation.accept()).catch(() => undefined);
      onClose();
    } catch {
      // The hook reports capture failures once. Until capture succeeds, this
      // editor retains the person's exact words for a deliberate retry.
      setError(null);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return (
    <>
    <FormDialog title={t('prayer.update.title')} eyebrow={t('navigation.prayer')} tone="rose" size="compact" onClose={guardedClose} closeDisabled={isBusy} dismissOnBackdrop showCloseButton onSubmit={handleSubmit}
      footer={
        <FormActions onCancel={guardedClose} cancelLabel={t('prayer.update.cancel')} submitLabel={t('prayer.update.submit')}
          saving={saving} savingLabel={t('prayer.update.saving')} submitDisabled={dictation.isProcessing || dictation.isRecording || Boolean(dictation.error) || !text.trim()}
          cancelDisabled={isBusy} tone="rose" />
      }>
      <div className="space-y-4">
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('prayer.update.dictate')}</span>
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center" title={transcriptionUnavailableLabel}>
            <FocusRecorderButton key={dictation.recordingKey} size="small" onRecordingComplete={dictation.complete} isProcessing={dictation.isProcessing} onRecordingStateChange={dictation.setIsRecording}
              disabled={saving || dictation.transcriptionBlocked} title={transcriptionUnavailableLabel}
              transcriptionError={dictation.error} onRetry={dictation.retry} retryCount={dictation.retryCount}
              maxRetries={dictation.maxRetries} onClearError={dictation.clear} onDiscardRecording={dictation.discard}
              onError={words => { setError(words); dictation.stopProcessing(); }} />
          </div>
        </div>
        {dictation.recordingContext && <RecordingDraftBanner context="prayer" contextId={dictation.recordingContext.contextId}
          onResend={(_blob, draft) => dictation.recover(draft)} excludeDraftIds={dictation.appliedDraftIds}
          isProcessing={isBusy} resendDisabled={dictation.transcriptionBlocked} />}
        <TextareaAutosize value={text} onChange={event => setText(event.target.value)}
          disabled={saving} placeholder={t('prayer.update.placeholder')} aria-label={t('prayer.update.placeholder')}
          className={FORM_INPUT_CLASS} minRows={3} autoFocus />
        {error && <p className="text-sm text-red-500" role="alert">{sayFailure(error, t)}</p>}
      </div>
    </FormDialog>
    {discardDialog}
    </>
  );
}
