'use client';

import { CheckCircleIcon } from '@heroicons/react/24/outline';
import React, { useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import FormDialog from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { announceIfPersisted, awaitWriteOperation, type WriteOperation } from '@/utils/recoverableWrite';
import { EMERALD_ACTION } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

interface Props {
  onClose: () => void;
  onSubmit: (answerText?: string) => WriteOperation;
}

export default function MarkAnsweredModal({ onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [answerText, setAnswerText] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const handleSubmit = async (text?: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const acceptance = await awaitWriteOperation(
        onSubmit(text?.trim() || undefined),
        // The hook reports capture failure; the engine owns later refusal.
        () => undefined
      );
      if (acceptance) announceIfPersisted(acceptance, () => toast.success(t('prayer.toast.statusChanged')));
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
      // The hook reports capture failures once. Until capture succeeds, this
      // editor retains the person's exact words for a deliberate retry.
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return (
    <FormDialog title={<span className="flex items-center gap-2"><CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500" />{t('prayer.markAnswered.title')}</span>}
      eyebrow={t('navigation.prayer')} description={t('prayer.markAnswered.subtitle')} tone="emerald" size="compact" onClose={() => { if (!savingRef.current) onClose(); }} closeDisabled={saving} dismissOnBackdrop>
      <div className="mt-6 space-y-5">
        <TextareaAutosize disabled={saving} value={answerText} onChange={event => setAnswerText(event.target.value)}
          placeholder={t('prayer.markAnswered.placeholder')} aria-label={t('prayer.markAnswered.placeholder')}
          className={FORM_INPUT_CLASS} minRows={3} autoFocus />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => handleSubmit(undefined)} disabled={saving}
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            {t('prayer.markAnswered.skip')}
          </button>
          <button type="button" onClick={() => handleSubmit(answerText)} disabled={saving || !answerText.trim()}
            className={`${EMERALD_ACTION} rounded-xl px-5 py-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60`}>
            {saving ? '...' : t('prayer.markAnswered.submit')}
          </button>
        </div>
      </div>
    </FormDialog>
  );
}
