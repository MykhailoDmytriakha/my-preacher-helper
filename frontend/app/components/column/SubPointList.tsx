"use client";

import { PlusIcon, PencilIcon, CheckIcon, XMarkIcon, TrashIcon } from "@heroicons/react/24/outline";
import React, { useEffect, useRef, useState } from "react";

import type { SubPoint } from "@/models/models";
import type { Translate } from "./types";

interface SubPointListProps {
  subPoints: SubPoint[];
  outlinePointId: string;
  isPointLocked: boolean;
  onAdd: (outlinePointId: string, text: string) => void;
  onEdit: (outlinePointId: string, subPointId: string, newText: string) => void;
  onDelete: (outlinePointId: string, subPointId: string) => void;
  t: Translate;
}

export const SubPointList: React.FC<SubPointListProps> = ({
  subPoints,
  outlinePointId,
  isPointLocked,
  onAdd,
  onEdit,
  onDelete,
  t,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [addText, setAddText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleAdd = () => {
    if (!addText.trim()) {
      setIsAdding(false);
      setAddText("");
      return;
    }
    onAdd(outlinePointId, addText.trim());
    setAddText("");
    setIsAdding(false);
  };

  const handleEditSave = () => {
    if (!editingId || !editText.trim()) {
      setEditingId(null);
      setEditText("");
      return;
    }
    onEdit(outlinePointId, editingId, editText.trim());
    setEditingId(null);
    setEditText("");
  };

  const sorted = [...subPoints].sort((a, b) => a.position - b.position);

  if (sorted.length === 0 && isPointLocked) return null;

  return (
    <div className="mt-3 ml-3 border-l-2 border-gray-200 dark:border-gray-600 pl-3">
      {sorted.length > 0 && (
        <div className="space-y-1.5">
          {sorted.map((sp) => (
            <div
              key={sp.id}
              className="group/sp flex items-center gap-1.5 py-1 px-2 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              {editingId === sp.id ? (
                <div className="flex-1 flex items-center gap-1">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEditSave();
                      if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                    }}
                    className="flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
                  />
                  <button
                    onClick={handleEditSave}
                    className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"
                    aria-label={t("common.save")}
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => { setEditingId(null); setEditText(""); }}
                    className="p-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-400"
                    aria-label={t("common.cancel")}
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-gray-600 dark:text-gray-300 min-w-0 truncate">
                    {sp.text}
                  </span>
                  {!isPointLocked && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/sp:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => { setEditingId(sp.id); setEditText(sp.text); }}
                        className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                        aria-label={t("common.edit")}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(outlinePointId, sp.id)}
                        className="p-0.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400"
                        aria-label={t("common.delete")}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!isPointLocked && (
        <div className="mt-1.5">
          {isAdding ? (
            <div className="flex items-center gap-1 px-2">
              <input
                ref={addInputRef}
                type="text"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") { setIsAdding(false); setAddText(""); }
                }}
                placeholder={t("structure.subPointPlaceholder", { defaultValue: "Sub-point name..." })}
                className="flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
              />
              <button
                onClick={handleAdd}
                className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"
                aria-label={t("common.save")}
              >
                <CheckIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setIsAdding(false); setAddText(""); }}
                className="p-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-400"
                aria-label={t("common.cancel")}
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            >
              <PlusIcon className="h-3 w-3" />
              <span>{t("structure.addSubPoint", { defaultValue: "Add sub-point" })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
