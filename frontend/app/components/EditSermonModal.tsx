"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import "@locales/i18n";

import DatePickerField from '@/components/ui/DatePickerField';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { DashboardEditSermonInput } from '@/models/dashboardOptimistic';
import { Church, PreachDate, Sermon } from '@/models/models';
import { SERMON_CORE_AGGREGATE } from '@/services/sermons.client';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getNextPlannedDate } from '@/utils/preachDateStatus';
import {
  awaitAcceptance,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { addPreachDate, deletePreachDate, updatePreachDate } from '@services/preachDates.service';
import { updateSermon } from '@services/sermon.service';

import type { DashboardSermonSyncState } from '@/models/dashboardOptimistic';

const EDIT_SERMON_ERROR_KEY = 'editSermon.updateError';

interface EditSermonModalProps {
  sermon: Sermon;
  onClose: () => void;
  onUpdate: (updatedSermon: Sermon) => void;
  onSaveRequest?: (
    input: DashboardEditSermonInput
  ) => WriteSubmission;
  /** Terminal state from the dashboard mutation cache, which owns rollback. */
  syncState?: DashboardSermonSyncState;
}

export default function EditSermonModal({
  sermon,
  onClose,
  onUpdate,
  onSaveRequest,
  syncState,
}: EditSermonModalProps) {
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
  const [saveError, setSaveError] = useState('');
  const [mounted, setMounted] = useState(false);
  const formEditedRef = React.useRef(false);
  /**
   * WHAT THIS FORM OPENED WITH, frozen per sermon.
   *
   * The fallback save below wrote `{title, verse}` with neither a revision nor these
   * values, so a laptop that had this modal open since last night resent its stale
   * VERSE while changing only the title — silently replacing what the phone stored.
   * Keyed by id because a focus refetch replaces the `sermon` object without the
   * form having been reopened; taking the values from it then would compare the
   * server with itself.
   */
  const openedWithRef = React.useRef<{ id: string; title: string; verse: string; revision: number } | null>(null);
  if (openedWithRef.current?.id !== sermon.id) {
    openedWithRef.current = {
      id: sermon.id,
      title: sermon.title,
      verse: sermon.verse,
      revision: sermon.rev?.[SERMON_CORE_AGGREGATE] ?? 0,
    };
  }

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

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    // Optimistic cache updates and their rollback both replace `sermon` while
    // this modal is mounted. Once the person has typed, those cache objects must
    // never overwrite the form's only copy of the submitted draft.
    if (formEditedRef.current) return;
    setTitle(sermon.title);
    setVerse(sermon.verse);
    setPlannedDate(resolveInitialPlannedDate(sermon));
  }, [sermon]);

  useEffect(() => {
    /**
     * NO `isSubmitting` GATE. The flag is cleared in `finally`, before React Query's
     * subscription delivers the failed state — so the condition was never true when it
     * mattered and an EARLY refusal said nothing at all. The badge that would otherwise
     * speak is deliberately hidden while this editor covers it, which left the person
     * looking at an unchanged form believing the save had gone through.
     */
    if (syncState?.status !== 'error') return;

    setSaveError(
      syncState.refused || syncState.conflict
        ? t('writeRecovery.refused')
        : syncState.message || t(EDIT_SERMON_ERROR_KEY)
    );
    setIsSubmitting(false);
  }, [syncState, t]);

  const markEdited = () => {
    formEditedRef.current = true;
    setSaveError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;

    if (onSaveRequest) {
      setIsSubmitting(true);
      setSaveError('');
      try {
        const submission = onSaveRequest({
          sermon,
          title,
          verse,
          plannedDate,
          initialPlannedDate,
          unspecifiedChurchName: getUnspecifiedChurch().name,
        });

        await awaitAcceptance(submission, (error) => {
          /**
           * A LATE refusal is shown on the sermon's own card, as a badge with the text
           * and a retry — see useDashboardOptimisticSermons. By then this editor is
           * usually closed, and when it is not, two messages for one refusal is worse
           * than one in the right place.
           */
          console.error('Sermon update refused after acceptance:', error);
        });
        onClose();
      } catch (error) {
        /**
         * Silent by rule: the dashboard hook owns this write's message (a badge on the
         * sermon row) whether the refusal is early or late. This editor stays open with
         * the title and verse the person typed — that is its whole duty here.
         */
        console.error("Error scheduling optimistic sermon update:", error);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    setSaveError('');

    try {
      // This fallback intentionally keeps its existing unguarded persistence
      // semantics. Refusal recovery is now safe in this modal, but changing the
      // concurrency policy also requires the separate take-mine/take-theirs flow;
      // that is outside this focused write-result fix.
      const data = await updateSermon({ ...sermon, title, verse }, { title, verse });

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
      setSaveError(t(writeFailureTranslationKey(error, EDIT_SERMON_ERROR_KEY)));
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-sermon-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden"
      >
        <h2 id="edit-sermon-title" className="text-2xl font-bold mb-6">{t('editSermon.editSermon')}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('editSermon.titleLabel')}
            </label>
            <TextareaAutosize 
              id="title" 
              value={title}
              onChange={e => {
                markEdited();
                setTitle(e.target.value);
              }}
              placeholder={t('editSermon.titlePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
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
              onChange={e => {
                markEdited();
                setVerse(e.target.value);
              }}
              placeholder={t('editSermon.versePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
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
              <DatePickerField
                id="plannedDate"
                value={plannedDate}
                onChange={(value) => {
                  markEdited();
                  setPlannedDate(value);
                }}
                wrapperClassName="w-full"
                inputClassName="block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 pr-12 dark:bg-gray-700 dark:text-white transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                disabled={isSubmitting || isReadOnly}
              />
              <button
                type="button"
                onClick={() => {
                  markEdited();
                  setPlannedDate('');
                }}
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
          {saveError && (
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              {saveError}
            </p>
          )}
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
