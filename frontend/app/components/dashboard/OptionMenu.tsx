"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { DashboardOptimisticActions, DashboardSermonSyncState } from "@/models/dashboardOptimistic";
import { Sermon, PreachDate } from "@/models/models";
import {
  getEffectiveIsPreached,
  getPreachDatesByStatus,
  getPreferredDateToMarkAsPreached
} from "@/utils/preachDateStatus";
import PreachDateModal from "@components/calendar/PreachDateModal";
import EditSermonModal from "@components/EditSermonModal";
import { DotsVerticalIcon } from "@components/Icons";
import * as preachDatesService from "@services/preachDates.service";
import { deleteSermon, updateSermon } from "@services/sermon.service";

import "@locales/i18n";


interface OptionMenuProps {
  sermon: Sermon;
  onDelete?: (sermonId: string) => void;
  onUpdate?: (updatedSermon: Sermon) => void;
  optimisticActions?: DashboardOptimisticActions;
  syncState?: DashboardSermonSyncState;
}

const UNSPECIFIED_CHURCH_ID = 'church-unspecified';

export default function OptionMenu({
  sermon,
  onDelete,
  onUpdate,
  optimisticActions,
  syncState
}: OptionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreachModal, setShowPreachModal] = useState(false);
  const [preachModalInitialData, setPreachModalInitialData] = useState<PreachDate | undefined>(undefined);
  const [preachDateToMark, setPreachDateToMark] = useState<PreachDate | null>(null);
  const effectiveIsPreached = getEffectiveIsPreached(sermon);
  const isSyncPending = syncState?.status === 'pending';
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

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
      await optimisticActions.deleteSermon(sermon);
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
      await optimisticActions.markAsPreachedFromPreferred(sermon, preferredDate);
      closeMenu();
      return;
    }

    await preachDatesService.updatePreachDate(sermon.id, preferredDate.id, { status: 'preached' });
    const updated = await updateSermon({
      ...sermon,
      isPreached: true
    });
    applySermonUpdateResult(updated);
    closeMenu();
  };

  const unmarkAsPreachedInPlace = async () => {
    if (optimisticActions?.unmarkAsPreached) {
      await optimisticActions.unmarkAsPreached(sermon);
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

    const updated = await updateSermon({
      ...sermon,
      isPreached: false
    });
    applySermonUpdateResult(updated);
    closeMenu();
  };

  const handleTogglePreached = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSyncPending) return;

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
      alert(t('optionMenu.updateError'));
      closeMenu();
    }
  };

  const handleSavePreachDate = async (data: Omit<PreachDate, 'id' | 'createdAt'>) => {
    if (optimisticActions?.savePreachDate) {
      await optimisticActions.savePreachDate(sermon, data, preachDateToMark);
      setPreachDateToMark(null);
      setPreachModalInitialData(undefined);
      setShowPreachModal(false);
      return;
    }

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

      const updated = await updateSermon({
        ...sermon,
        isPreached: true
      });

      invalidateCalendarCache();

      if (updated && onUpdate) {
        onUpdate(updated);
      } else if (!onUpdate) {
        router.refresh();
      }

      setPreachDateToMark(null);
      setPreachModalInitialData(undefined);
      setShowPreachModal(false);
    } catch (err) {
      console.error("Failed to save preach date:", err);
      throw err;
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
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
          onSaveRequest={optimisticActions?.saveEditedSermon}
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
        initialData={preachModalInitialData}
        defaultStatus="preached"
      />
    </div>
  );
}
