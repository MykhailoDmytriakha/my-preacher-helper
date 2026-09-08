'use client';

import { CheckCircleIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import FormDialog from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
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

  const handleSubmit = async (text?: string) => {
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
      } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return (
    <FormDialog title={<span className="flex items-center gap-2"><CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500" />{t('prayer.markAnswered.title')}</span>}
      eyebrow={t('navigation.prayer')} description={t('prayer.markAnswered.subtitle')} tone="emerald" size="compact" onClose={onClose} dismissOnBackdrop>
      <div className="mt-6 space-y-5">
        <TextareaAutosize value={answerText} onChange={event => setAnswerText(event.target.value)}
          placeholder={t('prayer.markAnswered.placeholder')} aria-label={t('prayer.markAnswered.placeholder')}
          className={FORM_INPUT_CLASS} minRows={3} autoFocus />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => handleSubmit(undefined)} disabled={saving}
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
            {t('prayer.markAnswered.skip')}
          </button>
          <button type="button" onClick={() => handleSubmit(answerText)} disabled={saving || !answerText.trim()}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? '...' : t('prayer.markAnswered.submit')}
          </button>
        </div>
      </div>
    </FormDialog>
  );
}
