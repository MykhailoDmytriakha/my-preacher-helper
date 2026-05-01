"use client";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { PlusIcon, PencilIcon, CheckIcon, XMarkIcon, TrashIcon, Bars2Icon } from "@heroicons/react/24/outline";
import React, { useEffect, useRef, useState } from "react";

import type { SubPoint } from "@/models/models";

interface SubPointListProps {
  subPoints: SubPoint[];
  outlinePointId: string;
  isPointLocked: boolean;
  onAdd: (outlinePointId: string, text: string) => void;
  onEdit: (outlinePointId: string, subPointId: string, newText: string) => void;
  onDelete: (outlinePointId: string, subPointId: string) => void;
  onReorder?: (outlinePointId: string, sourceIndex: number, destinationIndex: number) => void;
  getAffectedThoughtCount?: (subPointId: string) => number;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export const SubPointList: React.FC<SubPointListProps> = ({
  subPoints,
  outlinePointId,
  isPointLocked,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
  getAffectedThoughtCount,
  t,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [addText, setAddText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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
    setIsAdding(false);
    setAddText("");
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

  const handleDeleteClick = (spId: string) => {
    const count = getAffectedThoughtCount?.(spId) ?? 0;
    if (count > 0) {
      setConfirmDeleteId(spId);
    } else {
      onDelete(outlinePointId, spId);
    }
  };

  const handleConfirmDelete = () => {
    if (confirmDeleteId) {
      onDelete(outlinePointId, confirmDeleteId);
      setConfirmDeleteId(null);
    }
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    onReorder?.(outlinePointId, result.source.index, result.destination.index);
  };

  const sorted = [...subPoints].sort((a, b) => a.position - b.position);

  if (sorted.length === 0 && isPointLocked) return null;

  const canReorder = !isPointLocked && onReorder && sorted.length > 1;

  const renderSubPointContent = (sp: SubPoint, dragHandleProps?: React.HTMLAttributes<HTMLElement> | null) => (
    <>
      {canReorder && dragHandleProps ? (
        <div {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)} className="cursor-grab flex-shrink-0 w-4 flex items-center justify-center touch-manipulation">
          <Bars2Icon className="h-3 w-3 text-slate-400 dark:text-blue-100/70" />
        </div>
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-blue-100/75 flex-shrink-0 shadow-sm dark:shadow-blue-950/20" />
      )}
      <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-600 dark:text-blue-50/90" title={sp.text}>
        {sp.text}
      </span>
      {!isPointLocked && (
        <div className="flex items-center gap-0.5 opacity-40 group-hover/sp:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={() => { setEditingId(sp.id); setEditText(sp.text); }}
            className="p-0.5 text-slate-400 hover:text-slate-600 dark:text-blue-100/45 dark:hover:text-blue-50"
            aria-label={t("common.edit")}
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => handleDeleteClick(sp.id)}
            className="p-0.5 text-slate-400 hover:text-red-500 dark:text-blue-100/45 dark:hover:text-red-200"
            aria-label={t("common.delete")}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );

  const renderSubPointItem = (sp: SubPoint, dragHandleProps?: React.HTMLAttributes<HTMLElement> | null) => (
    <div className="group/sp flex items-center gap-2 py-1.5 px-2 rounded-lg transition-colors hover:bg-slate-100/80 dark:hover:bg-white/10">
      {editingId === sp.id ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            ref={editingId === sp.id ? editInputRef : undefined}
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleEditSave();
              if (e.key === "Escape") { setEditingId(null); setEditText(""); }
            }}
            className="flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
          />
          <button onClick={handleEditSave} className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400" aria-label={t("common.save")}>
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { setEditingId(null); setEditText(""); }} className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500" aria-label={t("common.cancel")}>
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        renderSubPointContent(sp, dragHandleProps)
      )}
    </div>
  );

  // Clone renderer for drag preview — renders at body level, avoids clipping
  const renderClone = (provided: import("@hello-pangea/dnd").DraggableProvided, _snapshot: import("@hello-pangea/dnd").DraggableStateSnapshot, rubric: import("@hello-pangea/dnd").DraggableRubric) => {
    const sp = sorted[rubric.source.index];
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white dark:bg-slate-800 shadow-lg ring-1 ring-blue-400/50 text-sm"
        style={provided.draggableProps.style}
      >
        <Bars2Icon className="h-3 w-3 text-slate-400 dark:text-blue-100/70 flex-shrink-0" />
        <span className="text-slate-600 dark:text-blue-50/90">{sp.text}</span>
      </div>
    );
  };

  return (
    <div className="ml-7 mt-2 mb-2 rounded-lg border-l border-slate-300/80 bg-white/30 py-1.5 pl-3 pr-2 dark:border-blue-100/35 dark:bg-white/[0.07]">
      {sorted.length > 0 && (
        canReorder ? (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId={`subpoints-${outlinePointId}`} renderClone={renderClone}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5">
                  {sorted.map((sp, index) => (
                    <Draggable key={sp.id} draggableId={`sp-drag-${sp.id}`} index={index}>
                      {(draggableProvided) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          style={draggableProvided.draggableProps.style}
                        >
                          {renderSubPointItem(sp, draggableProvided.dragHandleProps as unknown as React.HTMLAttributes<HTMLElement>)}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <div className="space-y-0.5">
            {sorted.map((sp) => (
              <div key={sp.id}>
                {renderSubPointItem(sp)}
              </div>
            ))}
          </div>
        )
      )}

      {confirmDeleteId && (
        <div className="flex items-center gap-2 py-1.5 px-2 mt-1 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-xs">
          <span className="text-red-600 dark:text-red-400 flex-1">
            {t("structure.subPointDeleteConfirm", {
              defaultValue: "{{count}} thought(s) will be ungrouped",
              count: getAffectedThoughtCount?.(confirmDeleteId) ?? 0,
            })}
          </span>
          <button
            onClick={handleConfirmDelete}
            className="px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800/40 dark:hover:bg-red-800/60 text-red-700 dark:text-red-300 font-medium transition-colors"
          >
            {t("common.delete")}
          </button>
          <button
            onClick={() => setConfirmDeleteId(null)}
            className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500"
            aria-label={t("common.cancel")}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!isPointLocked && (
        <div className={sorted.length > 0 ? "mt-0.5" : ""}>
          {isAdding ? (
            <div className="flex items-center gap-1 pl-1.5">
              <span className="w-1 h-1 rounded-full bg-blue-300 dark:bg-blue-500 flex-shrink-0" />
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
              <button onClick={handleAdd} className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400" aria-label={t("common.save")}>
                <CheckIcon className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => { setIsAdding(false); setAddText(""); }} className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500" aria-label={t("common.cancel")}>
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 pl-1.5 py-0.5 text-xs text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 transition-colors"
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
