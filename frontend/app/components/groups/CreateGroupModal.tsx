"use client";

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import DatePickerField from '@/components/ui/DatePickerField';
import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { Group } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { createFlowItem, createTemplate } from '@/utils/groupFlow';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';

interface CreateGroupModalProps {
  onClose: () => void;
  /**
   * CANONICAL: a write prop returns a `WriteSubmission`, never `Promise<void>`.
   * From here `Promise<void>` cannot tell "the write started" from "the write was
   * accepted", and that indistinguishability is the bug this contract removes.
   * See frontend/docs/recoverable-writes.md.
   */
  onCreate: (group: Omit<Group, 'id'>) => WriteSubmission;
}

const generateMeetingDateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const timeSeed =
    typeof Date.now === 'function' && Number.isFinite(Date.now())
      ? Date.now()
      : Number.isFinite(new Date().getTime())
        ? new Date().getTime()
        : 0;

  return `meeting-${timeSeed}-${Math.random().toString(36).slice(2, 9)}`;
};

export default function CreateGroupModal({ onClose, onCreate }: CreateGroupModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [firstMeetingDate, setFirstMeetingDate] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      setSaving(true);
      const now = new Date().toISOString();
      const prayerTemplate = createTemplate('prayer', {
        title: t('workspaces.groups.defaults.prayer', { defaultValue: 'Prayer' }),
        status: 'empty',
      });
      const topicTemplate = createTemplate('topic', {
        title: t('workspaces.groups.defaults.mainTopic', { defaultValue: 'Main topic' }),
        status: 'draft',
      });
      const scriptureTemplate = createTemplate('scripture', {
        title: t('workspaces.groups.defaults.scripture', { defaultValue: 'Scripture references' }),
        status: 'empty',
      });
      const meetingDates = firstMeetingDate
        ? [
          {
            id: generateMeetingDateId(),
            date: firstMeetingDate,
            createdAt: now,
          },
        ]
        : [];

      // Wait for ACCEPTANCE, not for the call to return. A refusal that arrives
      // before anything owns this write rejects here, and the catch below keeps the
      // form open with every field intact — which is the whole contract.
      await awaitAcceptance(
        onCreate({
        userId: user?.uid || '',
        title: title.trim(),
        description: description.trim() || undefined,
        status: 'draft',
        templates: [prayerTemplate, topicTemplate, scriptureTemplate],
        flow: [
          createFlowItem(prayerTemplate.id, 1),
          createFlowItem(topicTemplate.id, 2),
          createFlowItem(scriptureTemplate.id, 3),
        ],
        meetingDates,
        createdAt: now,
        updatedAt: now,
        seriesId: null,
        seriesPosition: null,
        }),
        // useGroups' create recovery descriptor reports a late refusal with this draft
        // while the groups screen is mounted; after that it is the tracked navigation debt.
        () => undefined
      );

      onClose();
    } catch (error) {
      /**
       * NO message here — this is the canonical example, and it must show the rule
       * rather than break it. `useGroups` declares the recovery descriptor for this
       * write: it carries the title and description, offers "copy my text", and keeps
       * reporting after this modal closes. The modal's duty on a refusal is to stay
       * open with everything the person typed still in it.
       */
      console.error('Failed to create group:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog title={t('workspaces.groups.actions.newGroup', { defaultValue: 'New group' })}
      eyebrow={t('navigation.groups', { defaultValue: 'Groups' })} tone="emerald" onClose={onClose}>
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <label className="space-y-2 block">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t('workspaces.groups.form.title', { defaultValue: 'Title' })} *
              </span>
              <TextareaAutosize
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('workspaces.groups.form.titlePlaceholder', {
                  defaultValue: 'Family group - Week 1',
                })}
                className={FORM_INPUT_CLASS}
                minRows={1}
                maxRows={3}
                required
              />
            </label>

            <label className="space-y-2 block">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t('workspaces.groups.form.description', { defaultValue: 'Description' })}
              </span>
              <TextareaAutosize
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('workspaces.groups.form.descriptionPlaceholder', {
                  defaultValue: 'Optional context for this group meeting',
                })}
                className={FORM_INPUT_CLASS}
                minRows={3}
                maxRows={5}
              />
            </label>

            <label className="space-y-2 block">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t('workspaces.groups.meetings.title', { defaultValue: 'Meeting dates' })}{' '}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  ({t('common.optional', { defaultValue: 'optional' })})
                </span>
              </span>
              <DatePickerField
                value={firstMeetingDate}
                onChange={setFirstMeetingDate}
                inputClassName={`${FORM_INPUT_CLASS} pr-12`}
              />
            </label>

            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-100">
              {t('workspaces.groups.form.bootstrapHint', {
                defaultValue: 'A starter flow with Main topic + Scripture will be created automatically. You can also schedule the first meeting now.',
              })}
            </div>

            <FormActions onCancel={onClose} saving={saving} tone="emerald"
              cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
              submitLabel={t('workspaces.groups.actions.create', { defaultValue: 'Create group' })} />
          </form>
    </FormDialog>
  );
}
