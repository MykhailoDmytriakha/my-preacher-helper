"use client";

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useScrollLock } from '@/hooks/useScrollLock';
import { useTextDictation } from '@/hooks/useTextDictation';
import { SermonOutline } from '@/models/models';
import { useConnection } from '@/providers/ConnectionProvider';
import {
  awaitAcceptance,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { normalizeStructureTag } from "@utils/tagUtils";

import { ThoughtOutlineField } from './thought/ThoughtOutlineField';
import { ThoughtTagsField } from './thought/ThoughtTagsField';
import { ThoughtTextHeader } from './thought/ThoughtTextHeader';
import FormDialog, { FormActions } from './ui/FormDialog';
import { RichMarkdownEditor } from './ui/RichMarkdownEditor';

import "@locales/i18n";

export interface EditThoughtDraft {
  text: string;
  tags: string[];
  outlinePointId?: string | null;
  subPointId?: string | null;
}

interface EditThoughtModalProps {
  initialText: string;
  initialTags: string[];
  initialSermonPointId?: string;
  initialSubPointId?: string | null;
  allowedTags: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: SermonOutline;
  containerSection?: string;
  onSave: (
    updatedText: string,
    updatedTags: string[],
    outlinePointId?: string | null,
    subPointId?: string | null
  ) => WriteSubmission;
  onSubmissionRejected?: (draft: EditThoughtDraft) => void;
  onClose: () => void;
  allowOffline?: boolean;
}

const areStringArraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export default function EditThoughtModal({
  initialText,
  initialTags,
  initialSermonPointId,
  initialSubPointId,
  allowedTags,
  sermonOutline,
  containerSection,
  onSave,
  onSubmissionRejected,
  onClose,
  allowOffline = false,
}: EditThoughtModalProps) {
  const { isOnline, isMagicAvailable } = useConnection();
  const { t } = useTranslation();
  const isReadOnly = !isOnline && !allowOffline;
  const [text, setText] = useState(initialText);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [selectedSermonPointId, setSelectedSermonPointId] = useState<string | null | undefined>(initialSermonPointId);
  const [selectedSubPointId, setSelectedSubPointId] = useState<string | null | undefined>(initialSubPointId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dictation = useTextDictation({
    onText: dictatedText => setText(previous => `${previous}${previous ? '\n\n' : ''}${dictatedText}`),
    onEmpty: () => toast.error(t('errors.audioProcessing')),
    onError: message => toast.error(message),
  });

  useScrollLock(true);

  const isChanged =
    text !== initialText ||
    !areStringArraysEqual(tags, initialTags) ||
    selectedSermonPointId !== initialSermonPointId ||
    (selectedSubPointId ?? null) !== (initialSubPointId ?? null);
  const getSaveErrorMessage = (error: unknown) =>
    t(writeFailureTranslationKey(error, 'writeRecovery.thoughtEditFailed'));

  const handleAddTag = (tag: string) => {
    if (isReadOnly) return;
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
      setSaveError('');
    }
  };

  const handleRemoveTag = (index: number) => {
    if (isReadOnly) return;
    setTags(tags.filter((_, i) => i !== index));
    setSaveError('');
  };

  const handleSave = async () => {
    if (isReadOnly || isSubmitting || !isChanged) return;
    const submittedDraft: EditThoughtDraft = {
      text,
      tags: [...tags],
      outlinePointId: selectedSermonPointId,
      subPointId: selectedSubPointId ?? null,
    };

    setIsSubmitting(true);
    setSaveError('');
    try {
      const submission = onSave(text, tags, selectedSermonPointId, selectedSubPointId ?? null);

      await awaitAcceptance(submission, (error) => {
        /**
         * ONE REFUSAL, ONE VOICE. A late rejection lands when this editor is already
         * closed, so its own message would be invisible — which is why a toast was
         * added here. But the owner of a closed editor ALSO reports (it restores the
         * draft, or shows the recovery message when the page itself is gone), and the
         * person then heard the same refusal twice in two different wordings.
         *
         * So this reporter is scoped to what it can actually show: the inline error
         * while the editor is on screen. Anything after that belongs to
         * `onSubmissionRejected`, whose owner knows where the person now is.
         */
        setSaveError(getSaveErrorMessage(error));
        onSubmissionRejected?.(submittedDraft);
      });

      onClose();
    } catch (error) {
      console.error("Error saving thought:", error);
      setSaveError(getSaveErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableTags = allowedTags.filter(allowedTag =>
    !tags.some(selectedTag => {
      if (allowedTag.name === selectedTag) return true;
      const normAllowed = normalizeStructureTag(allowedTag.name);
      const normSelected = normalizeStructureTag(selectedTag);
      return normAllowed !== null && normAllowed === normSelected;
    })
  );

  return (
    <FormDialog title={t('editThought.editTitle')} eyebrow={t('thought.editorLabel')} onClose={onClose} dismissOnBackdrop>
      <form onSubmit={event => { event.preventDefault(); void handleSave(); }} className="space-y-5 pt-5">
        {sermonOutline && <ThoughtOutlineField sermonOutline={sermonOutline} section={containerSection}
          outlinePointId={selectedSermonPointId} subPointId={selectedSubPointId} disabled={isReadOnly}
          onSelect={(pointId, subId) => { setSelectedSermonPointId(pointId); setSelectedSubPointId(subId); setSaveError(''); }} />}
        <ThoughtTagsField tags={tags} allowedTags={allowedTags} availableTags={availableTags}
          onRemoveTag={handleRemoveTag} onAddTag={handleAddTag} disabled={isReadOnly} />
        <div className="space-y-3">
          <ThoughtTextHeader dictation={dictation} available={isMagicAvailable} saving={isSubmitting} readOnly={isReadOnly} />
          {isReadOnly ? <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-700/50">
            <pre className="whitespace-pre-wrap font-sans text-gray-700 dark:text-gray-300">{text}</pre>
          </div> : <RichMarkdownEditor value={text} onChange={value => { setText(value); setSaveError(''); }} placeholder={t('manualThought.placeholder')} />}
        </div>
        {saveError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <FormActions onCancel={onClose} cancelLabel={t('buttons.cancel')} submitLabel={t('buttons.save')}
          savingLabel={t('buttons.saving')} saving={isSubmitting} cancelDisabled={isSubmitting} submitDisabled={!isChanged || isReadOnly} />
      </form>
    </FormDialog>
  );
}
