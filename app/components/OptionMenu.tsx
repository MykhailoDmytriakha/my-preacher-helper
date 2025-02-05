"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import DeleteSermonButton from "@components/DeleteSermonButton";
import EditSermonModal from "@components/EditSermonModal"; // Импортируем новый модальный компонент
import { deleteSermon } from "@services/api.service";
import { Sermon } from "@/models/models";
import { DotsVerticalIcon } from "@components/Icons";

interface OptionMenuProps {
  sermon: Sermon; // Принимаем объект проповеди целиком
}

export default function OptionMenu({ sermon }: OptionMenuProps) {
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
    const confirmed = window.confirm("Вы уверены, что хотите удалить проповедь?");
    if (!confirmed) return;
    try {
      await deleteSermon(sermon.id);
      router.refresh();
    } catch (error) {
      console.error("Error deleting sermon:", error);
      alert("Не удалось удалить проповедь");
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
    // Можно обновить локальное состояние или перезагрузить страницу
    router.refresh();
  };

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        onClick={handleToggle}
        className="p-1 focus:outline-none hover:bg-gray-200 rounded transition-colors duration-200"
      >
        <DotsVerticalIcon className="w-5 h-5" />
      </button>

      {open && (
        <div className="origin-top-left absolute left-full top-0 ml-2 w-40 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10">
          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
            <button
              onClick={handleEdit}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex justify-between items-center"
              role="menuitem"
            >
              <span>Редактировать</span>
            </button>
            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex justify-between items-center"
              role="menuitem"
            >
              <span>Удалить</span>
              <span>
                <DeleteSermonButton sermonId={sermon.id} iconOnly noAction />
              </span>
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
