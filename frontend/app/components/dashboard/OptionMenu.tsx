"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { deleteSermon, updateSermon } from "@services/sermon.service";
import { Sermon } from "@/models/models";
import { DotsVerticalIcon } from "@components/Icons";
import EditSermonModal from "@components/EditSermonModal";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

interface OptionMenuProps {
  sermon: Sermon;
  onDelete?: (sermonId: string) => void;
  onUpdate?: (updatedSermon: Sermon) => void;
}

export default function OptionMenu({ sermon, onDelete, onUpdate }: OptionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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

  const handleTogglePreached = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const updated = await updateSermon({ 
        ...sermon, 
        isPreached: !sermon.isPreached 
      });
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
                {sermon.isPreached 
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
    </div>
  );
}
