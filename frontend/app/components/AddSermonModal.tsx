"use client";

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { useSeries } from '@/hooks/useSeries';
import { DashboardCreateSermonInput } from '@/models/dashboardOptimistic';
import { Sermon, Church } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { PlusIcon } from "@components/Icons";
import { auth } from '@services/firebaseAuth.service';
import { addPreachDate } from '@services/preachDates.service';
import { createSermon } from '@services/sermon.service';

interface AddSermonModalProps {
  onNewSermonCreated?: (newSermon: Sermon) => void;
  onCancel?: () => void;
  preSelectedSeriesId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  showTriggerButton?: boolean;
  allowPlannedDate?: boolean;
  onCreateRequest?: (input: DashboardCreateSermonInput) => Promise<void>;
}

const NEW_SERMON_KEY = 'addSermon.newSermon';

export default function AddSermonModal({
  onNewSermonCreated,
  onCancel,
  preSelectedSeriesId,
  isOpen,
  onClose,
  showTriggerButton = true,
  allowPlannedDate = false,
  onCreateRequest
}: AddSermonModalProps) {
  // showTriggerButton is used to conditionally render the trigger button
  const { t } = useTranslation();
  const { user } = useAuth();
  const { series } = useSeries(user?.uid || null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const handleClose = onClose || (() => setInternalOpen(false));
  const [title, setTitle] = useState('');
  const [verse, setVerse] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(preSelectedSeriesId || '');
  const [plannedDate, setPlannedDate] = useState('');

  const getUnspecifiedChurch = (): Church => ({
    id: 'church-unspecified',
    name: t('calendar.unspecifiedChurch', { defaultValue: 'Church not specified' }),
    city: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (onCreateRequest) {
      try {
        await onCreateRequest({
          title,
          verse,
          seriesId: selectedSeriesId || undefined,
          plannedDate: allowPlannedDate ? plannedDate || undefined : undefined,
          unspecifiedChurchName: getUnspecifiedChurch().name,
        });
      } catch (error) {
        console.error('Error creating sermon (optimistic request):', error);
      }

      setTitle('');
      setVerse('');
      setSelectedSeriesId('');
      setPlannedDate('');
      handleClose();
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      console.error("User is not authenticated");
      return;
    }
    const currentDate = new Date().toISOString();
    console.log('Creating sermon with date:', currentDate);
    const newSermon: Sermon = {
      id: '',
      title,
      verse,
      date: currentDate,
      thoughts: [],
      userId: user.uid,
      seriesId: selectedSeriesId || undefined
    };

    try {
      const createdSermon = await createSermon(newSermon as Omit<Sermon, 'id'>);
      console.log('Created sermon returned from server:', createdSermon);
      let sermonForCallback = createdSermon;

      if (allowPlannedDate && plannedDate) {
        try {
          const createdPlannedDate = await addPreachDate(createdSermon.id, {
            date: plannedDate,
            status: 'planned',
            church: getUnspecifiedChurch()
          });

          sermonForCallback = {
            ...createdSermon,
            preachDates: [...(createdSermon.preachDates || []), createdPlannedDate]
          };
        } catch (plannedDateError) {
          console.error('Error creating planned preach date for new sermon:', plannedDateError);
        }
      }

      // Note: Series assignment is now handled by the parent component
      // to avoid duplicate operations in the sequential modal flow

      if (onNewSermonCreated) {
        onNewSermonCreated(sermonForCallback);
      }
      // Note: router.refresh() moved to parent component to avoid modal flickering
    } catch (error) {
      console.error('Error creating sermon:', error);
    }

    setTitle('');
    setVerse('');
    setSelectedSeriesId('');
    setPlannedDate('');
    handleClose();

  };

  const modalContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[110] p-4" onClick={handleClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold mb-6">{t(NEW_SERMON_KEY)}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.titleLabel')}
            </label>
            <TextareaAutosize
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('addSermon.titlePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none"
              minRows={1}
              maxRows={6}
              required
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('addSermon.titleExample')}
            </p>
          </div>
          <div className="mb-6 flex-grow overflow-auto">
            <label htmlFor="verse" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.verseLabel')}
            </label>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 350px)' }}>
              <TextareaAutosize
                id="verse"
                value={verse}
                onChange={e => setVerse(e.target.value)}
                placeholder={t('addSermon.versePlaceholder')}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none"
                minRows={3}
                maxRows={16}
                required
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('addSermon.verseExample')}
            </p>
          </div>
          <div className="mb-6">
            <label htmlFor="series" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.seriesLabel')}
            </label>
            <select
              id="series"
              value={selectedSeriesId}
              onChange={(e) => setSelectedSeriesId(e.target.value)}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white"
            >
              <option value="">{t('addSermon.noSeriesOption')}</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.theme}
                </option>
              ))}
            </select>
          </div>
          {allowPlannedDate && (
            <div className="mb-6">
              <label htmlFor="plannedDate" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('addSermon.plannedDateLabel', { defaultValue: 'Planned preaching date (optional)' })}
              </label>
              <input
                id="plannedDate"
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('addSermon.plannedDateHint', { defaultValue: 'You can set church details later in Calendar.' })}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 mt-auto">
            <button
              type="button"
              onClick={() => {
                if (onCancel) {
                  onCancel(); // Signal cancellation to parent
                } else {
                  handleClose(); // Default close behavior
                }
              }}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500"
            >
              {t('addSermon.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('addSermon.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {showTriggerButton && (
        <button
          onClick={() => setInternalOpen(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
          aria-label={t(NEW_SERMON_KEY)}
        >
          <PlusIcon className="w-5 h-5" />
          <span className="hidden sm:inline">{t(NEW_SERMON_KEY)}</span>
        </button>
      )}

      {open && createPortal(modalContent, document.body)}
    </>
  );
}
