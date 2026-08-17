"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useSeriesMembership } from "@/hooks/useSeriesMembership";
import {
  applySourceNoteLinkPatch,
  openingContextOf,
  useSourceNoteLink,
  type SourceNoteOpeningContext,
} from "@/hooks/useSermonNoteLinks";
import { DashboardOptimisticActions, DashboardSermonSyncState } from "@/models/dashboardOptimistic";
import { Sermon, PreachDate, Series } from "@/models/models";
import {
  getEffectiveIsPreached,
  getPreachDatesByStatus,
  getPreferredDateToMarkAsPreached
} from "@/utils/preachDateStatus";
import { awaitAcceptance, persistedWrite, type WriteSubmission } from "@/utils/recoverableWrite";
import { getSeriesForRef } from "@/utils/seriesMembership";
import PreachDateModal from "@components/calendar/PreachDateModal";
import EditSermonModal from "@components/EditSermonModal";
import { DotsVerticalIcon } from "@components/Icons";
import SeriesSelector from "@components/series/SeriesSelector";
import SourceNotePickerModal from "@components/sermon/SourceNotePickerModal";
import * as preachDatesService from "@services/preachDates.service";
import { deleteSermon, updateSermon } from "@services/sermon.service";

import "@locales/i18n";


interface OptionMenuProps {
  sermon: Sermon;
  onDelete?: (sermonId: string) => void;
  onUpdate?: (updatedSermon: Sermon) => void;
  optimisticActions?: DashboardOptimisticActions;
  syncState?: DashboardSermonSyncState;
  /**
   * Raised while one of this menu's editors is on screen. The editor covers the card,
   * so the card's badge cannot be seen — and two visible reporters for one refusal is
   * the defect this migration keeps closing. The open editor speaks; the badge waits.
   */
  onEditorOpenChange?: (isOpen: boolean) => void;
  /** When provided, the menu also offers series actions (add / move / remove). */
  series?: Series[];
}

const UNSPECIFIED_CHURCH_ID = 'church-unspecified';

export default function OptionMenu({
  sermon,
  onDelete,
  onUpdate,
  optimisticActions,
  syncState,
  onEditorOpenChange,
  series
}: OptionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreachModal, setShowPreachModal] = useState(false);
  const [preachModalInitialData, setPreachModalInitialData] = useState<PreachDate | undefined>(undefined);
  const [preachDateToMark, setPreachDateToMark] = useState<PreachDate | null>(null);
  const [showSourceNotePicker, setShowSourceNotePicker] = useState(false);
  /**
   * WHAT THE PICKER OPENED WITH — frozen here, on purpose.
   *
   * The dialog keeps its checkboxes for as long as it is open while this component keeps
   * re-rendering with a fresher sermon. Reading the revision and the previous list at SAVE time
   * would pair an old selection with a new proof of freshness, and the guard would let that old
   * selection overwrite whatever another device stored meanwhile. So both halves are captured
   * together, at the moment the dialog opens, and travel together.
   */
  const [sourceNoteOpening, setSourceNoteOpening] = useState<SourceNoteOpeningContext | null>(null);
  /**
   * THE COPY THIS MENU WAS GIVEN — the one to merge a link patch into.
   *
   * Whoever renders this menu passes the copy their screen owns: the full document on the sermon
   * page, the list entity on the dashboard. Applying the patch here means the writer never has to
   * choose between two copies of a sermon — a choice that cost three review rounds, because the
   * list copy deliberately omits parts of the document while the detail copy holds edits the list
   * has never seen.
   */
  const sermonRef = useRef(sermon);
  useEffect(() => {
    sermonRef.current = sermon;
  }, [sermon]);
  const { saving: savingSourceNotes, setSourceNotes } = useSourceNoteLink(sermon, (patch) => {
    const own = sermonRef.current;
    if (!own || own.id !== patch.sermonId) return;
    onUpdate?.(applySourceNoteLinkPatch(own, patch));
  });
  const [showSeriesSelector, setShowSeriesSelector] = useState(false);
  const [seriesSelectorMode, setSeriesSelectorMode] = useState<'add' | 'change'>('add');
  const effectiveIsPreached = getEffectiveIsPreached(sermon);
  const isSyncPending = syncState?.status === 'pending';
  const menuRef = useRef<HTMLDivElement>(null);
  /** Where keyboard focus returns after a dialog opened from this menu closes. */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addToSeries, removeFromAllSeries } = useSeriesMembership();

  // Which series this sermon is in — DERIVED from the loaded list (series.items
  // is the sole truth). Only meaningful when a `series` list is passed in.
  const currentSeries = getSeriesForRef(sermon.id, series);

  useEffect(() => {
    onEditorOpenChange?.(showEditModal || showPreachModal || showSourceNotePicker);
  }, [showEditModal, showPreachModal, showSourceNotePicker, onEditorOpenChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!open);
  };

  const handleDelete = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSyncPending) return;
    const confirmed = window.confirm(t('optionMenu.deleteConfirm'));
    if (!confirmed) return;

    if (optimisticActions?.deleteSermon) {
      await awaitAcceptance(
        optimisticActions.deleteSermon(sermon) as unknown as WriteSubmission,
        // The card badge reports these dashboard writes (useDashboardOptimisticSermons),
        // with the operation and a retry attached to the row itself. A toast here as
        // well gave one refused action two messages — one refusal, one reporter.
        (error) => console.error('Dashboard sermon write refused:', error)
      );
      setOpen(false);
      return;
    }

    try {
      await deleteSermon(sermon.id);
      if (onDelete) {
        onDelete(sermon.id);
      } else {
        router.refresh();
      }
    } catch (error) {
      console.error("Error deleting sermon:", error);
      alert(t('optionMenu.deleteError'));
    }
    setOpen(false);
  };

  const handleEdit = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setShowEditModal(true);
    setOpen(false);
  };

  const handleCloseEditModal = () => {
    setShowEditModal(false);
  };

  const handleUpdateSermon = (updatedSermon: Sermon) => {
    if (onUpdate) {
      onUpdate(updatedSermon);
    } else {
      router.refresh();
    }
  };

  const closeMenu = () => {
    setOpen(false);
  };

  const invalidateCalendarCache = () =>
    queryClient.invalidateQueries({
      queryKey: ['calendarSermons'],
      exact: false
    });

  const requiresPreachedDetails = (preachDate: PreachDate): boolean => {
    const churchName = preachDate.church?.name?.trim();
    if (!churchName) {
      return true;
    }
    return preachDate.church?.id === UNSPECIFIED_CHURCH_ID;
  };

  const applySermonUpdateResult = (updated: Sermon | null) => {
    invalidateCalendarCache();
    if (updated && onUpdate) {
      onUpdate(updated);
      return;
    }
    if (!onUpdate) {
      router.refresh();
    }
  };

  const openPreachDetailsModal = (preachDate: PreachDate | null) => {
    setPreachDateToMark(preachDate);
    setPreachModalInitialData(
      preachDate
        ? {
            ...preachDate,
            status: 'preached',
            church:
              preachDate.church?.id === UNSPECIFIED_CHURCH_ID
                ? { id: '', name: '', city: '' }
                : preachDate.church
          }
        : undefined
    );
    setShowPreachModal(true);
    closeMenu();
  };

  const markAsPreachedWithPreferredDate = async (preferredDate: PreachDate) => {
    if (requiresPreachedDetails(preferredDate)) {
      openPreachDetailsModal(preferredDate);
      return;
    }

    if (optimisticActions?.markAsPreachedFromPreferred) {
      await awaitAcceptance(
        optimisticActions.markAsPreachedFromPreferred(sermon, preferredDate) as unknown as WriteSubmission,
        // The card badge reports these dashboard writes (useDashboardOptimisticSermons),
        // with the operation and a retry attached to the row itself. A toast here as
        // well gave one refused action two messages — one refusal, one reporter.
        (error) => console.error('Dashboard sermon write refused:', error)
      );
      closeMenu();
      return;
    }

    await preachDatesService.updatePreachDate(sermon.id, preferredDate.id, { status: 'preached' });
    const updated = await updateSermon({ ...sermon, isPreached: true }, { isPreached: true });
    applySermonUpdateResult(updated);
    closeMenu();
  };

  const unmarkAsPreachedInPlace = async () => {
    if (optimisticActions?.unmarkAsPreached) {
      await awaitAcceptance(
        optimisticActions.unmarkAsPreached(sermon) as unknown as WriteSubmission,
        // The card badge reports these dashboard writes (useDashboardOptimisticSermons),
        // with the operation and a retry attached to the row itself. A toast here as
        // well gave one refused action two messages — one refusal, one reporter.
        (error) => console.error('Dashboard sermon write refused:', error)
      );
      closeMenu();
      return;
    }

    const preachedDates = getPreachDatesByStatus(sermon, 'preached');
    if (preachedDates.length > 0) {
      await Promise.all(
        preachedDates.map((preachDate) =>
          preachDatesService.updatePreachDate(sermon.id, preachDate.id, { status: 'planned' })
        )
      );
    }

    const updated = await updateSermon({ ...sermon, isPreached: false }, { isPreached: false });
    applySermonUpdateResult(updated);
    closeMenu();
  };

  const handleTogglePreached = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSyncPending) return;

    // Captured BEFORE the write: an optimistic update flips this while the request is in
    // flight and rolls it back on refusal, so reading it inside `catch` asks about the
    // wrong direction.
    const wasPreached = effectiveIsPreached;
    /**
     * Does the row already speak for this? The optimistic path fails into the mutation
     * cache, which the sermon's own badge reads — so an `alert` here made one refusal into
     * two messages, the second of which invites the person to repeat an action that was
     * refused. The fallback path has no such reporter, and there the alert IS the message.
     */
    const rowReportsRefusal = wasPreached
      ? Boolean(optimisticActions?.unmarkAsPreached)
      : Boolean(optimisticActions?.markAsPreachedFromPreferred);

    try {
      if (!effectiveIsPreached) {
        const preferredDate = getPreferredDateToMarkAsPreached(sermon);
        if (preferredDate) {
          await markAsPreachedWithPreferredDate(preferredDate);
          return;
        }

        openPreachDetailsModal(null);
        return;
      }

      await unmarkAsPreachedInPlace();
    } catch (error) {
      console.error("Error updating preached status:", error);
      if (!rowReportsRefusal) alert(t('optionMenu.updateError'));
      closeMenu();
    }
  };

  const handleSavePreachDate = (data: Omit<PreachDate, 'id' | 'createdAt'>) => {
    if (optimisticActions?.savePreachDate) {
      // Return the real recoverable submission to PreachDateModal. Awaiting this
      // object here would turn it into an immediately fulfilled Promise and make
      // the modal close before the persistence result exists.
      return optimisticActions.savePreachDate(sermon, data, preachDateToMark) as unknown as WriteSubmission;
    }

    return persistedWrite((async () => {
      try {
        if (preachDateToMark) {
          await preachDatesService.updatePreachDate(sermon.id, preachDateToMark.id, {
            ...data,
            status: 'preached'
          });
        } else {
          await preachDatesService.addPreachDate(sermon.id, {
            ...data,
            status: data.status || 'preached'
          });
        }

        const updated = await updateSermon({ ...sermon, isPreached: true }, { isPreached: true });

        invalidateCalendarCache();

        if (updated && onUpdate) {
          onUpdate(updated);
        } else if (!onUpdate) {
          router.refresh();
        }
      } catch (err) {
        console.error("Failed to save preach date:", err);
        throw err;
      }
    })());
  };

  // Series actions — only surfaced when a `series` list is passed (e.g. the sermon page).
  const handleAddToSeries = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setSeriesSelectorMode('add');
    setShowSeriesSelector(true);
    closeMenu();
  };

  const handleChangeSeries = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setSeriesSelectorMode('change');
    setShowSeriesSelector(true);
    closeMenu();
  };

  /** Which study notes this sermon was built on — the same "link a thing" shape as series. */
  const handleEditSourceNotes = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setSourceNoteOpening(openingContextOf(sermon));
    setShowSourceNotePicker(true);
    closeMenu();
  };

  const handleRemoveFromSeries = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSeries) return;
    if (!window.confirm(t('workspaces.series.actions.removeFromSeries') + '?')) return;
    // Sweep-all: drop this sermon from every series it sits in. Fire-and-forget +
    // optimistic (the badge derives from the series list cache the sweep updates).
    removeFromAllSeries({ type: 'sermon', refId: sermon.id });
    invalidateCalendarCache();
    closeMenu();
  };

  const handleSeriesSelected = (seriesId: string) => {
    // ADD/MOVE via the playlist sweep: one-to-one is enforced by construction —
    // the sermon is removed from any other series in the same atomic batch, so
    // "change series" needs no separate remove step.
    addToSeries(seriesId, { type: 'sermon', refId: sermon.id });
    invalidateCalendarCache();
    setShowSeriesSelector(false);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="p-1.5 focus:outline-none hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors duration-200 disabled:opacity-60"
        aria-label={t('optionMenu.options')}
        disabled={isSyncPending}
      >
        <DotsVerticalIcon className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-50">
          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
            <button
              onClick={handleEdit}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
              role="menuitem"
              disabled={isSyncPending}
            >
              <span>{t('optionMenu.edit')}</span>
            </button>
            <button
              onClick={handleTogglePreached}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
              role="menuitem"
              disabled={isSyncPending}
            >
              <span>
                {effectiveIsPreached
                  ? t('optionMenu.markAsNotPreached')
                  : t('optionMenu.markAsPreached')}
              </span>
            </button>
            {series && (
              currentSeries ? (
                <>
                  <button
                    onClick={handleChangeSeries}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
                    role="menuitem"
                    disabled={isSyncPending}
                  >
                    <span>{t('workspaces.series.actions.moveToDifferentSeries')}</span>
                  </button>
                  <button
                    onClick={handleRemoveFromSeries}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
                    role="menuitem"
                    disabled={isSyncPending}
                  >
                    <span>{t('workspaces.series.actions.removeFromSeries')}</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={handleAddToSeries}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
                  role="menuitem"
                  disabled={isSyncPending}
                >
                  <span>{t('workspaces.series.actions.addToSeries')}</span>
                </button>
              )
            )}
            {/* Provenance sits with the other "what is this sermon connected to" actions, and
                the label says which of the two things the click will do. */}
            <button
              onClick={handleEditSourceNotes}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
              role="menuitem"
              disabled={isSyncPending}
            >
              <span>
                {(sermon.sourceNoteIds?.length ?? 0) > 0
                  ? t('sermon.sourceNotes.menuEdit')
                  : t('sermon.sourceNotes.menuAdd')}
              </span>
            </button>
            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
              role="menuitem"
              disabled={isSyncPending}
            >
              <span>{t('optionMenu.delete')}</span>
            </button>
          </div>
        </div>
      )}

      {showEditModal && (
        <EditSermonModal
          sermon={sermon}
          onClose={handleCloseEditModal}
          onUpdate={handleUpdateSermon}
          onSaveRequest={
            optimisticActions?.saveEditedSermon
              ? (input) => optimisticActions.saveEditedSermon(input) as unknown as WriteSubmission
              : undefined
          }
          syncState={syncState}
        />
      )}

      <PreachDateModal
        isOpen={showPreachModal}
        onClose={() => {
          setPreachDateToMark(null);
          setPreachModalInitialData(undefined);
          setShowPreachModal(false);
        }}
        onSave={handleSavePreachDate}
        syncState={syncState}
        initialData={preachModalInitialData}
        defaultStatus="preached"
      />

      {showSeriesSelector && (
        <SeriesSelector
          onClose={() => setShowSeriesSelector(false)}
          onSelect={handleSeriesSelected}
          currentSeriesId={currentSeries?.id}
          mode={seriesSelectorMode}
        />
      )}

      {showSourceNotePicker && sourceNoteOpening && (
        <SourceNotePickerModal
          selectedNoteIds={sourceNoteOpening.noteIds ?? []}
          saving={savingSourceNotes}
          returnFocusTo={triggerRef}
          onSave={async (noteIds) => {
            // `force`: the dialog only asks when the person actually changed the ticks, so an
            // identical-looking set is still a deliberate choice and must reach the server —
            // it may differ from what the server now holds.
            const result = await setSourceNotes(noteIds, sourceNoteOpening, { force: true });
            if (result.outcome === 'stale') {
              // RE-ARM THE PROOF, not just the checkboxes. The dialog adopts the server's list,
              // but a second press still has to vouch for something the server recognises —
              // keep the opening context from the refusal and "mine wins" becomes possible.
              // Without this the same press is refused for ever, which is a dead end wearing
              // the clothes of a safety feature.
              setSourceNoteOpening({
                sermonId: sourceNoteOpening.sermonId,
                noteIds: result.serverNoteIds ?? [],
                revision: result.serverRevision ?? sourceNoteOpening.revision,
              });
            }
            return result;
          }}
          onClose={() => {
            setShowSourceNotePicker(false);
            setSourceNoteOpening(null);
          }}
        />
      )}
    </div>
  );
}
