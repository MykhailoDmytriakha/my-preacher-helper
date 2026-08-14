"use client";

import { ChevronDown } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { useSeries } from '@/hooks/useSeries';
import { DashboardCreateSermonInput } from '@/models/dashboardOptimistic';
import { Sermon, Church } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { PlusIcon } from "@components/Icons";
import DatePickerField from '@components/ui/DatePickerField';
import { auth } from '@services/firebaseAuth.service';
import { addPreachDate } from '@services/preachDates.service';
import { createSermon } from '@services/sermon.service';

interface AddSermonModalProps {
  onNewSermonCreated?: (newSermon: Sermon) => Promise<void> | void;
  onCancel?: () => void;
  preSelectedSeriesId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  showTriggerButton?: boolean;
  allowPlannedDate?: boolean;
  closeOnSuccess?: boolean;
  onCreateRequest?: (input: DashboardCreateSermonInput) => WriteSubmission;
  /**
   * Raised while this modal is on screen. It covers the page, so whoever renders the
   * sermon rows can stop drawing verdicts nobody can see — the open form says them.
   */
  onOpenChange?: (isOpen: boolean) => void;
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
  closeOnSuccess = true,
  onCreateRequest,
  onOpenChange
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  // What went wrong with the LAST attempt, shown inside the form the person is still
  // looking at. Previously these failures went only to the console.
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const getUnspecifiedChurch = (): Church => ({
    id: 'church-unspecified',
    name: t('calendar.unspecifiedChurch', { defaultValue: 'Church not specified' }),
    city: ''
  });

  const resetForm = () => {
    setTitle('');
    setVerse('');
    setSelectedSeriesId(preSelectedSeriesId || '');
    setPlannedDate('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (onCreateRequest) {
      setSubmitError('');
      setIsSubmitting(true);
      try {
        await awaitAcceptance(onCreateRequest({
          title,
          verse,
          seriesId: selectedSeriesId || undefined,
          plannedDate: allowPlannedDate ? plannedDate || undefined : undefined,
          unspecifiedChurchName: getUnspecifiedChurch().name,
        }), (error) => {
          // A refusal that lands AFTER acceptance: if this form is still on screen it is
          // still the only thing the person can see, so it says so here too. Once it has
          // closed, the row badge is the reporter and this setState is a no-op.
          console.error('Sermon create refused after acceptance:', error);
          setSubmitError(t(writeFailureTranslationKey(error, 'errors.failedToSaveSermon')));
        });
        if (closeOnSuccess) {
          resetForm();
          setIsSubmitting(false);
          handleClose();
        }
      } catch (error) {
        /**
         * THE FORM SPEAKS WHILE IT IS OPEN, and only while it is open. This modal covers
         * the whole screen (`fixed inset-0`), so the row badge that owns this refusal is
         * behind it and cannot be read: staying silent here meant the person pressed
         * Save, kept their text, and was told nothing at all. The badge takes over the
         * moment this closes — one message visible at any time, never two.
         */
        console.error('Error creating sermon (optimistic request):', error);
        setSubmitError(t(writeFailureTranslationKey(error, 'errors.failedToSaveSermon')));
        setIsSubmitting(false);
      }
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      // Silence here meant the person pressed Save, nothing happened, and they pressed
      // it again. Say it, and keep the form so the typed sermon is not lost.
      console.error("User is not authenticated");
      setSubmitError(t('writeRecovery.refused'));
      setIsSubmitting(false);
      return;
    }
    const currentDate = new Date().toISOString();
    const newSermon: Sermon = {
      id: '',
      title,
      verse,
      date: currentDate,
      thoughts: [],
      userId: user.uid,
      seriesId: selectedSeriesId || undefined
    };

    setIsSubmitting(true);
    try {
      const createdSermon = await createSermon(newSermon as Omit<Sermon, 'id'>);
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
        } catch {
          // A planned date is optional, so its failure does not undo the sermon creation.
        }
      }

      // Note: Series assignment is now handled by the parent component
      // to avoid duplicate operations in the sequential modal flow

      if (onNewSermonCreated) {
        await onNewSermonCreated(sermonForCallback);
      }
      // Note: router.refresh() moved to parent component to avoid modal flickering
      if (closeOnSuccess) {
        resetForm();
        setIsSubmitting(false);
        handleClose();
      }
    } catch (error) {
      // The form stays open with everything in it, and now it also SAYS why: logging to
      // a console the person cannot see is the same as saying nothing.
      console.error('Error creating sermon:', error);
      setSubmitError(t(writeFailureTranslationKey(error, 'errors.failedToSaveSermon')));
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[110] p-4"
      onClick={() => {
        if (!isSubmitting) {
          handleClose();
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold mb-6">{t(NEW_SERMON_KEY)}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
          {submitError && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
            >
              {submitError}
            </div>
          )}
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.titleLabel')}
            </label>
            <TextareaAutosize
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('addSermon.titlePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              minRows={1}
              maxRows={6}
              disabled={isSubmitting}
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
                className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                minRows={3}
                maxRows={16}
                disabled={isSubmitting}
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
            <div className="relative mt-1">
              <select
                id="series"
                value={selectedSeriesId}
                onChange={(e) => setSelectedSeriesId(e.target.value)}
                className="block w-full appearance-none border border-gray-300 dark:border-gray-700 rounded-md p-3 pr-12 dark:bg-gray-700 dark:text-white transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                disabled={isSubmitting}
              >
                <option value="">{t('addSermon.noSeriesOption')}</option>
                {series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.theme}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>
          {allowPlannedDate && (
            <div className="mb-6">
              <label htmlFor="plannedDate" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('addSermon.plannedDateLabel', { defaultValue: 'Planned preaching date (optional)' })}
              </label>
              <DatePickerField
                id="plannedDate"
                value={plannedDate}
                onChange={setPlannedDate}
                wrapperClassName="mt-1"
                inputClassName="block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 pr-12 dark:bg-gray-700 dark:text-white transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                disabled={isSubmitting}
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
                if (isSubmitting) {
                  return;
                }
                if (onCancel) {
                  onCancel(); // Signal cancellation to parent
                } else {
                  handleClose(); // Default close behavior
                }
              }}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('addSermon.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-b-transparent"
                  aria-hidden="true"
                />
              )}
              <span>{isSubmitting ? t('common.saving', { defaultValue: 'Saving...' }) : t('addSermon.save')}</span>
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
