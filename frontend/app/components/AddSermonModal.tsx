"use client";

import { ChevronDown } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import ChurchField from '@/components/church/ChurchField';
import { useSeries } from '@/hooks/useSeries';
import { DashboardCreateSermonInput } from '@/models/dashboardOptimistic';
import { Sermon, Church } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { buildUnspecifiedChurch } from '@/utils/church';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { PlusIcon } from "@components/Icons";
import DatePickerField from '@components/ui/DatePickerField';
import { auth } from '@services/firebaseAuth.service';
import { addPreachDate } from '@services/preachDates.service';
import { createSermon } from '@services/sermon.service';

const SAVE_SERMON_ERROR_KEY = 'errors.failedToSaveSermon';

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

/** One rounded card per group, hairline dividers between its rows. */
const GROUP_CARD =
  'rounded-2xl border border-gray-200 bg-white divide-y divide-gray-200 dark:border-gray-700 dark:bg-gray-800/60 dark:divide-gray-700';
const GROUP_TITLE =
  'px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
const FIELD_ROW = 'p-4';
const FIELD_LABEL = 'block text-sm font-medium text-gray-700 dark:text-gray-200';
const FIELD_INPUT =
  'mt-1 block w-full rounded-xl border border-gray-300 bg-white p-3 text-gray-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-700 dark:text-white';

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
  const [church, setChurch] = useState<Church | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // What went wrong with the LAST attempt, shown inside the form the person is still
  // looking at. Previously these failures went only to the console.
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const getUnspecifiedChurch = (): Church =>
    buildUnspecifiedChurch(t('calendar.unspecifiedChurch', { defaultValue: 'Church not specified' }));

  const resetForm = () => {
    setTitle('');
    setVerse('');
    setSelectedSeriesId(preSelectedSeriesId || '');
    setPlannedDate('');
    setChurch(undefined);
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
          church,
          unspecifiedChurchName: getUnspecifiedChurch().name,
        }), (error) => {
          // A refusal that lands AFTER acceptance: if this form is still on screen it is
          // still the only thing the person can see, so it says so here too. Once it has
          // closed, the row badge is the reporter and this setState is a no-op.
          console.error('Sermon create refused after acceptance:', error);
          setSubmitError(t(writeFailureTranslationKey(error, SAVE_SERMON_ERROR_KEY)));
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
        setSubmitError(t(writeFailureTranslationKey(error, SAVE_SERMON_ERROR_KEY)));
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
      seriesId: selectedSeriesId || undefined,
      // Travels with the sermon, so a church named without a date is still kept.
      church
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
            church: church ?? getUnspecifiedChurch()
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
      setSubmitError(t(writeFailureTranslationKey(error, SAVE_SERMON_ERROR_KEY)));
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={() => {
        if (!isSubmitting) {
          handleClose();
        }
      }}
    >
      {/*
        THREE BANDS, AND ONLY THE MIDDLE ONE SCROLLS. The title and the buttons used to
        scroll away with the fields, so on a phone the person filling the last field
        could not see Save at all. Now the form is a column: sticky head, scrolling
        body, sticky foot.
      */}
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-gray-50 shadow-xl dark:bg-gray-900 sm:max-h-[85vh] sm:w-[560px] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <div className="shrink-0 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{t(NEW_SERMON_KEY)}</h2>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {submitError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
              >
                {submitError}
              </div>
            )}

            <section>
              <h3 className={GROUP_TITLE}>{t('addSermon.groupSermon')}</h3>
              <div className={GROUP_CARD}>
                <div className={FIELD_ROW}>
                  <label htmlFor="title" className={FIELD_LABEL}>
                    {t('addSermon.titleLabel')}
                  </label>
                  <TextareaAutosize
                    id="title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder={t('addSermon.titlePlaceholder')}
                    className={`${FIELD_INPUT} resize-none`}
                    minRows={1}
                    maxRows={4}
                    disabled={isSubmitting}
                    required
                  />
                </div>
                <div className={FIELD_ROW}>
                  <label htmlFor="verse" className={FIELD_LABEL}>
                    {t('addSermon.verseLabel')}
                  </label>
                  <TextareaAutosize
                    id="verse"
                    value={verse}
                    onChange={e => setVerse(e.target.value)}
                    placeholder={t('addSermon.versePlaceholder')}
                    className={`${FIELD_INPUT} resize-none`}
                    minRows={3}
                    maxRows={10}
                    disabled={isSubmitting}
                    required
                  />
                </div>
              </div>
            </section>

            <section>
              <h3 className={GROUP_TITLE}>{t('addSermon.groupLater')}</h3>
              <div className={GROUP_CARD}>
                <div className={FIELD_ROW}>
                  <label htmlFor="church" className={FIELD_LABEL}>
                    {t('calendar.church')}
                  </label>
                  <ChurchField
                    id="church"
                    value={church}
                    onChange={setChurch}
                    hideLabel
                    disabled={isSubmitting}
                    inputClassName={`${FIELD_INPUT} pr-12`}
                  />
                </div>
                {allowPlannedDate && (
                  <div className={FIELD_ROW}>
                    <label htmlFor="plannedDate" className={FIELD_LABEL}>
                      {t('addSermon.plannedDateLabel', { defaultValue: 'Planned preaching date' })}
                    </label>
                    <DatePickerField
                      id="plannedDate"
                      value={plannedDate}
                      onChange={setPlannedDate}
                      wrapperClassName=""
                      inputClassName={`${FIELD_INPUT} pr-12`}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
                <div className={FIELD_ROW}>
                  <label htmlFor="series" className={FIELD_LABEL}>
                    {t('addSermon.seriesLabel')}
                  </label>
                  <div className="relative">
                    <select
                      id="series"
                      value={selectedSeriesId}
                      onChange={(e) => setSelectedSeriesId(e.target.value)}
                      className={`${FIELD_INPUT} appearance-none pr-12`}
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
                      className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500 dark:text-gray-300"
                    />
                  </div>
                </div>
              </div>
              <p className="px-1 pt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('addSermon.groupLaterHint')}
              </p>
            </section>
          </div>

          <div className="shrink-0 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
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
                className="rounded-xl px-4 py-2.5 font-medium text-gray-600 transition hover:bg-gray-200/70 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {t('addSermon.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
