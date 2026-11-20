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
import React from "react";

import { ScriptureText } from '@/components/bible/ScriptureLinks';
import { NodeSketches } from "@/components/sermon/scratch/PlacedSketches";
import { usePangeaAnnouncements } from '@/hooks/useDragAnnouncements';
import { sortSubPointsByPosition } from "@/utils/subPoints";

import { getSubPointStyles } from "./subPointStyles";
import { useSubPointActions } from "./useSubPointActions";

import type { SubPoint } from "@/models/models";
import type { OutlineTitleVersion } from '@/utils/sermonNoteText';


interface SubPointListProps {
  subPoints: SubPoint[];
  outlinePointId: string;
  isPointLocked: boolean;
  onAdd: (outlinePointId: string, text: string) => void;
  onEdit: (outlinePointId: string, subPointId: string, newText: string, openingText: string, version?: OutlineTitleVersion) => Promise<unknown> | void;
  onTitleDraftChange?: (outlinePointId: string, active: boolean) => void;
  onDelete: (outlinePointId: string, subPointId: string) => void;
  onReorder?: (outlinePointId: string, sourceIndex: number, destinationIndex: number) => void;
  onEditNote?: (outlinePointId: string, subPointId: string, note?: string) => void;
  getAffectedThoughtCount?: (subPointId: string) => number;
  showNotes?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  isSidebar?: boolean;
  /** Compose the parent header with the same add state; no hover-sized empty row. */
  renderHeader?: (addButton: React.ReactNode) => React.ReactNode;
  hideList?: boolean;
}

const SMALL_ACTION_ICON_CLASS = "h-3.5 w-3.5";
const COMMON_CANCEL_KEY = "common.cancel";
const COMMON_DELETE_KEY = "common.delete";
const COMMON_SAVE_KEY = "common.save";
const SUB_POINT_ADD_KEY = "structure.addSubPoint";
const SUB_POINT_ADD_LABEL = "Add sub-point";

export const SubPointList: React.FC<SubPointListProps> = ({
  subPoints,
  outlinePointId,
  isPointLocked,
  onAdd,
  onEdit,
  onTitleDraftChange,
  onDelete,
  onReorder,
  onEditNote,
  getAffectedThoughtCount,
  showNotes = false,
  t,
  isSidebar = false,
  renderHeader,
  hideList = false,
}) => {
  // The drag hint and announcements in the interface language (BUG-20261006-library-screen-reader-words-english).
  const dragWords = usePangeaAnnouncements();
  const actions = useSubPointActions({
    subPoints, outlinePointId, isPointLocked, onAdd, onEdit, onTitleDraftChange, onDelete, getAffectedThoughtCount,
  }, !hideList);
  const {
    isAdding, addText, addInputRef, handleAdd, cancelAdd, editingId, editText, editInputRef, changeEditText,
    handleEditSave, cancelEdit, confirmDeleteId, confirmThoughtCount, confirmDelete: handleConfirmDelete,
  } = actions;
  const startEditingSubPoint = actions.startEditing;
  const handleDeleteClick = actions.requestDelete;
  const setIsAdding = (open: boolean) => (open ? actions.startAdding() : cancelAdd());
  const setConfirmDeleteId = (id: null) => { if (id === null) actions.cancelDelete(); };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    onReorder?.(outlinePointId, result.source.index, result.destination.index);
  };

  const sorted = sortSubPointsByPosition(subPoints);

  const canReorder = !isPointLocked && onReorder && sorted.length > 1;

  const styles = getSubPointStyles(isSidebar);
  const rowClass = isSidebar
    ? "flex min-w-0 w-full items-center gap-1.5"
    : "flex min-w-0 w-full items-center gap-2";

  const renderSubPointContent = (sp: SubPoint, dragHandleProps?: React.HTMLAttributes<HTMLElement> | null) => (
    <>
      {canReorder && dragHandleProps ? (
        <div {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)} className="cursor-grab flex-shrink-0 w-4 flex items-center justify-center touch-manipulation">
          <Bars2Icon className={styles.dragHandleClass} />
        </div>
      ) : (
        <span className={styles.bulletDotClass} />
      )}
      <span
        className={`flex-1 min-w-0 truncate ${styles.labelFontClass} font-medium ${styles.labelColorClass} ${isPointLocked ? "" : "cursor-text"}`}
        title={sp.text}
        onDoubleClick={() => startEditingSubPoint(sp)}
      >
        <ScriptureText text={sp.text} tone={isSidebar ? 'inherit' : 'default'} />
      </span>
      {!isPointLocked && (
        <div className="flex w-10 flex-shrink-0 items-center justify-end gap-0.5 opacity-100 lg:opacity-40 transition-opacity lg:group-hover/sp:opacity-100">
          <button type="button"
            onClick={() => startEditingSubPoint(sp)}
            className={styles.editButtonClass}
            aria-label={t("common.edit")}
          >
            <PencilIcon className={SMALL_ACTION_ICON_CLASS} />
          </button>
          <button type="button"
            onClick={() => handleDeleteClick(sp.id)}
            className={styles.deleteButtonClass}
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
    const isEditingThisSubPoint = editingId === sp.id;
    return (
      <ItemTag className={styles.itemClass}>
        <div className={rowClass}>
          {isEditingThisSubPoint ? (
            <>
              {canReorder && dragHandleProps && (
                <div {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)} className="cursor-grab flex-shrink-0 w-4 flex items-center justify-center touch-manipulation">
                  <Bars2Icon className={styles.dragHandleClass} />
                </div>
              )}
              <div className="flex-1 flex items-center gap-1">
                <input
                  ref={editingId === sp.id ? editInputRef : undefined}
                  type="text"
                  value={editText}
                  onChange={event => changeEditText(event.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditSave();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className={styles.inputClass}
                />
                <button type="button" onClick={handleEditSave} className={styles.saveBtnClass} aria-label={t(COMMON_SAVE_KEY)}>
                  <CheckIcon className={SMALL_ACTION_ICON_CLASS} />
                </button>
                <button type="button" onClick={cancelEdit} className={styles.cancelBtnClass} aria-label={t(COMMON_CANCEL_KEY)}>
                  <XMarkIcon className={SMALL_ACTION_ICON_CLASS} />
                </button>
              </div>
            </>
          ) : (
            renderSubPointContent(sp, dragHandleProps)
          )}
        </div>
        {showNotes && !isSidebar && !isEditingThisSubPoint && (
          <NodeSketches node={{ kind: 'subpoint', id: sp.id }} isReadOnly={isPointLocked} indentClass="ml-5"
            addRevealClass="opacity-100 lg:opacity-0 lg:group-hover/sp:opacity-100"
            outlineNote={{ text: sp.note, onChange: (note) => onEditNote?.(outlinePointId, sp.id, note) }} />
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
        className={styles.cloneItemClass}
        style={provided.draggableProps.style}
      >
        <Bars2Icon className={`${styles.dragHandleClass} flex-shrink-0`} />
        <span className={styles.labelColorClass}>{sp.text}</span>
      </div>
    );
  };

  const showWrapper = sorted.length > 0 || isAdding || confirmDeleteId !== null;
  const containerClass = isSidebar
    ? "ml-7 mt-1 space-y-1 border-l border-white/35 pl-3 dark:border-blue-100/35"
    : (showWrapper
        ? "ml-7 mr-4 mt-2 mb-2 max-w-[calc(100%-2.75rem)] rounded-lg border-l border-slate-300/80 bg-white/30 py-1.5 pl-3 pr-2 dark:border-blue-100/35 dark:bg-white/[0.07] transition-all duration-150"
        : "ml-7 mr-4");

  const ListTag = isSidebar ? "ul" : "div";

  const renderFirstAddButton = () => {
    if (hideList || showWrapper || isPointLocked) return null;
    return (
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        aria-label={t(SUB_POINT_ADD_KEY, { defaultValue: SUB_POINT_ADD_LABEL })}
        title={t(SUB_POINT_ADD_KEY, { defaultValue: SUB_POINT_ADD_LABEL })}
        className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-slate-400 dark:hover:text-indigo-300"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    );
  };
  const shouldShowList = () => !hideList && (showWrapper || !renderHeader)
    && !(sorted.length === 0 && isPointLocked);

  const list = shouldShowList() ? (
    <ListTag className={containerClass}>
      {sorted.length > 0 && (
        canReorder ? (
          <DragDropContext dragHandleUsageInstructions={dragWords.dragHandleUsageInstructions}
            onDragStart={dragWords.announceStart} onDragUpdate={dragWords.announceUpdate}
            onDragEnd={(result, provided) => { dragWords.announceEnd(result, provided); handleDragEnd(result); }}>
            <Droppable droppableId={`subpoints-${outlinePointId}`} renderClone={renderClone}>
              {(provided) => (
                // No sibling spacing here: the drag placeholder takes part in it and the drop lands
                // a few pixels off. Each row carries its own gap instead (.howto/drag-and-drop.md).
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {sorted.map((sp, index) => (
                    <Draggable key={sp.id} draggableId={`sp-drag-${sp.id}`} index={index}>
                      {(draggableProvided) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className="mb-0.5"
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
        <div className={styles.confirmDeleteWrapperClass}>
          <span className={styles.confirmDeleteMessageClass}>
            {confirmThoughtCount > 0
              ? t("structure.subPointDeleteConfirm", {
                  defaultValue: "{{count}} thought(s) will be ungrouped",
                  count: confirmThoughtCount,
                })
              : t("structure.subPointDeleteTextConfirm")}
          </span>
          <div className={styles.confirmDeleteRowClass}>
            <button type="button"
              onClick={handleConfirmDelete}
              className={styles.confirmDeleteBtnClass}
            >
              {t(COMMON_DELETE_KEY)}
            </button>
            <button type="button"
              onClick={() => setConfirmDeleteId(null)}
              className={styles.confirmDeleteCancelBtnClass}
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
                onChange={(e) => actions.setAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") cancelAdd();
                }}
                placeholder={t("structure.subPointPlaceholder", { defaultValue: "Sub-point name..." })}
                className={styles.inputClass}
              />
              <button type="button" onClick={handleAdd} className={styles.saveBtnClass} aria-label={t(COMMON_SAVE_KEY)}>
                <CheckIcon className={SMALL_ACTION_ICON_CLASS} />
              </button>
              <button type="button" onClick={cancelAdd} className={styles.cancelBtnClass} aria-label={t(COMMON_CANCEL_KEY)}>
                <XMarkIcon className={SMALL_ACTION_ICON_CLASS} />
              </button>
            </div>
          ) : (
            <button type="button"
              onClick={() => setIsAdding(true)}
              className={styles.addButtonClass}
            >
              <PlusIcon className="h-3.5 w-3.5 mr-0.5" />
              <span>{t(SUB_POINT_ADD_KEY, { defaultValue: SUB_POINT_ADD_LABEL })}</span>
            </button>
          )}
        </div>
      )}
    </ListTag>
  ) : null;

  return <>{renderHeader?.(renderFirstAddButton())}{list}</>;

};
