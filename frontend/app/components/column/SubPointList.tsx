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

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    onReorder?.(outlinePointId, result.source.index, result.destination.index);
  };

  const sorted = [...subPoints].sort((a, b) => a.position - b.position);

  if (sorted.length === 0 && isPointLocked) return null;

  const canReorder = !isPointLocked && onReorder && sorted.length > 1;

  const renderSubPointItem = (sp: SubPoint, index: number, dragHandleProps?: React.HTMLAttributes<HTMLElement> | null) => (
    <div className="group/sp flex items-center gap-2 py-1 px-1.5 rounded transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-700/30">
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
        <>
          {canReorder && dragHandleProps ? (
            <div {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)} className="cursor-grab text-gray-300 dark:text-gray-600 opacity-0 group-hover/sp:opacity-100 transition-opacity flex-shrink-0">
              <Bars2Icon className="h-3 w-3" />
            </div>
          ) : (
            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-500 flex-shrink-0" />
          )}
          <span className="flex-1 text-sm text-gray-500 dark:text-gray-400 min-w-0 truncate">
            {sp.text}
          </span>
          {!isPointLocked && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover/sp:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={() => { setEditingId(sp.id); setEditText(sp.text); }}
                className="p-0.5 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
                aria-label={t("common.edit")}
              >
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDelete(outlinePointId, sp.id)}
                className="p-0.5 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
                aria-label={t("common.delete")}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="ml-7 mt-1 mb-1 border-l border-gray-200/60 dark:border-gray-600/40 pl-3">
      {sorted.length > 0 && (
        canReorder ? (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId={`subpoints-${outlinePointId}`}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5">
                  {sorted.map((sp, index) => (
                    <Draggable key={sp.id} draggableId={sp.id} index={index}>
                      {(draggableProvided, snapshot) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className={snapshot.isDragging ? "opacity-70 shadow-sm rounded bg-gray-100/50 dark:bg-gray-700/50" : ""}
                          style={draggableProvided.draggableProps.style}
                        >
                          {renderSubPointItem(sp, index, draggableProvided.dragHandleProps as unknown as React.HTMLAttributes<HTMLElement>)}
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
            {sorted.map((sp, index) => (
              <div key={sp.id}>
                {renderSubPointItem(sp, index)}
              </div>
            ))}
          </div>
        )
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
