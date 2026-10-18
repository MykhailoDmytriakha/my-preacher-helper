'use client';

import React, { useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { PrayerRequest } from '@/models/models';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  announceIfPersisted,
  awaitWriteOperation,
  type WriteOperation,
} from '@/utils/recoverableWrite';
import { useTranslation } from '@locales/useTranslation';

export type PrayerFormPayload = Pick<PrayerRequest, 'title'> & Partial<Pick<PrayerRequest, 'description' | 'tags'>>;

interface Props {
  onClose: () => void;
  onSubmit: (payload: PrayerFormPayload) => WriteOperation;
  initialValues?: Partial<PrayerRequest>;
  mode?: 'create' | 'edit';
  closeOnSuccess?: boolean;
}

export default function CreatePrayerModal({ onClose, onSubmit, initialValues, mode = 'create', closeOnSuccess = true }: Props) {
  const { t } = useTranslation();
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const [startingValues] = useState(() => ({
    title: initialValues?.title ?? '',
    description: initialValues?.description ?? '',
    tagsInput: (initialValues?.tags ?? []).join(', '),
  }));
  const [title, setTitle] = useState(startingValues.title);
  const [description, setDescription] = useState(startingValues.description);
  const [tagsInput, setTagsInput] = useState(startingValues.tagsInput);
  const [saving, setSaving] = useState(false);

  const isChanged = title !== startingValues.title || description !== startingValues.description || tagsInput !== startingValues.tagsInput;
  const guardedClose = () => {
    if (saving) return;
    void askBeforeDiscard(isChanged, onClose);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const acceptance = await awaitWriteOperation(
        onSubmit({
          title: title.trim(),
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        }),
        // Engine creates await local capture; legacy edit submissions retain their late reporter.
        () => undefined
      );
      // A server-persisted edit retains the pre-contract confirmation. Creates are
      // queue-owned, so they intentionally stay silent even when accepted.
      if (isEdit && acceptance) announceIfPersisted(acceptance, () => toast.success(t('prayer.toast.updated')));
      if (closeOnSuccess) {
        onClose();
        setSaving(false);
      }
    } catch (err) {
      // The page owns recovery; step aside only when it must show the conflict choices.
      if (isStaleWriteError(err)) {
        onClose();
        return;
      }
      setSaving(false);
    }
  };

  const isEdit = mode === 'edit';
  const i18nPrefix = isEdit ? 'prayer.edit' : 'prayer.create';

  if (typeof document === 'undefined') return null;

  return (
    <>
    <FormDialog title={t(`${i18nPrefix}.title`)} eyebrow={t('navigation.prayer')} tone="rose" size="compact"
      onClose={guardedClose} closeDisabled={saving} dismissOnBackdrop showCloseButton onSubmit={handleSubmit}
      footer={
        <FormActions onCancel={guardedClose} cancelLabel={t(`${i18nPrefix}.cancel`)}
          submitLabel={t(`${i18nPrefix}.submit`)} saving={saving} savingLabel={t('buttons.saving')}
          submitDisabled={!title.trim()} cancelDisabled={saving} tone="rose" />
      }>
      <div className="space-y-5">
        <FormField label={t('prayer.create.titleLabel')} required>
          <TextareaAutosize value={title} onChange={event => setTitle(event.target.value)}
            placeholder={t('prayer.create.titlePlaceholder')} className={FORM_INPUT_CLASS}
            minRows={2} disabled={saving} required autoFocus />
        </FormField>
        <FormField label={t('prayer.create.descriptionLabel')}>
          <TextareaAutosize value={description} onChange={event => setDescription(event.target.value)}
            placeholder={t('prayer.create.descriptionPlaceholder')} className={FORM_INPUT_CLASS}
            minRows={2} disabled={saving} />
        </FormField>
        <FormField label={t('prayer.create.tagsLabel')}>
          <input type="text" value={tagsInput} onChange={event => setTagsInput(event.target.value)}
            placeholder={t('prayer.create.tagsPlaceholder')} className={FORM_INPUT_CLASS} disabled={saving} />
        </FormField>
      </div>
    </FormDialog>
    {discardDialog}
    </>
  );
}
