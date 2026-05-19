"use client";

import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DraggableRubric,
  type DraggableStateSnapshot,
  type DropResult,
} from "@hello-pangea/dnd";
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
  isSidebar?: boolean;
}

const SUB_POINT_LABEL_CLASS = "text-slate-600 dark:text-blue-50/90";
const SMALL_ACTION_ICON_CLASS = "h-3.5 w-3.5";
const DRAG_HANDLE_ICON_CLASS = "h-3 w-3 text-slate-400 dark:text-blue-100/70";
const SECONDARY_ICON_BUTTON_CLASS = "p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500";
const COMMON_CANCEL_KEY = "common.cancel";
const COMMON_DELETE_KEY = "common.delete";
const COMMON_SAVE_KEY = "common.save";

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
  isSidebar = false,
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

  const startEditingSubPoint = (sp: SubPoint) => {
    if (isPointLocked) return;
    setEditingId(sp.id);
    setEditText(sp.text);
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

  // Sidebar-specific visual elements
  const labelColorClass = isSidebar ? "text-blue-50/90 dark:text-blue-50/90" : SUB_POINT_LABEL_CLASS;
  const dragHandleClass = isSidebar ? "h-3 w-3 text-blue-200/60" : DRAG_HANDLE_ICON_CLASS;
  const bulletDotClass = isSidebar ? "w-1.5 h-1.5 rounded-full bg-blue-100/80 flex-shrink-0 shadow-sm" : "w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-blue-100/75 flex-shrink-0 shadow-sm dark:shadow-blue-950/20";
  
  const editButtonClass = isSidebar 
    ? "p-0.5 text-blue-200/60 hover:text-white dark:text-blue-200/60 dark:hover:text-white"
    : "p-0.5 text-slate-400 hover:text-slate-600 dark:text-blue-100/45 dark:hover:text-blue-50";
    
  const deleteButtonClass = isSidebar 
    ? "p-0.5 text-blue-200/60 hover:text-red-300 dark:text-blue-200/60 dark:hover:text-red-300"
    : "p-0.5 text-slate-400 hover:text-red-500 dark:text-blue-100/45 dark:hover:text-red-200";

  const itemClass = isSidebar
    ? "group/sp flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-medium leading-5 text-blue-50/90 dark:text-blue-50/90 transition-colors hover:bg-white/10"
    : "group/sp flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/80 dark:hover:bg-white/10";

  const inputClass = isSidebar
    ? "flex-1 px-1.5 py-0.5 text-[13px] bg-blue-950/60 border border-blue-400/30 text-white placeholder-blue-200/50 rounded focus:outline-none focus:ring-1 focus:ring-blue-300 min-w-0"
    : "flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0";

  const confirmDeleteWrapperClass = isSidebar
    ? "flex flex-col gap-1.5 py-1.5 px-2 mt-1 rounded bg-blue-950/40 border border-blue-400/20 text-xs"
    : "flex items-center gap-2 py-1.5 px-2 mt-1 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-xs";
    
  const confirmDeleteMessageClass = isSidebar
    ? "text-blue-100 flex-1"
    : "text-red-600 dark:text-red-400 flex-1";

  const confirmDeleteBtnClass = isSidebar
    ? "px-2 py-0.5 rounded bg-red-500/80 hover:bg-red-500 text-white font-medium transition-colors"
    : "px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800/40 dark:hover:bg-red-800/60 text-red-700 dark:text-red-300 font-medium transition-colors";

  const confirmDeleteCancelBtnClass = isSidebar
    ? "p-0.5 text-blue-200/70 hover:text-white"
    : SECONDARY_ICON_BUTTON_CLASS;

  const addButtonClass = isSidebar
    ? "flex items-center gap-1 pl-1.5 py-0.5 text-xs font-medium text-blue-200/70 hover:text-white transition-colors rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
    : "flex items-center gap-1 pl-1.5 py-0.5 text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50";

  const renderSubPointContent = (sp: SubPoint, dragHandleProps?: React.HTMLAttributes<HTMLElement> | null) => (
    <>
      {canReorder && dragHandleProps ? (
        <div {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)} className="cursor-grab flex-shrink-0 w-4 flex items-center justify-center touch-manipulation">
          <Bars2Icon className={dragHandleClass} />
        </div>
      ) : (
        <span className={bulletDotClass} />
      )}
      <span
        className={`flex-1 min-w-0 truncate ${isSidebar ? 'text-[13px]' : 'text-sm'} font-medium ${labelColorClass} ${isPointLocked ? "" : "cursor-text"}`}
        title={sp.text}
        onDoubleClick={() => startEditingSubPoint(sp)}
      >
        {sp.text}
      </span>
      {!isPointLocked && (
        <div className="flex w-10 flex-shrink-0 items-center justify-end gap-0.5 opacity-100 lg:opacity-40 transition-opacity lg:group-hover/sp:opacity-100">
          <button
            onClick={() => startEditingSubPoint(sp)}
            className={editButtonClass}
            aria-label={t("common.edit")}
          >
            <PencilIcon className={SMALL_ACTION_ICON_CLASS} />
          </button>
          <button
            onClick={() => handleDeleteClick(sp.id)}
            className={deleteButtonClass}
            aria-label={t(COMMON_DELETE_KEY)}
          >
            <TrashIcon className={SMALL_ACTION_ICON_CLASS} />
          </button>
        </div>
      )}
    </>
  );

  const renderSubPointItem = (sp: SubPoint, dragHandleProps?: React.HTMLAttributes<HTMLElement> | null) => {
    const ItemTag = isSidebar ? "li" : "div";
    return (
      <ItemTag className={itemClass}>
        {editingId === sp.id ? (
          <>
            {canReorder && dragHandleProps && (
              <div {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)} className="cursor-grab flex-shrink-0 w-4 flex items-center justify-center touch-manipulation">
                <Bars2Icon className={dragHandleClass} />
              </div>
            )}
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
                className={inputClass}
              />
              <button onClick={handleEditSave} className={isSidebar ? "p-0.5 text-green-300 hover:text-green-200" : "p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"} aria-label={t(COMMON_SAVE_KEY)}>
                <CheckIcon className={SMALL_ACTION_ICON_CLASS} />
              </button>
              <button onClick={() => { setEditingId(null); setEditText(""); }} className={isSidebar ? "p-0.5 text-blue-200/70 hover:text-white" : SECONDARY_ICON_BUTTON_CLASS} aria-label={t(COMMON_CANCEL_KEY)}>
                <XMarkIcon className={SMALL_ACTION_ICON_CLASS} />
              </button>
            </div>
          </>
        ) : (
          renderSubPointContent(sp, dragHandleProps)
        )}
      </ItemTag>
    );
  };

  // Clone renderer for drag preview — renders at body level, avoids clipping
  const renderClone = (provided: DraggableProvided, _snapshot: DraggableStateSnapshot, rubric: DraggableRubric) => {
    const sp = sorted[rubric.source.index];
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        className={`flex items-center gap-2 py-1 px-2 rounded-md ${isSidebar ? 'bg-blue-900 shadow-xl ring-1 ring-white/20 text-[13px]' : 'bg-white dark:bg-slate-800 shadow-lg ring-1 ring-blue-400/50 text-sm'}`}
        style={provided.draggableProps.style}
      >
        <Bars2Icon className={`${isSidebar ? dragHandleClass : DRAG_HANDLE_ICON_CLASS} flex-shrink-0`} />
        <span className={isSidebar ? labelColorClass : SUB_POINT_LABEL_CLASS}>{sp.text}</span>
      </div>
    );
  };

  const showWrapper = sorted.length > 0 || isAdding || confirmDeleteId !== null;
  const containerClass = isSidebar
    ? "ml-7 mt-1 space-y-1 border-l border-white/35 pl-3 dark:border-blue-100/35"
    : (showWrapper
        ? "ml-7 mr-4 mt-2 mb-2 max-w-[calc(100%-2.75rem)] rounded-lg border-l border-slate-300/80 bg-white/30 py-1.5 pl-3 pr-2 dark:border-blue-100/35 dark:bg-white/[0.07] transition-all duration-150"
        : "ml-7 mr-4 h-auto opacity-100 lg:h-0 lg:overflow-hidden lg:opacity-0 lg:group-hover:h-auto lg:group-hover:opacity-100 lg:group-hover/point:h-auto lg:group-hover/point:opacity-100 lg:focus-within:h-auto lg:focus-within:opacity-100 transition-all duration-150");

  const ListTag = isSidebar ? "ul" : "div";

  return (
    <ListTag className={containerClass}>
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
        <div className={confirmDeleteWrapperClass}>
          <span className={confirmDeleteMessageClass}>
            {t("structure.subPointDeleteConfirm", {
              defaultValue: "{{count}} thought(s) will be ungrouped",
              count: getAffectedThoughtCount?.(confirmDeleteId) ?? 0,
            })}
          </span>
          <div className={isSidebar ? "flex items-center justify-end gap-2" : "flex items-center gap-2"}>
            <button
              onClick={handleConfirmDelete}
              className={confirmDeleteBtnClass}
            >
              {t(COMMON_DELETE_KEY)}
            </button>
            <button
              onClick={() => setConfirmDeleteId(null)}
              className={confirmDeleteCancelBtnClass}
              aria-label={t(COMMON_CANCEL_KEY)}
            >
              <XMarkIcon className={SMALL_ACTION_ICON_CLASS} />
            </button>
          </div>
        </div>
      )}

      {!isPointLocked && (
        <div className={sorted.length > 0 ? "mt-0.5" : "py-0.5"}>
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
                className={inputClass}
              />
              <button onClick={handleAdd} className={isSidebar ? "p-0.5 text-green-300 hover:text-green-200" : "p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"} aria-label={t(COMMON_SAVE_KEY)}>
                <CheckIcon className={SMALL_ACTION_ICON_CLASS} />
              </button>
              <button onClick={() => { setIsAdding(false); setAddText(""); }} className={isSidebar ? "p-0.5 text-blue-200/70 hover:text-white" : SECONDARY_ICON_BUTTON_CLASS} aria-label={t(COMMON_CANCEL_KEY)}>
                <XMarkIcon className={SMALL_ACTION_ICON_CLASS} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className={addButtonClass}
            >
              <PlusIcon className="h-3.5 w-3.5 mr-0.5" />
              <span>{t("structure.addSubPoint", { defaultValue: "Add sub-point" })}</span>
            </button>
          )}
        </div>
      )}
    </ListTag>
  );
};;
