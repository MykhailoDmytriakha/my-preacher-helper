"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import ConfirmModal from "@/components/ui/ConfirmModal";

import { TRANSLATION_COMMON_DELETE } from "./constants";

interface DeletePointConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pointName: string;
}

export function DeletePointConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  pointName,
}: DeletePointConfirmModalProps) {
  const [inputValue, setInputValue] = useState("");
  const { t } = useTranslation();

  useEffect(() => {
    if (isOpen) {
      setInputValue("");
    }
  }, [isOpen]);

  const isMatch = inputValue.trim() === pointName.trim();

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t("structure.deletePointConfirmTitle", { defaultValue: "Delete Outline Point" })}
      description={t("structure.deletePointConfirmDesc", {
        defaultValue:
          "Are you sure you want to delete this point? This action cannot be undone. To confirm, type the name of the point:",
      })}
      confirmText={t(TRANSLATION_COMMON_DELETE, { defaultValue: "Delete" })}
      isDestructive={true}
      confirmDisabled={!isMatch}
    >
      <div className="mb-4 select-all rounded-lg border border-gray-200 bg-gray-50 p-3 text-center font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
        {pointName}
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        placeholder={pointName}
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-red-500"
      />
    </ConfirmModal>
  );
}
