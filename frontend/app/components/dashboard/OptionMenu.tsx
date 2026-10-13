"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { EnginePreachDateModal } from '@/components/calendar/EnginePreachDateModal';
import { SeriesMembershipDialog } from '@/components/series/SeriesMembershipDialog';
import { EngineEditSermonModal } from '@/components/sermon/EngineEditSermonModal';
import { useDocumentActions } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import {
  applySourceNoteLinkPatch,
  openingContextOf,
  useSourceNoteLink,
  type SourceNoteOpeningContext,
} from "@/hooks/useSermonNoteLinks";
import { Sermon, Series } from "@/models/models";
import { getEffectiveIsPreached } from "@/utils/preachDateStatus";
import { getSeriesForRef } from "@/utils/seriesMembership";
import { DotsVerticalIcon } from "@components/Icons";
import SourceNotePickerModal from "@components/sermon/SourceNotePickerModal";

import type { PreachDateAction } from '@/components/calendar/preachDateForm';

import "@locales/i18n";

interface OptionMenuProps {
  sermon: Sermon;
  onDelete?: (sermonId: string) => void;
  onUpdate?: (updatedSermon: Sermon) => void;
  /** When provided, the menu also offers series actions (add / move / remove). */
  series?: Series[];
}


export default function OptionMenu({
  sermon,
  onDelete,
  onUpdate,
  series
}: OptionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [engineDateAction, setEngineDateAction] = useState<PreachDateAction | null>(null);
  const documentActions = useDocumentActions();
  const [showEditModal, setShowEditModal] = useState(false);
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
  const [seriesSelectorMode, setSeriesSelectorMode] = useState<'add' | 'change' | 'remove'>('add');
  const effectiveIsPreached = getEffectiveIsPreached(sermon);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Where keyboard focus returns after a dialog opened from this menu closes. */
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The app's own "are you sure?" window — the browser's box looked foreign on an iPhone.
  const { confirm, confirmDialog } = useConfirm();

  // Which series this sermon is in — DERIVED from the loaded list (series.items
  // is the sole truth). Only meaningful when a `series` list is passed in.
  const currentSeries = getSeriesForRef(sermon.id, series);

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
    const confirmed = await confirm({
      title: { key: 'optionMenu.deleteConfirm' },
      confirmText: { key: 'common.delete' },
    });
    if (!confirmed) return;

    // A deletion is one engine action: the collection keeps the row as pending until the
    // tombstone is confirmed, on every screen that lists it.
    try {
      await documentActions.remove({ collection: 'sermons', id: sermon.id });
      if (onDelete) onDelete(sermon.id);
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

  const closeMenu = () => {
    setOpen(false);
  };

  const handleTogglePreached = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    setEngineDateAction({ kind: effectiveIsPreached ? 'unmark' : 'mark' });
    closeMenu();
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
    setSeriesSelectorMode('remove');
    setShowSeriesSelector(true);
    closeMenu();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="p-1.5 focus:outline-none hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors duration-200"
        aria-label={t('optionMenu.options')}
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
                  >
              <span>{t('optionMenu.edit')}</span>
            </button>
            <button
              onClick={handleTogglePreached}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
              role="menuitem"
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
                              >
                    <span>{t('workspaces.series.actions.moveToDifferentSeries')}</span>
                  </button>
                  <button
                    onClick={handleRemoveFromSeries}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
                    role="menuitem"
                              >
                    <span>{t('workspaces.series.actions.removeFromSeries')}</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={handleAddToSeries}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
                  role="menuitem"
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
                  >
              <span>{t('optionMenu.delete')}</span>
            </button>
          </div>
        </div>
      )}

      {showEditModal && <EngineEditSermonModal key={sermon.id} sermonId={sermon.id} onClose={handleCloseEditModal} />}

      {engineDateAction && <EnginePreachDateModal key={`${sermon.id}:${engineDateAction.kind}`} sermonId={sermon.id}
        action={engineDateAction} onClose={() => setEngineDateAction(null)} />}

      {showSeriesSelector && <SeriesMembershipDialog seriesId={currentSeries?.id ?? ''} member={{ type: 'sermon', refId: sermon.id }}
        mode={seriesSelectorMode === 'remove' ? 'remove' : 'target'} onClose={() => setShowSeriesSelector(false)} />}

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
      {confirmDialog}
    </div>
  );
}
