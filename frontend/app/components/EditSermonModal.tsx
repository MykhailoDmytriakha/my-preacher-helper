"use client";

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

import SermonFormDialog from '@/components/sermon/SermonFormDialog';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { DashboardEditSermonInput } from '@/models/dashboardOptimistic';
import { Church, PreachDate, Sermon } from '@/models/models';
import { SERMON_CORE_AGGREGATE } from '@/services/sermons.client';
import { churchForNewPreachDate, churchToFillOnPreachDate } from '@/utils/church';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getNextPlannedDate } from '@/utils/preachDateStatus';
import {
  awaitAcceptance,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { getSeriesForRef } from '@/utils/seriesMembership';
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
  /**
   * The congregation this sermon is prepared for. CLEARING IS A NAMELESS CHURCH, not
   * `undefined`: the update path strips undefined keys (`deepCleanUndefined`), so an
   * undefined here would silently leave the old church in the document. Every reader
   * already judges "not stated" through `isUnspecifiedChurch`, so a blank name reads as
   * cleared everywhere without a second rule.
   */
  const [church, setChurch] = useState<Church | undefined>(sermon.church);
  /**
   * THE SERIES IS EDITABLE HERE because this is where a person looks for it.
   *
   * The create door offers a series and this one did not, so changing your mind meant
   * finding a menu item you had to know about — and the natural reading of that absence
   * was "the link is broken". The value is DERIVED from the loaded playlist
   * (`series.items` is the sole truth), never from the deprecated `sermon.seriesId`.
   */
  const { series: seriesList, loading: seriesLoading } = useSeries(null);
  const { addToSeries, removeFromAllSeries } = useSeriesMembership();
  const currentSeriesId = getSeriesForRef(sermon.id, seriesList)?.id ?? '';
  const [seriesId, setSeriesId] = useState(currentSeriesId);
  const seriesTouchedRef = React.useRef(false);
  // Until the person touches the field, it follows the list: the playlist may still be
  // loading when this opens, and a field frozen at "" would then offer to unfile the sermon.
  const shownSeriesId = seriesTouchedRef.current ? seriesId : currentSeriesId;
  const seriesChanged = seriesTouchedRef.current && shownSeriesId !== currentSeriesId;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');
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

  const churchChanged =
    (church?.name || '').trim() !== (sermon.church?.name || '').trim() ||
    (church?.city || '').trim() !== (sermon.church?.city || '').trim();
  const hasChanges =
    title !== sermon.title ||
    verse !== sermon.verse ||
    plannedDate !== initialPlannedDate ||
    churchChanged ||
    seriesChanged;

  /**
   * Membership goes through its one writer and is NOT awaited: the sweep is optimistic and
   * offline it never resolves, so awaiting it would hang the editor. Its refusals have their
   * own reporter for every surface (`useSeriesMembership`), which is why this does not try
   * to speak for them.
   */
  const applySeriesChange = () => {
    if (!seriesChanged) return;
    if (shownSeriesId) {
      addToSeries(shownSeriesId, { type: 'sermon', refId: sermon.id });
      return;
    }
    removeFromAllSeries({ type: 'sermon', refId: sermon.id });
  };

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

  /**
   * The dated half of this save: the sermon's own fields are already written, and what is
   * left is the one planned date this form can touch. Lifted out of `handleSubmit` because
   * the two halves answer different questions and read badly interleaved.
   */
  const syncPlannedDate = async (savedSermon: Sermon): Promise<Sermon> => {
    const existingPlannedDate = getNextPlannedDate(sermon);
    // Fill the unsaid, never overwrite the said — one rule, one home (`utils/church`).
    const churchForExistingDate = existingPlannedDate
      ? churchToFillOnPreachDate(church, existingPlannedDate.church)
      : undefined;
    const dateChanged = plannedDate !== initialPlannedDate;

    if (dateChanged && plannedDate && existingPlannedDate) {
      return mergePreachDate(savedSermon, await updatePreachDate(sermon.id, existingPlannedDate.id, {
        date: plannedDate,
        status: 'planned',
        ...(churchForExistingDate ? { church: churchForExistingDate } : {})
      }));
    }
    if (dateChanged && plannedDate) {
      return mergePreachDate(savedSermon, await addPreachDate(sermon.id, {
        date: plannedDate,
        status: 'planned',
        church: churchForNewPreachDate(church, getUnspecifiedChurch().name)
      }));
    }
    if (dateChanged && existingPlannedDate) {
      await deletePreachDate(sermon.id, existingPlannedDate.id);
      return {
        ...savedSermon,
        preachDates: (savedSermon.preachDates || []).filter((pd) => pd.id !== existingPlannedDate.id)
      };
    }
    if (existingPlannedDate && churchForExistingDate) {
      // The date was already there and only the congregation was named just now.
      return mergePreachDate(savedSermon, await updatePreachDate(sermon.id, existingPlannedDate.id, {
        church: churchForExistingDate
      }));
    }
    return savedSermon;
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
          church: churchChanged ? church ?? { id: '', name: '', city: '' } : undefined,
          unspecifiedChurchName: getUnspecifiedChurch().name,
        });

        applySeriesChange();
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
      const corePatch = churchChanged
        ? { title, verse, church: church ?? { id: '', name: '', city: '' } }
        : { title, verse };
      applySeriesChange();
      const data = await updateSermon({ ...sermon, ...corePatch }, corePatch);

      if (!data) {
        throw new Error('Failed to update sermon');
      }

      onUpdate(await syncPlannedDate(data));
      onClose();
    } catch (error) {
      setSaveError(t(writeFailureTranslationKey(error, EDIT_SERMON_ERROR_KEY)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SermonFormDialog
      heading={t('editSermon.editSermon')}
      values={{ title, verse, church, plannedDate, seriesId: shownSeriesId }}
      onChange={(patch) => {
        markEdited();
        if ('title' in patch) setTitle(patch.title ?? '');
        if ('verse' in patch) setVerse(patch.verse ?? '');
        if ('church' in patch) setChurch(patch.church);
        if ('plannedDate' in patch) setPlannedDate(patch.plannedDate ?? '');
        if ('seriesId' in patch) {
          seriesTouchedRef.current = true;
          setSeriesId(patch.seriesId ?? '');
        }
      }}
      onSubmit={handleSubmit}
      onCancel={onClose}
      submitLabel={t('buttons.save')}
      saving={isSubmitting}
      submitDisabled={!hasChanges}
      readOnly={isReadOnly}
      error={saveError}
      seriesOptions={seriesList.map((entry) => ({ id: entry.id, label: entry.title || entry.theme }))}
      seriesLoading={seriesLoading}
      showPlannedDate
      detailsHint={t('editSermon.plannedDateHint', { defaultValue: 'Leave empty if you do not want a planned date.' })}
    />
  );
}
