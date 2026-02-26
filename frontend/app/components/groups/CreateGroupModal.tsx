"use client";

import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { Group } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { createFlowItem, createTemplate } from '@/utils/groupFlow';

interface CreateGroupModalProps {
  onClose: () => void;
  onCreate: (group: Omit<Group, 'id'>) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

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

      await onCreate({
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
      });

      onClose();
    } catch (errorValue) {
      console.error('Failed to create group:', errorValue);
      setError(
        t('workspaces.groups.errors.createFailed', {
          defaultValue: 'Failed to create group. Please try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-600 via-cyan-600 to-blue-600" />
        <div className="p-6 sm:p-7 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-100 dark:ring-emerald-800/60">
                {t('navigation.groups', { defaultValue: 'Groups' })}
              </p>
              <h2 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {t('workspaces.groups.actions.newGroup', { defaultValue: 'New group' })}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

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
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
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
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
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
              <input
                type="date"
                value={firstMeetingDate}
                onChange={(event) => setFirstMeetingDate(event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
              />
            </label>

            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-100">
              {t('workspaces.groups.form.bootstrapHint', {
                defaultValue:
                  'A starter flow with Main topic + Scripture will be created automatically. You can also schedule the first meeting now.',
              })}
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving
                  ? t('common.saving', { defaultValue: 'Saving...' })
                  : t('workspaces.groups.actions.create', { defaultValue: 'Create group' })}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
