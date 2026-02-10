"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

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
}

const UNSPECIFIED_CHURCH_ID = 'church-unspecified';

export default function OptionMenu({ sermon, onDelete, onUpdate }: OptionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreachModal, setShowPreachModal] = useState(false);
  const [preachModalInitialData, setPreachModalInitialData] = useState<PreachDate | undefined>(undefined);
  const [preachDateToMark, setPreachDateToMark] = useState<PreachDate | null>(null);
  const effectiveIsPreached = getEffectiveIsPreached(sermon);
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
    const confirmed = window.confirm(t('optionMenu.deleteConfirm'));
    if (!confirmed) return;
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

  const handleTogglePreached = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      if (!effectiveIsPreached) {
        const preferredDate = getPreferredDateToMarkAsPreached(sermon);

        if (preferredDate) {
          if (requiresPreachedDetails(preferredDate)) {
            setPreachDateToMark(preferredDate);
            setPreachModalInitialData({
              ...preferredDate,
              status: 'preached',
              church:
                preferredDate.church?.id === UNSPECIFIED_CHURCH_ID
                  ? { id: '', name: '', city: '' }
                  : preferredDate.church
            });
            setShowPreachModal(true);
            setOpen(false);
            return;
          }

          await preachDatesService.updatePreachDate(sermon.id, preferredDate.id, { status: 'preached' });

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
          setOpen(false);
          return;
        }

        setPreachDateToMark(null);
        setPreachModalInitialData(undefined);
        setShowPreachModal(true);
        setOpen(false);
        return;
      }

      // Unmark as preached but keep dates: convert factual dates back to planned.
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

      invalidateCalendarCache();

      if (updated && onUpdate) {
        onUpdate(updated);
      } else if (!onUpdate) {
        router.refresh();
      }
    } catch (error) {
      console.error("Error updating preached status:", error);
      alert(t('optionMenu.updateError'));
    }
    setOpen(false);
  };

  const handleSavePreachDate = async (data: Omit<PreachDate, 'id' | 'createdAt'>) => {
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

      {showEditModal && (
        <EditSermonModal
          sermon={sermon}
          onClose={handleCloseEditModal}
          onUpdate={handleUpdateSermon}
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
