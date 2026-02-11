"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import "@locales/i18n";

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { DashboardEditSermonInput } from '@/models/dashboardOptimistic';
import { Church, PreachDate, Sermon } from '@/models/models';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getNextPlannedDate } from '@/utils/preachDateStatus';
import { addPreachDate, deletePreachDate, updatePreachDate } from '@services/preachDates.service';
import { updateSermon } from '@services/sermon.service';

interface EditSermonModalProps {
  sermon: Sermon;
  onClose: () => void;
  onUpdate: (updatedSermon: Sermon) => void;
  onSaveRequest?: (input: DashboardEditSermonInput) => Promise<void>;
}

export default function EditSermonModal({ sermon, onClose, onUpdate, onSaveRequest }: EditSermonModalProps) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const isReadOnly = !isOnline;
  const resolveInitialPlannedDate = (source: Sermon): string =>
    toDateOnlyKey(getNextPlannedDate(source)?.date) || '';
  const initialPlannedDate = resolveInitialPlannedDate(sermon);
  const [title, setTitle] = useState(sermon.title);
  const [verse, setVerse] = useState(sermon.verse);
  const [plannedDate, setPlannedDate] = useState(initialPlannedDate);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const hasChanges = title !== sermon.title || verse !== sermon.verse || plannedDate !== initialPlannedDate;

  const mergePreachDate = (baseSermon: Sermon, preachDate: PreachDate): Sermon => {
    const preachDates = baseSermon.preachDates || [];
    const existingIndex = preachDates.findIndex((pd) => pd.id === preachDate.id);

    if (existingIndex === -1) {
      return { ...baseSermon, preachDates: [...preachDates, preachDate] };
    }

    const nextPreachDates = [...preachDates];
    nextPreachDates[existingIndex] = preachDate;
    return { ...baseSermon, preachDates: nextPreachDates };
  };

  const getUnspecifiedChurch = (): Church => ({
    id: 'church-unspecified',
    name: t('calendar.unspecifiedChurch', { defaultValue: 'Church not specified' }),
    city: ''
  });

  // При монтировании устанавливаем флаг, чтобы использовать портал
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    setTitle(sermon.title);
    setVerse(sermon.verse);
    setPlannedDate(resolveInitialPlannedDate(sermon));
  }, [sermon]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;

    if (onSaveRequest) {
      setIsSubmitting(true);
      try {
        onClose();
        await onSaveRequest({
          sermon,
          title,
          verse,
          plannedDate,
          initialPlannedDate,
          unspecifiedChurchName: getUnspecifiedChurch().name,
        });
      } catch (error) {
        console.error("Error scheduling optimistic sermon update:", error);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await updateSermon({
        ...sermon,
        title,
        verse
      });

      if (!data) {
        throw new Error('Failed to update sermon');
      }

      let updatedSermon = data;
      const existingPlannedDate = getNextPlannedDate(sermon);

      if (plannedDate !== initialPlannedDate) {
        if (plannedDate) {
          if (existingPlannedDate) {
            const syncedPlannedDate = await updatePreachDate(sermon.id, existingPlannedDate.id, {
              date: plannedDate,
              status: 'planned'
            });
            updatedSermon = mergePreachDate(updatedSermon, syncedPlannedDate);
          } else {
            const createdPlannedDate = await addPreachDate(sermon.id, {
              date: plannedDate,
              status: 'planned',
              church: getUnspecifiedChurch()
            });
            updatedSermon = mergePreachDate(updatedSermon, createdPlannedDate);
          }
        } else if (existingPlannedDate) {
          await deletePreachDate(sermon.id, existingPlannedDate.id);
          updatedSermon = {
            ...updatedSermon,
            preachDates: (updatedSermon.preachDates || []).filter((pd) => pd.id !== existingPlannedDate.id)
          };
        }
      }

      onUpdate(updatedSermon);
      onClose();
    } catch (error) {
      console.error("Error updating sermon:", error);
      alert(t('editSermon.updateError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    // Останавливаем всплытие кликов, чтобы они не доходили до родительских элементов
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden"
      >
        <h2 className="text-2xl font-bold mb-6">{t('editSermon.editSermon')}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('editSermon.titleLabel')}
            </label>
            <TextareaAutosize 
              id="title" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('editSermon.titlePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white"
              minRows={1}
              maxRows={6}
              required
              disabled={isSubmitting || isReadOnly}
            />
          </div>
          <div className="mb-6 flex-grow overflow-auto">
            <label htmlFor="verse" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('editSermon.verseLabel')}
            </label>
            <TextareaAutosize 
              id="verse"
              value={verse}
              onChange={e => setVerse(e.target.value)}
              placeholder={t('editSermon.versePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white"
              minRows={3}
              maxRows={16}
              required
              disabled={isSubmitting || isReadOnly}
            />
          </div>
          <div className="mb-6">
            <label htmlFor="plannedDate" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('editSermon.plannedDateLabel', { defaultValue: 'Planned preaching date (optional)' })}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="plannedDate"
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white"
                disabled={isSubmitting || isReadOnly}
              />
              <button
                type="button"
                onClick={() => setPlannedDate('')}
                disabled={isSubmitting || isReadOnly || !plannedDate}
                className="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('editSermon.clearPlannedDate', { defaultValue: 'Clear' })}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('editSermon.plannedDateHint', { defaultValue: 'Leave empty if you do not want a planned date.' })}
            </p>
          </div>
          <div className="flex justify-end gap-3 mt-auto">
            <button 
              type="button" 
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
            >
              {t('buttons.cancel')}
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting || !hasChanges || isReadOnly}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
            >
              {isSubmitting ? t('buttons.saving') : t('buttons.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (mounted) {
    return createPortal(modalContent, document.body);
  }
  return null;
}
