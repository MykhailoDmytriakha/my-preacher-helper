"use client";

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SermonFormDialog from '@/components/sermon/SermonFormDialog';
import { useSeries } from '@/hooks/useSeries';
import { DashboardCreateSermonInput } from '@/models/dashboardOptimistic';
import { Sermon, Church } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { buildUnspecifiedChurch, churchForNewPreachDate } from '@/utils/church';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { PlusIcon } from "@components/Icons";
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
            church: churchForNewPreachDate(church, getUnspecifiedChurch().name)
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
    <SermonFormDialog
      heading={t(NEW_SERMON_KEY)}
      values={{ title, verse, church, plannedDate, seriesId: selectedSeriesId }}
      onChange={(patch) => {
        if ('title' in patch) setTitle(patch.title ?? '');
        if ('verse' in patch) setVerse(patch.verse ?? '');
        if ('church' in patch) setChurch(patch.church);
        if ('plannedDate' in patch) setPlannedDate(patch.plannedDate ?? '');
        if ('seriesId' in patch) setSelectedSeriesId(patch.seriesId ?? '');
      }}
      onSubmit={handleSubmit}
      onCancel={() => {
        if (isSubmitting) {
          return;
        }
        if (onCancel) {
          onCancel(); // Signal cancellation to parent
        } else {
          handleClose(); // Default close behavior
        }
      }}
      submitLabel={t('addSermon.save')}
      saving={isSubmitting}
      error={submitError}
      seriesOptions={series.map((s) => ({ id: s.id, label: s.title || s.theme }))}
      showPlannedDate={allowPlannedDate}
      detailsHint={t('addSermon.groupLaterHint')}
    />
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

      {open && modalContent}
    </>
  );
}
