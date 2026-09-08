"use client";

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useScrollLock } from '@/hooks/useScrollLock';
import { useTextDictation } from '@/hooks/useTextDictation';
import { Thought, SermonOutline } from '@/models/models';
import { useConnection } from '@/providers/ConnectionProvider';
import {
  announceIfPersisted,
  awaitAcceptance,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';

import { ThoughtTagsField } from './thought/ThoughtTagsField';
import { ThoughtTextHeader } from './thought/ThoughtTextHeader';
import FormDialog, { FormActions } from './ui/FormDialog';
import { RichMarkdownEditor } from './ui/RichMarkdownEditor';
import '@locales/i18n';

interface CreateThoughtModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateThought: (thought: Omit<Thought, 'id'>) => WriteSubmission;
  onSubmissionRejected?: () => void;
  allowedTags?: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: SermonOutline;
  disabled?: boolean;
  titleKey?: string;
  textLabelKey?: string;
  placeholderKey?: string;
  successMessageKey?: string;
  showDictation?: boolean;
  showTags?: boolean;
  showOutlineSelector?: boolean;
}

export default function CreateThoughtModal({
  isOpen,
  onClose,
  onCreateThought,
  onSubmissionRejected,
  allowedTags = [],
  sermonOutline,
  disabled = false,
  titleKey = 'createThought.title',
  textLabelKey = 'editThought.textLabel',
  placeholderKey = 'manualThought.placeholder',
  successMessageKey = 'manualThought.addedSuccess',
  showDictation = true,
  showTags = true,
  showOutlineSelector = true,
}: CreateThoughtModalProps) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedSermonPointId, setSelectedSermonPointId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const { t } = useTranslation();
  const { isOnline, isMagicAvailable } = useConnection();

  const dictation = useTextDictation({
    onText: dictatedText => setText(previous => `${previous}${previous ? '\n\n' : ''}${dictatedText}`),
    onEmpty: () => toast.error(t('errors.audioProcessing')),
    onError: message => toast.error(message),
  });
  useScrollLock(isOpen);

  const isDirty = text.trim().length > 0;

  const resetAndClose = () => {
    setText('');
    setTags([]);
    setSelectedSermonPointId(undefined);
    onClose();
  };

  const handleClose = () => {
    if (isDirty && !window.confirm(t('createThought.dirtyGuard'))) return;
    resetAndClose();
  };

  const reportCreateFailure = (error: unknown) => {
    console.error('Error creating thought:', error);
    toast.error(t(writeFailureTranslationKey(error, 'errors.addThoughtError')));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || submissionInFlightRef.current) return;
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const submittedDraft = {
      text,
      tags: [...tags],
      selectedSermonPointId,
    };

    const newThought: Omit<Thought, 'id'> = {
      text: trimmedText,
      tags,
      date: new Date().toISOString(),
      outlinePointId: selectedSermonPointId,
    };

    try {
      submissionInFlightRef.current = true;
      setIsSubmitting(true);
      const submission = onCreateThought(newThought);

      const acceptance = await awaitAcceptance(submission, (error) => {
        /**
         * ONE REFUSAL, ONE VOICE — the same rule the edit modal follows.
         *
         * A LATE refusal arrives when this modal has already closed, so its own toast
         * was invisible half the time and duplicated the owner's message the other
         * half: the page reports the refusal with the verbatim text, and the person
         * heard the same thing twice in two different wordings.
         *
         * Restoring the fields is still this component's job — they are its state —
         * but announcing belongs to whoever knows where the person is now.
         */
        console.error('Error creating thought:', error);
        setText(submittedDraft.text);
        setTags(submittedDraft.tags);
        setSelectedSermonPointId(submittedDraft.selectedSermonPointId);
        onSubmissionRejected?.();
      });

      announceIfPersisted(acceptance, () => toast.success(t(successMessageKey)));
      resetAndClose();
    } catch (error) {
      reportCreateFailure(error);
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) setTags([...tags, tag]);
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const availableTags = allowedTags.filter((tag) => !tags.includes(tag.name));

  const allSermonPoints: { id: string; text: string; section: string }[] = [];
  if (sermonOutline) {
    (['introduction', 'main', 'conclusion'] as const).forEach((section) => {
      const points = sermonOutline[section];
      if (Array.isArray(points)) {
        const label = t(section === 'main' ? 'outline.mainPoints' : `outline.${section}`);
        points.forEach((p) => allSermonPoints.push({ id: p.id, text: p.text, section: label }));
      }
    });
  }
  const selectedPointInfo = allSermonPoints.find((p) => p.id === selectedSermonPointId);

  if (!isOpen) return null;

  return (
    <FormDialog title={t(titleKey)} eyebrow={t('thought.editorLabel')} onClose={handleClose} dismissOnBackdrop>
      <div className="py-3">
        <ThoughtTextHeader dictation={dictation} available={isMagicAvailable} saving={isSubmitting} showDictation={showDictation} labelKey={textLabelKey} />
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        {!isOnline && (
          <div className="p-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-400 rounded-md flex items-start gap-2">
            <svg className="w-5 h-5 text-amber-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t('manualThought.offlineWarning')}
            </p>
          </div>
        )}

        <RichMarkdownEditor
          value={text}
          onChange={setText}
          placeholder={t(placeholderKey)}
        />

        {showOutlineSelector && sermonOutline && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('editThought.outlinePointLabel')}
            </label>
            <select
              value={selectedSermonPointId || ''}
              onChange={(e) => setSelectedSermonPointId(e.target.value || undefined)}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:text-gray-200 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              disabled={isSubmitting}
            >
              <option value="">{t('editThought.noSermonPoint')}</option>
              {(['introduction', 'main', 'conclusion'] as const).map((section) => {
                const points = sermonOutline[section];
                if (!Array.isArray(points) || points.length === 0) return null;
                const label = t(section === 'main' ? 'outline.mainPoints' : `outline.${section}`);
                return (
                  <optgroup key={section} label={label}>
                    {points.map((p) => (
                      <option key={p.id} value={p.id}>{p.text}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {selectedPointInfo && (
              <p className="mt-1 text-sm text-gray-500">
                {t('editThought.selectedSermonPoint', { section: selectedPointInfo.section })}
              </p>
            )}
          </div>
        )}

        {showTags && <ThoughtTagsField tags={tags} allowedTags={allowedTags} availableTags={availableTags} onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} />}

        <FormActions onCancel={handleClose} cancelLabel={t('buttons.cancel')} submitLabel={t('buttons.save')}
          savingLabel={t('buttons.saving')} saving={isSubmitting} cancelDisabled={isSubmitting} submitDisabled={!text.trim()} />
      </form>
    </FormDialog>
  );
}
