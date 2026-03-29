"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { PlusIcon, PencilIcon, CheckIcon, XMarkIcon, TrashIcon, Bars3Icon, ArrowUturnLeftIcon, SparklesIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import { MicrophoneIcon, SwitchViewIcon } from "@/components/Icons";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSectionLabel } from "@/lib/sections";
import { Item, SermonPoint } from "@/models/models";
import { getOutlinePointAiSortState } from "@/utils/aiSorting";
import { debugLog } from "@/utils/debugMode";
import { UI_COLORS } from "@/utils/themeColors";

import { AudioRecorder } from "./AudioRecorder";
import { recordAudioThought } from "./column/audio";
import { SubPointList } from "./column/SubPointList";
import {
  BG_GRAY_LIGHT_DARK,
  BG_GRAY_LIGHTER_DARK,
  DEFAULT_ALL_POINTS_BLOCKED_TEXT,
  DEFAULT_RECORD_AUDIO_TEXT,
  DEFAULT_UNASSIGNED_THOUGHTS_TEXT,
  INLINE_EDIT_ACTION_BUTTON_BASE_CLASS,
  TRANSLATION_COMMON_CANCEL,
  TRANSLATION_COMMON_DELETE,
  TRANSLATION_COMMON_SAVE,
  TRANSLATION_STRUCTURE_ADD_THOUGHT,
  TRANSLATION_STRUCTURE_ALL_POINTS_BLOCKED,
  TRANSLATION_STRUCTURE_RECORD_AUDIO,
  TRANSLATION_STRUCTURE_UNASSIGNED_THOUGHTS,
} from "./column/constants";
import { DeletePointConfirmModal } from "./column/DeletePointConfirmModal";
import { useColumnOutlineState } from "./column/useColumnOutlineState";
import {
  getAdjacentSectionIds,
  getOutlineInsertAccent,
  getPlaceholderColors,
  getPointLockToggleLabel,
  getSectionBorderColor,
  getSectionHeaderBgStyle,
  isPendingItem,
  isPointAudioSection,
  openPointEditor,
} from "./column/utils";
import ExportButtons from "./ExportButtons";
import FocusModeLayout from "./FocusModeLayout";
import { FocusRecorderButton } from "./FocusRecorderButton";
import FocusSidebar from "./FocusSidebar";
import { OutlinePointGuidanceTooltip, SermonSectionGuidanceTooltip } from "./SermonGuidanceTooltips";
import SortableItem from "./SortableItem";

import type { ColumnProps, OnAudioThoughtCreated, Translate } from "./column/types";


// Component for rendering outline point placeholder with thoughts
const SermonPointPlaceholder: React.FC<{
  point: SermonPoint;
  items: Item[];
  containerId: string;
  onEdit?: (item: Item) => void;
  isHighlighted: (itemId: string) => boolean;
  getHighlightType: (itemId: string) => 'assigned' | 'moved' | undefined;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  onTogglePointLock?: (outlinePointId: string, isLocked: boolean) => Promise<void> | void;
  onToggleThoughtLock?: (thoughtId: string, isLocked: boolean) => Promise<void> | void;
  onToggleReviewed?: (outlinePointId: string, isReviewed: boolean) => Promise<void> | void;
  headerColor?: string;
  t: Translate;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  sermonId?: string;
  onAudioThoughtCreated?: OnAudioThoughtCreated;
  isFocusMode?: boolean;
  onAddThought?: (sectionId: string, outlinePointId?: string) => void;
  sectionTitle?: string;
  setAudioError: (error: string | null) => void;
  onRetryPendingThought?: (itemId: string) => void;
  onAiSortPoint?: (outlinePointId: string) => void;
  isOnline: boolean;
  isSorting?: boolean;
  isSortReviewPending?: boolean;
  sortingOutlinePointId?: string | null;
  // Drag handle props for normal mode reordering
  dragHandleProps?: React.HTMLAttributes<HTMLElement> | null;
  onEditPoint?: (point: SermonPoint) => void;
  onDeletePoint?: (pointId: string) => void;
  // For inline edit in normal mode
  onSaveEdit?: (pointId: string, newText: string) => void;
  // Sub-point operations
  onAddSubPoint?: (outlinePointId: string, text: string) => void;
  onEditSubPoint?: (outlinePointId: string, subPointId: string, newText: string) => void;
  onDeleteSubPoint?: (outlinePointId: string, subPointId: string) => void;
  onReorderSubPoints?: (outlinePointId: string, sourceIndex: number, destinationIndex: number) => void;
}> = ({
  point,
  items,
  containerId,
  onEdit,
  isHighlighted,
  getHighlightType,
  onKeepItem,
  onRevertItem,
  onTogglePointLock,
  onToggleThoughtLock,
  onToggleReviewed,
  headerColor,
  t,
  activeId,
  onMoveToAmbiguous,
  sermonId,
  onAudioThoughtCreated,
  isFocusMode,
  onAddThought,
  sectionTitle,
  setAudioError,
  onRetryPendingThought,
  onAiSortPoint,
  isOnline,
  isSorting = false,
  isSortReviewPending = false,
  sortingOutlinePointId,
  dragHandleProps,
  onEditPoint,
  onDeletePoint,
  onSaveEdit,
  onAddSubPoint,
  onEditSubPoint,
  onDeleteSubPoint,
  onReorderSubPoints,
  // eslint-disable-next-line sonarjs/cognitive-complexity -- dense UI component with multiple conditional controls
}) => {
    const { setNodeRef, isOver } = useDroppable({
      id: `outline-point-${point.id}`,
      data: { container: containerId, outlinePointId: point.id }
    });

    const pointItems = items.filter(item => item.outlinePointId === point.id);
    const hasItems = pointItems.length > 0;
    const isPointLocked = hasItems && pointItems.every((item) => item.isLocked);
    const aiSortState = getOutlinePointAiSortState({
      items,
      outlinePointId: point.id,
      isOnline,
      isSorting,
      isDiffModeActive: isSortReviewPending,
    });
    const isSortingThisPoint = isSorting && sortingOutlinePointId === point.id;

    const colors = getPlaceholderColors(containerId, headerColor);

    // Local state for audio recording (per outline point)
    const [isRecordingAudio, setIsRecordingAudio] = React.useState<boolean>(false);

    // Local inline edit state (normal mode)
    const [isEditingLocally, setIsEditingLocally] = React.useState(false);
    const [localEditText, setLocalEditText] = React.useState(point.text);
    const localEditRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
      if (isEditingLocally && localEditRef.current) {
        localEditRef.current.focus();
        localEditRef.current.select();
      }
    }, [isEditingLocally]);

    const handleLocalSave = () => {
      if (!localEditText.trim()) {
        setIsEditingLocally(false);
        setLocalEditText(point.text);
        return;
      }
      onSaveEdit?.(point.id, localEditText.trim());
      setIsEditingLocally(false);
    };

    const handleLocalCancel = () => {
      setIsEditingLocally(false);
      setLocalEditText(point.text);
    };

    const pointLockToggleLabel = getPointLockToggleLabel(isPointLocked, t);
    const pointToggleHandler = onTogglePointLock ?? onToggleReviewed;
    const canUseInlineRecorder = Boolean(sermonId && isPointAudioSection(containerId));
    const aiSortTooltip = (() => {
      if (isSortingThisPoint) {
        return t("structure.sorting", { defaultValue: "Sorting..." });
      }
      switch (aiSortState.disabledReason) {
        case "offline":
          return t("structure.aiSortPointDisabledOffline", {
            defaultValue: "AI sorting is unavailable offline.",
          });
        case "sorting":
          return t("structure.aiSortPointDisabledSorting", {
            defaultValue: "AI sorting is already running.",
          });
        case "review":
          return t("structure.aiSortPointDisabledReview", {
            defaultValue: "Review or revert current AI suggestions first.",
          });
        case "pending":
          return t("structure.aiSortPointDisabledPending", {
            defaultValue: "Finish syncing local thoughts in this outline point first.",
          });
        case "tooMany":
          return t("structure.aiSortPointDisabledTooMany", {
            defaultValue: "AI sorting supports up to 25 thoughts in one outline point.",
          });
        case "insufficientUnlocked":
          return t("structure.aiSortPointDisabledTooFewUnlocked", {
            defaultValue: "Need at least 2 unlocked thoughts in this outline point.",
          });
        default:
          return t("structure.aiSortPoint", {
            defaultValue: "Sort this outline point with AI. Locked thoughts stay fixed.",
          });
      }
    })();

    return (
      <>
        <div
          className={`${colors.border} ${colors.bg} rounded-lg transition duration-200 ${isOver ? 'ring-2 ring-blue-400 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'
            }`}
          style={headerColor ? { borderColor: headerColor } : {}}
        >
          {/* SermonOutline point header */}
          <div
            className={`px-4 py-2 rounded-t-lg border-b border-opacity-20 dark:border-opacity-30 ${headerColor ? BG_GRAY_LIGHTER_DARK : colors.header}`}
            style={headerColor ? { backgroundColor: `${headerColor}20` } : {}}
          >
            <div className="flex items-center justify-between gap-1.5 w-full">
              {/* Drag handle for normal mode reordering */}
              {dragHandleProps && (
                <div
                  {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)}
                  className={isPointLocked ? "hidden" : `cursor-grab opacity-50 hover:opacity-90 flex-shrink-0 transition-opacity ${colors.headerText}`}
                  title={!isPointLocked ? t('common.dragToReorder', { defaultValue: 'Drag to reorder' }) : undefined}
                >
                  {!isPointLocked && <Bars3Icon className="h-4 w-4" />}
                </div>
              )}

              {/* Inline edit form or click-to-edit title */}
              {isEditingLocally ? (
                <div className="flex-1 flex items-center gap-1 min-w-0">
                  <input
                    ref={localEditRef}
                    type="text"
                    value={localEditText}
                    onChange={(e) => setLocalEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLocalSave(); if (e.key === 'Escape') handleLocalCancel(); }}
                    className="flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
                  />
                  <button aria-label={t(TRANSLATION_COMMON_SAVE)} onClick={handleLocalSave} className={`${INLINE_EDIT_ACTION_BUTTON_BASE_CLASS} text-green-600 hover:text-green-700 dark:text-green-400`}>
                    <CheckIcon className="h-4 w-4" />
                  </button>
                  <button aria-label={t(TRANSLATION_COMMON_CANCEL)} onClick={handleLocalCancel} className={`${INLINE_EDIT_ACTION_BUTTON_BASE_CLASS} text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200`}>
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <h4
                    onClick={() => openPointEditor({
                      point,
                      isLocked: isPointLocked,
                      isFocusMode,
                      setLocalEditText,
                      setIsEditingLocally,
                      onEditPoint,
                    })}
                    className={`font-medium text-sm min-w-0 truncate select-none ${isPointLocked ? 'cursor-default' : 'cursor-text hover:bg-black/5 dark:hover:bg-white/10 rounded px-1 -mx-1 transition-colors'} ${headerColor ? 'text-gray-800 dark:text-gray-200' : colors.headerText}`}
                    title={!isPointLocked ? t('common.clickToEdit', { defaultValue: 'Click to edit' }) : undefined}
                  >
                    {point.text}
                  </h4>
                  {isFocusMode && onAiSortPoint && (
                    <button
                      type="button"
                      onClick={() => onAiSortPoint(point.id)}
                      disabled={aiSortState.disabledReason !== null}
                      title={aiSortTooltip}
                      aria-label={aiSortTooltip}
                      data-testid={`outline-point-ai-sort-${point.id}`}
                      className={`p-1 rounded-full border transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:focus-visible:ring-amber-300 ${
                        isSortingThisPoint
                          ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-200 border-amber-300 dark:border-amber-700"
                          : aiSortState.disabledReason
                            ? "bg-white/10 text-gray-400 dark:text-gray-500 border-white/10 cursor-not-allowed opacity-60"
                            : "bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-200 border-amber-200 dark:border-amber-700"
                      }`}
                    >
                      {isSortingThisPoint ? (
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <SparklesIcon className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  {/* Delete button (only if not reviewed, not focus mode) - Moved next to text */}
                  {!isFocusMode && onDeletePoint && !isPointLocked && (
                    <button
                      aria-label={t(TRANSLATION_COMMON_DELETE)}
                      onClick={() => onDeletePoint(point.id)}
                      className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 rounded transition-colors flex-shrink-0"
                      title={t(TRANSLATION_COMMON_DELETE)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Right-side actions and info */}
              <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 select-none">

                {/* Toggle point lock status button */}
                {pointToggleHandler && hasItems && (
                  <button
                    onClick={() => void pointToggleHandler?.(point.id, !isPointLocked)}
                    className={`p-1.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300 flex-shrink-0 ${isPointLocked
                      ? 'bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-700 dark:text-green-300'
                      : 'bg-white/20 hover:bg-white/30 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    title={pointLockToggleLabel}
                    aria-label={pointLockToggleLabel}
                  >
                    <CheckIcon className={`h-3.5 w-3.5 ${isPointLocked ? 'text-green-700 dark:text-green-300' : ''}`} />
                  </button>
                )}

                {/* Quick help for outline point */}
                {containerId === 'main' && (
                  <div className="flex-shrink-0">
                    <OutlinePointGuidanceTooltip t={t} popoverAlignment="right" />
                  </div>
                )}

                <span className={`text-xs whitespace-nowrap flex-shrink-0 ${headerColor ? 'text-gray-600 dark:text-gray-400' : colors.headerText} opacity-70`}>
                  {pointItems.length} {pointItems.length === 1 ? t('structure.thought') : t('structure.thoughts')}
                </span>

                {/* Focus Recorder Button (per outline point) */}
                {isFocusMode && onAddThought && (
                  <button
                    onClick={() => {
                      debugLog('Structure: focus outline add clicked', {
                        sectionId: containerId,
                        outlinePointId: point.id,
                        isFocusMode,
                        sermonId,
                      });
                    onAddThought?.(containerId, point.id);
                  }}
                    disabled={isPointLocked}
                    className={`w-[30px] h-[30px] flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:focus-visible:ring-green-300 flex items-center justify-center ${isPointLocked ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed opacity-50' : 'bg-gray-400 hover:bg-green-500'}`}
                    title={isPointLocked ? t('structure.pointLocked', { defaultValue: 'All thoughts in this outline point are locked' }) : t(TRANSLATION_STRUCTURE_ADD_THOUGHT, { section: sectionTitle || containerId })}
                    aria-label={isPointLocked ? t('structure.pointLocked', { defaultValue: 'All thoughts in this outline point are locked' }) : t(TRANSLATION_STRUCTURE_ADD_THOUGHT, { section: sectionTitle || containerId })}
                  >
                    <PlusIcon className="h-4 w-4 text-white" />
                  </button>
                )}

                {canUseInlineRecorder && (
                  <>
                    <FocusRecorderButton
                      size="small"
                      disabled={isPointLocked}
                      onRecordingComplete={(audioBlob) => {
                        if (!sermonId) return;
                        void recordAudioThought({
                          audioBlob,
                          sectionId: containerId,
                          sermonId,
                          pointId: point.id,
                          setIsRecordingAudio,
                          setAudioError,
                          onAudioThoughtCreated,
                          t,
                          errorContext: "Error recording audio for outline point:",
                        });
                      }}
                      isProcessing={isRecordingAudio}
                      onError={(err) => {
                        setAudioError(err);
                        setIsRecordingAudio(false);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Drop zone for thoughts */}
          <div
            ref={setNodeRef}
            className={`min-h-[80px] p-4 transition-all ${isOver ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400 dark:ring-blue-500' : ''
              }`}
          >
            {!hasItems ? (
              <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-6 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all">
                {t('structure.dropThoughtsHere')}
              </div>
            ) : (
              <SortableContext items={pointItems} strategy={verticalListSortingStrategy}>
                <div className="space-y-4">
                  {pointItems.map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      containerId={containerId}
                      onEdit={onEdit}
                      isHighlighted={isHighlighted(item.id)}
                      highlightType={getHighlightType(item.id)}
                      onKeep={onKeepItem}
                      onRevert={onRevertItem}
                      activeId={activeId}
                      onMoveToAmbiguous={onMoveToAmbiguous}
                      onRetrySync={onRetryPendingThought}
                      onToggleLock={onToggleThoughtLock}
                      isLocked={Boolean(item.isLocked)}
                      disabled={isPendingItem(item)}
                    />
                  ))}

                  {/* Additional drop area at the end */}
                  <div className={`text-center text-gray-400 dark:text-gray-500 text-sm py-4 mt-2 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all ${isOver ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}>
                    {t('structure.dropThoughtsToAdd')}
                  </div>
                </div>
              </SortableContext>
            )}
          </div>

          {/* Sub-points list */}
          {onAddSubPoint && (
            <SubPointList
              subPoints={point.subPoints ?? []}
              outlinePointId={point.id}
              isPointLocked={isPointLocked}
              onAdd={onAddSubPoint}
              onEdit={onEditSubPoint!}
              onDelete={onDeleteSubPoint!}
              onReorder={onReorderSubPoints}
              t={t}
            />
          )}
        </div>
      </>
    );
  };

// Component for rendering unassigned thoughts drop target
const UnassignedThoughtsDropTarget: React.FC<{
  items: Item[];
  containerId: string;
  onEdit?: (item: Item) => void;
  isHighlighted: (itemId: string) => boolean;
  getHighlightType: (itemId: string) => 'assigned' | 'moved' | undefined;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  t: Translate;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onRetryPendingThought?: (itemId: string) => void;
  onToggleThoughtLock?: (thoughtId: string, isLocked: boolean) => Promise<void> | void;
}> = ({
  items,
  containerId,
  onEdit,
  isHighlighted,
  getHighlightType,
  onKeepItem,
  onRevertItem,
  t,
  activeId,
  onMoveToAmbiguous,
  onRetryPendingThought,
  onToggleThoughtLock,
}) => {
    const { setNodeRef, isOver } = useDroppable({
      id: `unassigned-${containerId}`,
      data: { container: containerId, outlinePointId: null } // null means unassigned
    });

    return (
      <div
        ref={setNodeRef}
        className={`min-h-[80px] p-4 transition-all rounded-lg ${isOver ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400 dark:ring-blue-500' : BG_GRAY_LIGHT_DARK
          }`}
      >
        {items.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-6 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all">
            {t('structure.dropToUnassign', { defaultValue: 'Drop thoughts here to unassign them from outline points' })}
          </div>
        ) : (
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {items.map((item) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  containerId={containerId}
                  onEdit={onEdit}
                  isHighlighted={isHighlighted(item.id)}
                  highlightType={getHighlightType(item.id)}
                  onKeep={onKeepItem}
                  onRevert={onRevertItem}
                  activeId={activeId}
                  onMoveToAmbiguous={onMoveToAmbiguous}
                  onRetrySync={onRetryPendingThought}
                  onToggleLock={onToggleThoughtLock}
                  isLocked={Boolean(item.isLocked)}
                  disabled={isPendingItem(item)}
                />
              ))}

              {/* Additional drop area at the end for consistency */}
              <div className={`text-center text-gray-400 dark:text-gray-500 text-sm py-4 mt-2 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all ${isOver ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' : ''
                }`}>
                {t('structure.dropToUnassign')}
              </div>
            </div>
          </SortableContext>
        )}
      </div>
    );
  };

export default function Column({
  id,
  title,
  items,
  headerColor,
  onEdit,
  outlinePoints: initialSermonPoints = [], // Rename prop for clarity
  showFocusButton = false,
  isFocusMode = false,
  onToggleFocusMode,
  onAiSortPoint,
  isLoading = false,
  sortingOutlinePointId,
  className = "",
  getExportContent,
  sermonId,
  onAddThought,
  onOutlineUpdate, // Destructure the new callback
  thoughtsPerSermonPoint = {}, // Destructure the new prop with a default value
  // New props for AI sort with interactive confirmation
  isDiffModeActive = false,
  highlightedItems = {},
  onKeepItem,
  onRevertItem,
  onKeepAll,
  onRevertAll,
  activeId,
  onMoveToAmbiguous,
  onAudioThoughtCreated,
  onTogglePointLock,
  onToggleThoughtLock,
  onToggleReviewed,
  onSwitchPage,
  onNavigateToSection,
  onRetryPendingThought,
  planData,
  onOutlinePointDeleted,
  onAddOutlinePoint
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const [showTooltip, setShowTooltip] = useState<boolean>(false);

  // State for responsive sidebar visibility on small screens
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);

  // Calculate counts for assigned and unassigned items
  const assignedItems = items.filter(item => item.outlinePointId).length;
  const unassignedItems = items.length - assignedItems;

  // Calculate if this column has any highlighted items
  const hasHighlightedItems = items.some(item => item.id in highlightedItems);

  const {
    localSermonPoints,
    editingPointId,
    editingText,
    setEditingText,
    addingNewPoint,
    newPointText,
    setNewPointText,
    insertPointIndex,
    insertPointText,
    setInsertPointText,
    isGeneratingSermonPoints,
    deletePointId,
    setDeletePointId,
    pointToDeleteDetail,
    editInputRef,
    addInputRef,
    insertInputRef,
    startAddingNewPoint,
    cancelAddingNewPoint,
    handleAddPoint,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleSaveEditDirect,
    confirmDeletePoint,
    openInsertPointForm,
    closeInsertPointForm,
    handleInsertSave,
    handleDragEnd,
    handleGenerateSermonPoints,
    // Sub-point operations
    handleAddSubPoint,
    handleEditSubPoint,
    handleDeleteSubPoint,
    handleReorderSubPoints,
  } = useColumnOutlineState({
    id,
    sermonId,
    initialSermonPoints,
    isOnline,
    onOutlineUpdate,
    onOutlinePointDeleted,
    onAddOutlinePoint,
    t,
  });

  const pointLockState = React.useMemo(() => {
    return localSermonPoints.reduce<Record<string, { hasThoughts: boolean; isLocked: boolean }>>((acc, point) => {
      const pointItems = items.filter((item) => item.outlinePointId === point.id);
      acc[point.id] = {
        hasThoughts: pointItems.length > 0,
        isLocked: pointItems.length > 0 && pointItems.every((item) => item.isLocked),
      };
      return acc;
    }, {});
  }, [items, localSermonPoints]);

  const isPointLocked = (pointId: string) => pointLockState[pointId]?.isLocked ?? false;
  const resolvedPointToggleHandler = onTogglePointLock ?? onToggleReviewed;

  const allPointsBlocked = localSermonPoints.length > 0 && localSermonPoints.every((point) => {
    const pointState = pointLockState[point.id];
    return Boolean(pointState?.hasThoughts && pointState.isLocked);
  });

  // --- State for Audio Recording ---
  const [isRecordingAudio, setIsRecordingAudio] = useState<boolean>(false);
  const [showAudioPopover, setShowAudioPopover] = useState<boolean>(false);
  const [, setAudioError] = useState<string | null>(null);
  const normalModePopoverRef = useRef<HTMLDivElement | null>(null);

  // Close normal-mode recorder popover on outside click
  useEffect(() => {
    if (!showAudioPopover) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (!normalModePopoverRef.current) return;
      const target = e.target as Node | null;
      if (target && !normalModePopoverRef.current.contains(target)) {
        setShowAudioPopover(false);
      }
    };
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('touchstart', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('touchstart', handleOutside, true);
    };
  }, [showAudioPopover]);

  // Always use vertical list strategy regardless of focus mode
  const sortingStrategy = verticalListSortingStrategy;

  const headerBgStyle = getSectionHeaderBgStyle(id, headerColor);
  const borderColor = getSectionBorderColor(id, headerColor);
  const outlineInsertAccent = getOutlineInsertAccent(id);

  // Helper functions for highlighting
  const isItemHighlighted = (itemId: string) => itemId in highlightedItems;
  const getItemHighlightType = (itemId: string) => highlightedItems[itemId]?.type;

  // Filter unassigned items (not linked to any outline point)
  const unassignedItemsForDisplay = items.filter(item => !item.outlinePointId);

  const renderUnassignedThoughtsSection = (sectionItems: Item[]) => (
    <div className="mt-8">
      <div className={`border-t ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} pt-6`}>
        <h4 className={`text-sm font-medium ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} mb-4`}>
          {t(TRANSLATION_STRUCTURE_UNASSIGNED_THOUGHTS, { defaultValue: DEFAULT_UNASSIGNED_THOUGHTS_TEXT })} ({sectionItems.length})
        </h4>
        <UnassignedThoughtsDropTarget
          items={sectionItems}
          containerId={id}
          onEdit={onEdit}
          isHighlighted={isItemHighlighted}
          getHighlightType={getItemHighlightType}
          onKeepItem={onKeepItem}
          onRevertItem={onRevertItem}
          t={t}
          activeId={activeId}
          onMoveToAmbiguous={onMoveToAmbiguous}
          onRetryPendingThought={onRetryPendingThought}
          onToggleThoughtLock={onToggleThoughtLock}
        />
      </div>
    </div>
  );

  const renderFocusSidebarHeader = () => {
    const { previousSectionId, nextSectionId } = getAdjacentSectionIds(id);

    return (
      <div className="flex items-center justify-between w-full">
        {previousSectionId && onNavigateToSection ? (
          <button
            onClick={() => onNavigateToSection(previousSectionId)}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-200 hover:scale-110 active:scale-95 group shrink-0"
            title={t('common.previous')}
          >
            <ChevronLeftIcon className="h-5 w-5 opacity-70 group-hover:opacity-100" />
          </button>
        ) : <div className="w-8 shrink-0" />}

        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
          <h2 className="text-xl font-bold text-white dark:text-gray-100 truncate">
            {title}
          </h2>
          <div className="shrink-0">
            {id === 'introduction' && (
              <SermonSectionGuidanceTooltip t={t} section="introduction" popoverAlignment="left" />
            )}
            {id === 'conclusion' && (
              <SermonSectionGuidanceTooltip t={t} section="conclusion" popoverAlignment="left" />
            )}
          </div>
        </div>

        {nextSectionId && onNavigateToSection ? (
          <button
            onClick={() => onNavigateToSection(nextSectionId)}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-200 hover:scale-110 active:scale-95 group shrink-0"
            title={t('common.next')}
          >
            <ChevronRightIcon className="h-5 w-5 opacity-70 group-hover:opacity-100" />
          </button>
        ) : <div className="w-8 shrink-0" />}
      </div>
    );
  };

  const renderFocusSidebarActions = () => (
    <div className="space-y-3">
      {showFocusButton && (
        <button
          onClick={() => onToggleFocusMode?.(id)}
          className="relative w-full px-4 py-2.5 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm flex items-center justify-center overflow-hidden isolation-auto"
        >
          <div className={`absolute inset-0 ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}></div>
          <div className={`relative flex items-center justify-center ${UI_COLORS.neutral.text} dark:${UI_COLORS.neutral.darkText} z-10`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('structure.normalMode')}
          </div>
        </button>
      )}

      {/* Audio Recorder for Focus Mode */}
      {isFocusMode && sermonId && (
        <div className="mt-3">
          <AudioRecorder
            variant="mini"
            hideKeyboardShortcuts={true}
            disabled={allPointsBlocked}
            onRecordingComplete={(audioBlob) => {
              const sectionLabel = isPointAudioSection(id) ? getSectionLabel(t, id) : undefined;
              void recordAudioThought({
                audioBlob,
                sectionId: id,
                sermonId,
                setIsRecordingAudio,
                setAudioError,
                onAudioThoughtCreated,
                t,
                successMessage: sectionLabel
                  ? `Запись добавлена в раздел "${sectionLabel}"`
                  : undefined,
                errorContext: "Error recording audio thought:",
              });
            }}
            isProcessing={isRecordingAudio}
            onError={(error) => {
              setAudioError(error);
              setIsRecordingAudio(false);
            }}
          />
        </div>
      )}

      {/* Global accept/reject buttons for AI sort - only show when in diff mode and there are highlighted items */}
      {
        isDiffModeActive && hasHighlightedItems && (
          <div className="space-y-2 mt-3 pt-3 border-t border-white dark:border-gray-600 border-opacity-30 dark:border-opacity-30">
            <h3 className="text-sm font-medium text-white dark:text-gray-100 mb-2">
              {t('structure.aiSuggestions', { defaultValue: 'AI Suggestions' })}
            </h3>

            {/* Accept all button */}
            <button
              onClick={() => onKeepAll?.(id)}
              className="w-full px-4 py-2 text-sm font-medium rounded-md bg-green-600 dark:bg-green-700 text-white hover:bg-green-500 dark:hover:bg-green-600 transition-colors shadow-sm flex items-center justify-center"
            >
              <CheckIcon className="h-4 w-4 mr-2" />
              {t('structure.acceptAllChanges', { defaultValue: 'Accept all remaining' })}
            </button>

            {/* Reject all button */}
            <button
              onClick={() => onRevertAll?.(id)}
              className="w-full px-4 py-2 text-sm font-medium rounded-md bg-orange-600 dark:bg-orange-700 text-white hover:bg-orange-500 dark:hover:bg-orange-600 transition-colors shadow-sm flex items-center justify-center"
            >
              <ArrowUturnLeftIcon className="h-4 w-4 mr-2" />
              {t('structure.rejectAllChanges', { defaultValue: 'Reject all suggestions' })}
            </button>
          </div>
        )
      }

      {
        getExportContent && sermonId && (
          <div className="mt-4 flex justify-center">
            <ExportButtons
              getExportContent={getExportContent}
              sermonId={sermonId}
              className="inline-flex"
              orientation="horizontal"
              planData={planData}
              focusedSection={isFocusMode ? id : undefined}
              sermonTitle={planData?.sermonTitle ?? title}
            />
          </div>
        )
      }
    </div >
  );

  const renderFocusSidebarPoints = () => (
    <div className="p-5 flex-grow overflow-y-auto flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-white dark:text-gray-100">{t('structure.outlinePoints')}</h3>

        {/* Generate outline points button */}
        {sermonId && (
          <button
            onClick={handleGenerateSermonPoints}
            disabled={isGeneratingSermonPoints || localSermonPoints.length > 0}
            className={`flex items-center text-xs font-medium px-2 py-1 bg-white dark:bg-gray-200 bg-opacity-20 dark:bg-opacity-20 rounded transition-colors ${localSermonPoints.length > 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-opacity-30 dark:hover:bg-opacity-30'} text-white dark:text-gray-800`}
            title={localSermonPoints.length > 0
              ? t('structure.outlinePointsExist', { defaultValue: 'SermonOutline points already exist' })
              : t('structure.generateSermonPoints', { defaultValue: 'Generate outline points' })}
          >
            {isGeneratingSermonPoints ? (
              <svg className="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <SparklesIcon className="h-3 w-3 mr-1" />
            )}
            {isGeneratingSermonPoints ? t('common.generating', { defaultValue: 'Generating...' }) : t('structure.generate', { defaultValue: 'Generate' })}
          </button>
        )}
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId={`outline-${id}`}>
          {(provided) => (
            <ul
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="flex-grow"
            >
              {localSermonPoints.map((point, index) => {
                const pointLocked = isPointLocked(point.id);
                return (
                <Draggable key={point.id} draggableId={point.id} index={index}>
                  {(providedDraggable, snapshot) => (
                    <li
                      ref={providedDraggable.innerRef}
                      {...providedDraggable.draggableProps}
                      className={`relative group rounded p-2 mb-2 ${snapshot.isDragging ? 'bg-white/30 dark:bg-gray-200/30 shadow-md' : 'hover:bg-white/15 dark:hover:bg-gray-200/15'}`}
                      style={providedDraggable.draggableProps.style}
                    >
                      <div className="flex items-center">
                        {/* Drag handle */}
                        {!pointLocked && (
                          <div {...providedDraggable.dragHandleProps} className="cursor-grab mr-2 text-white dark:text-gray-100">
                            <Bars3Icon className="h-5 w-5" />
                          </div>
                        )}
                        {pointLocked && <div className="mr-2 h-5 w-5 shrink-0" />}

                        {/* Edit form or display */}
                        {editingPointId === point.id ? (
                          <div className="flex-grow flex items-center space-x-1">
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit(); }}
                              className="flex-grow p-1 text-sm bg-white/90 dark:bg-gray-100/90 text-gray-800 dark:text-gray-800 rounded border border-white/30 dark:border-gray-300 focus:outline-none focus:border-white dark:focus:border-gray-400"
                              placeholder={t('structure.editPointPlaceholder')}
                              autoFocus
                            />
                            <button aria-label={t(TRANSLATION_COMMON_SAVE)} onClick={handleSaveEdit} className="p-1 text-green-400 hover:text-green-300">
                              <CheckIcon className="h-5 w-5" />
                            </button>
                            <button aria-label={t(TRANSLATION_COMMON_CANCEL)} onClick={handleCancelEdit} className="p-1 text-red-400 hover:text-red-300">
                              <XMarkIcon className="h-5 w-5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-1 min-w-0 items-center gap-2 mr-2">
                              <span
                                className="text-sm text-white dark:text-gray-100 flex-1 min-w-0 truncate"
                                onDoubleClick={() => {
                                  if (!pointLocked) handleStartEdit(point);
                                }}
                              >
                                {point.text}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex-shrink-0">
                              {!pointLocked && (
                                <>
                                  <button aria-label={t('common.edit')} onClick={() => handleStartEdit(point)} className="p-1 text-white/70 dark:text-gray-400 hover:text-white dark:hover:text-gray-200">
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button aria-label={t('common.delete')} onClick={() => setDeletePointId(point.id)} className="p-1 text-white/70 dark:text-gray-400 hover:text-white dark:hover:text-gray-200">
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                            {thoughtsPerSermonPoint[point.id] > 0 && (
                              <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-xs leading-none align-middle tabular-nums text-gray-700 dark:bg-gray-200 dark:text-gray-700 flex-shrink-0">
                                {thoughtsPerSermonPoint[point.id]}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {/* Sub-points in sidebar */}
                      {point.subPoints && point.subPoints.length > 0 && (
                        <ul className="ml-7 mt-0.5 space-y-0.5 border-l border-white/20 pl-2">
                          {[...point.subPoints].sort((a, b) => a.position - b.position).map((sp) => (
                            <li key={sp.id} className="flex items-center gap-1.5 text-xs text-white/50 dark:text-gray-500 truncate">
                              <span className="w-1 h-1 rounded-full bg-white/40 flex-shrink-0" />
                              {sp.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )}
                </Draggable>
              )})}
              {provided.placeholder}

	              {addingNewPoint ? (
	                <div className="mt-2 flex items-center space-x-1">
	                  <input
	                    ref={addInputRef}
	                    type="text"
	                    value={newPointText}
	                    onChange={(e) => setNewPointText(e.target.value)}
	                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddPoint(); if (e.key === 'Escape') cancelAddingNewPoint(); }}
	                    placeholder={t('structure.addPointPlaceholder')}
	                    className="flex-grow p-2 text-sm bg-white/90 dark:bg-gray-100/90 text-gray-800 dark:text-gray-800 rounded border border-white/30 dark:border-gray-300 focus:outline-none focus:border-white dark:focus:border-gray-400"
	                    autoFocus
                  />
                  <button aria-label={t(TRANSLATION_COMMON_SAVE)} onClick={handleAddPoint} className="p-1 text-green-400 hover:text-green-300">
                    <CheckIcon className="h-5 w-5" />
                  </button>
	                  <button aria-label={t(TRANSLATION_COMMON_CANCEL)} onClick={cancelAddingNewPoint} className="p-1 text-red-400 hover:text-red-300">
	                    <XMarkIcon className="h-5 w-5" />
	                  </button>
	                </div>
	              ) : (
	                <button
	                  onClick={startAddingNewPoint}
	                  className="mt-2 flex items-center justify-center w-full p-2 bg-white/10 dark:bg-gray-200/10 rounded text-white/80 dark:text-gray-600 hover:bg-white/20 dark:hover:bg-gray-200/20 hover:text-white dark:hover:text-gray-800 transition-colors"
	                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  <span>{t('structure.addPointButton')}</span>
                </button>
              )}
            </ul>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );

  const renderFocusContent = () => (
    <SortableContext items={items} strategy={sortingStrategy}>
      <div
        ref={setNodeRef}
        className={`flex-grow w-full min-w-0 md:min-w-[500px] lg:min-w-[700px] xl:min-w-[900px] min-h-[600px] overflow-y-auto px-6 pb-6 pt-20 md:p-6 ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} rounded-lg border-2 shadow-lg transition-all ${borderColor} dark:${UI_COLORS.neutral.darkBorder} ${isOver ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""} relative`}
        style={headerColor ? { borderColor: headerColor } : {}}
      >
        {/* Sidebar toggle button for small screens */}
        <button
          onClick={() => setIsSidebarVisible(!isSidebarVisible)}
          className="md:hidden absolute top-4 left-4 z-10 p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          title={isSidebarVisible ? t('structure.hideSidebar') : t('structure.showSidebar')}
        >
          <svg
            className={`w-5 h-5 text-gray-600 dark:text-gray-400 transition-transform ${isSidebarVisible ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="space-y-6 md:space-y-6 space-y-8">
          {/* In focus mode, show outline points and unassigned thoughts */}
          {localSermonPoints && localSermonPoints.length > 0 ? (
            <>
              {localSermonPoints.map((point) => (
                <div key={point.id} className="pb-4">
                  <SermonPointPlaceholder
                    point={point}
                    items={items}
                    containerId={id}
                    onEdit={onEdit}
                    isHighlighted={isItemHighlighted}
                    getHighlightType={getItemHighlightType}
                    onKeepItem={onKeepItem}
                    onRevertItem={onRevertItem}
                    onTogglePointLock={resolvedPointToggleHandler}
                    onToggleThoughtLock={onToggleThoughtLock}
                    headerColor={headerColor}
                    t={t}
                    activeId={activeId}
                    onMoveToAmbiguous={onMoveToAmbiguous}
                    sermonId={sermonId}
                    onAudioThoughtCreated={onAudioThoughtCreated}
                    isFocusMode={isFocusMode}
                    onAddThought={onAddThought}
                    sectionTitle={title}
                    setAudioError={setAudioError}
                    onRetryPendingThought={onRetryPendingThought}
                    onAiSortPoint={onAiSortPoint}
                    isOnline={isOnline}
                    isSorting={isLoading}
                    isSortReviewPending={isDiffModeActive}
                    sortingOutlinePointId={sortingOutlinePointId}
                    onAddSubPoint={handleAddSubPoint}
                    onEditSubPoint={handleEditSubPoint}
                    onDeleteSubPoint={handleDeleteSubPoint}
                    onReorderSubPoints={handleReorderSubPoints}
                  />
                </div>
              ))}
              {/* Unassigned thoughts section */}
              {renderUnassignedThoughtsSection(unassignedItemsForDisplay)}
            </>
          ) : (
            /* When no outline points exist, show all items including unassigned ones */
            items.length === 0 ? (
              <div className={`p-4 text-center ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} border-dashed border-2 border-blue-300 dark:border-blue-600`}>
                {t('structure.noEntries')}
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    containerId={id}
                    onEdit={onEdit}
                    isHighlighted={item.id in highlightedItems}
                    highlightType={highlightedItems[item.id]?.type}
                    onKeep={onKeepItem}
                    onRevert={onRevertItem}
                    activeId={activeId}
                    onMoveToAmbiguous={onMoveToAmbiguous}
                    onRetrySync={onRetryPendingThought}
                    onToggleLock={onToggleThoughtLock}
                    isLocked={Boolean(item.isLocked)}
                    disabled={isPendingItem(item)}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </SortableContext>
  );

  const renderNormalHeader = () => (
    <div className="relative mb-2 rounded-t-md">
      <div
        className={`p-3 flex justify-between items-center`}
        style={headerBgStyle}
      >
        <h2 className="text-lg font-bold text-white flex items-center">
          <span className="flex items-center gap-2">
            {title}
            {id === 'introduction' && (
              <SermonSectionGuidanceTooltip t={t} section="introduction" popoverAlignment="left" />
            )}
            {id === 'conclusion' && (
              <SermonSectionGuidanceTooltip t={t} section="conclusion" popoverAlignment="left" />
            )}
          </span>
          <div
            className="ml-2 flex overflow-hidden rounded-full text-xs relative select-none cursor-default hover:ring-2 hover:ring-white"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            title={t('structure.assignedUnassignedTooltip', {
              assigned: assignedItems,
              unassigned: unassignedItems
            })}
          >
            <span className="bg-green-500 bg-opacity-40 px-2 py-0.5 text-white">
              {assignedItems}
            </span>
            <span className="bg-gray-500 px-2 py-0.5 text-white">
              {unassignedItems}
            </span>
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-gray-800 dark:bg-gray-900 text-white dark:text-gray-100 text-xs rounded shadow-lg w-48 z-10 whitespace-normal">
                {t('structure.assignedUnassignedTooltip', {
                  assigned: assignedItems,
                  unassigned: unassignedItems
                })}
              </div>
            )}
          </div>
        </h2>
        <div className="flex items-center space-x-2">
          {/* Mic button (normal mode) */}
	          {sermonId && onAudioThoughtCreated && isPointAudioSection(id) && (
	            <div className="relative" ref={normalModePopoverRef}>
              <button
                onClick={() => {
                  debugLog('Column: mic button clicked', { sectionId: id });
                  setShowAudioPopover((v) => !v);
                }}
                disabled={allPointsBlocked}
                className={`p-1 rounded-full transition-colors ${allPointsBlocked ? 'bg-white bg-opacity-10 cursor-not-allowed opacity-50' : 'bg-white bg-opacity-20 hover:bg-opacity-30'}`}
                title={allPointsBlocked ? t(TRANSLATION_STRUCTURE_ALL_POINTS_BLOCKED, { defaultValue: DEFAULT_ALL_POINTS_BLOCKED_TEXT }) : t(TRANSLATION_STRUCTURE_RECORD_AUDIO, { defaultValue: DEFAULT_RECORD_AUDIO_TEXT })}
                aria-label={allPointsBlocked ? t(TRANSLATION_STRUCTURE_ALL_POINTS_BLOCKED, { defaultValue: DEFAULT_ALL_POINTS_BLOCKED_TEXT }) : t(TRANSLATION_STRUCTURE_RECORD_AUDIO, { defaultValue: DEFAULT_RECORD_AUDIO_TEXT })}
              >
                <MicrophoneIcon className="h-4 w-4 text-white" />
              </button>
              {showAudioPopover && (
                <div className="absolute right-0 mt-2 z-50">
                  <div className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-[320px]">
	                    <AudioRecorder
	                      variant="mini"
	                      hideKeyboardShortcuts={true}
	                      autoStart={true}
	                      onRecordingComplete={(audioBlob) => {
	                        void recordAudioThought({
	                          audioBlob,
	                          sectionId: id,
	                          sermonId,
	                          setIsRecordingAudio,
	                          setAudioError,
	                          onAudioThoughtCreated,
	                          t,
	                          onSuccess: () => setShowAudioPopover(false),
	                          errorContext: 'Error recording audio thought (normal mode):',
	                        });
	                      }}
	                      isProcessing={isRecordingAudio}
                      onError={(error) => {
                        setAudioError(error);
                        setIsRecordingAudio(false);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {onAddThought && (
            <button
              onClick={() => {
                debugLog('Structure: add thought clicked', { sectionId: id, isFocusMode, sermonId });
                onAddThought(id);
              }}
              disabled={allPointsBlocked}
              className={`p-1 rounded-full transition-colors ${allPointsBlocked ? 'bg-white bg-opacity-10 cursor-not-allowed opacity-50' : 'bg-white bg-opacity-20 hover:bg-opacity-30'}`}
              title={allPointsBlocked ? t(TRANSLATION_STRUCTURE_ALL_POINTS_BLOCKED, { defaultValue: DEFAULT_ALL_POINTS_BLOCKED_TEXT }) : t('structure.addThoughtToSection', { section: title })}
            >
              <PlusIcon className="h-4 w-4 text-white" />
            </button>
          )}
          {showFocusButton && onToggleFocusMode && (
            <button
              onClick={() => onToggleFocusMode(id)}
              className="p-1 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
              title={t('structure.focusMode')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
          )}
          {onSwitchPage && (
            <button
              onClick={() => onSwitchPage?.(id)}
              className="p-1 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
              title={t('structure.switchToPlan', { defaultValue: 'Switch to Plan view' })}
              aria-label={t('structure.switchToPlan', { defaultValue: 'Switch to Plan view' })}
            >
              <SwitchViewIcon className="h-4 w-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Global accept/reject buttons for AI sort - only show when in diff mode and there are highlighted items */}
      {isDiffModeActive && hasHighlightedItems && (
        <div className={`px-3 py-2 ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} border-t ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} flex justify-between items-center`}>
          <span className={`text-xs font-medium ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText}`}>
            {t('structure.aiSuggestions', { defaultValue: 'AI Suggestions' })}
          </span>
          <div className="flex space-x-2">
            {/* Accept all button */}
            <button
              onClick={() => onKeepAll?.(id)}
              className={`px-2 py-1 text-xs font-medium rounded ${UI_COLORS.success.bg} dark:${UI_COLORS.success.darkBg} ${UI_COLORS.success.text} dark:${UI_COLORS.success.darkText} hover:bg-green-500 dark:hover:bg-green-600 transition-colors shadow-sm flex items-center`}
            >
              <CheckIcon className="h-3 w-3 mr-1" />
              {t('structure.acceptAll', { defaultValue: 'Accept all' })}
            </button>

            {/* Reject all button */}
            <button
              onClick={() => onRevertAll?.(id)}
              className="px-2 py-1 text-xs font-medium rounded bg-orange-600 dark:bg-orange-700 text-white hover:bg-orange-500 dark:hover:bg-orange-600 transition-colors shadow-sm flex items-center"
            >
              <ArrowUturnLeftIcon className="h-3 w-3 mr-1" />
              {t('structure.rejectAll', { defaultValue: 'Reject all' })}
            </button>
          </div>
        </div>
      )}

      {/* SermonOutline points display */}
      {localSermonPoints && localSermonPoints.length > 0 && (
        <div className={`bg-opacity-80 p-2 text-sm font-normal text-white border-t border-white`}
          style={headerBgStyle ? { ...headerBgStyle, opacity: 0.8 } : {}}>
          <ul className="list-disc pl-4 space-y-1">
            {localSermonPoints.map((point: SermonPoint) => (
              <li key={point.id}>
                <div className="flex items-center">
                  <span>{point.text}</span>
                  {thoughtsPerSermonPoint[point.id] > 0 && (
                    <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-xs leading-none align-middle tabular-nums text-gray-700">
                      {thoughtsPerSermonPoint[point.id]}
                    </span>
                  )}
                </div>
                {point.subPoints && point.subPoints.length > 0 && (
                  <ul className="ml-2 mt-0.5 space-y-0.5">
                    {[...point.subPoints].sort((a, b) => a.position - b.position).map((sp) => (
                      <li key={sp.id} className="text-xs text-white/70 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-white/50 flex-shrink-0" />
                        {sp.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
  const renderAddPointButton = () => {
    if (isFocusMode || !onAddOutlinePoint) return null;
    return (
      <div className="flex justify-center mt-2 mb-6">
	        {!addingNewPoint ? (
	          <button
	            onClick={startAddingNewPoint}
	            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700/50 hover:border-gray-400 dark:hover:border-gray-600 rounded-lg transition-colors min-w-[160px]"
	          >
            <PlusIcon className="h-4 w-4" />
            <span>{t('structure.addOutlinePoint', { defaultValue: 'Add outline point' })}</span>
          </button>
        ) : (
          <div className={`w-full max-w-md p-4 rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-sm animate-in fade-in zoom-in duration-200`}>
	            <div className="flex items-center gap-2">
	              <input
	                ref={addInputRef}
	                type="text"
	                value={newPointText}
	                onChange={(e) => setNewPointText(e.target.value)}
                placeholder={t('structure.newOutlinePointName', { defaultValue: 'New point name...' })}
                className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
	                onKeyDown={(e) => {
	                  if (e.key === 'Enter') handleInsertSave(localSermonPoints.length, newPointText);
	                  if (e.key === 'Escape') {
	                    cancelAddingNewPoint();
	                  }
	                }}
	              />
              <button
                onClick={() => handleInsertSave(localSermonPoints.length, newPointText)}
                disabled={!newPointText.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
              >
                {t(TRANSLATION_COMMON_SAVE, { defaultValue: 'Save' })}
              </button>
	              <button
	                onClick={cancelAddingNewPoint}
	                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md text-sm font-medium transition-colors"
	              >
                {t(TRANSLATION_COMMON_CANCEL, { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderNormalBody = () => (
    <SortableContext items={items} strategy={sortingStrategy}>
      <div
        ref={setNodeRef}
        className={`min-h-[300px] p-4 ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} rounded-b-md border-2 shadow-lg transition-all ${borderColor} dark:${UI_COLORS.neutral.darkBorder} ${isOver ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""}`}
        style={headerColor ? { borderColor: headerColor } : {}}
      >
        {/* Show outline points with grouped thoughts */}
        {localSermonPoints && localSermonPoints.length > 0 ? (
          <div className="space-y-6">
            {/* Render placeholders wrapped in DragDropContext for reordering */}
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId={`normal-outline-${id}`}>
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef}>
                    {localSermonPoints.map((point, index) => (
                      <React.Fragment key={`frag-${point.id}`}>
                        {/* Divider moved inside Draggable to prevent DnD layout jumping */}

                        {/* Inline input for inserting a new point */}
                        {insertPointIndex === index && (
                          <div className={`min-h-[84px] rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200 flex items-center`}>
                            <div className="flex w-full items-center gap-2 px-4">
                              <input
                                ref={insertInputRef}
                                type="text"
                                value={insertPointText}
                                onChange={(e) => setInsertPointText(e.target.value)}
                                placeholder={t('structure.newOutlinePointName', { defaultValue: 'New point name...' })}
                                className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
	                                onKeyDown={(e) => {
	                                  if (e.key === 'Enter') handleInsertSave(index);
	                                  if (e.key === 'Escape') {
	                                    closeInsertPointForm();
	                                  }
	                                }}
	                              />
                              <button
                                onClick={() => handleInsertSave(index)}
                                disabled={!insertPointText.trim()}
                                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
                              >
                                {t(TRANSLATION_COMMON_SAVE, { defaultValue: 'Save' })}
                              </button>
	                              <button
	                                onClick={closeInsertPointForm}
	                                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md text-sm font-medium transition-colors"
	                              >
                                {t(TRANSLATION_COMMON_CANCEL, { defaultValue: 'Cancel' })}
                              </button>
                            </div>
                          </div>
                        )}

                        <Draggable key={point.id} draggableId={`normal-${point.id}`} index={index}>
                          {(providedDraggable, snapshot) => (
                            <div
                              ref={providedDraggable.innerRef}
                              {...providedDraggable.draggableProps}
                              className={`relative group/container pb-4 ${snapshot.isDragging ? 'shadow-lg opacity-90 z-50' : ''}`}
                              style={providedDraggable.draggableProps.style}
                            >
                              {/* Keep spacing inside the draggable box so the DnD placeholder does not add a late gap snap on drop. */}
                              {/* Hover Divider inside Draggable for perfect centering and no DnD jumping */}
                              {!isFocusMode && onAddOutlinePoint && index > 0 && insertPointIndex !== index && (
                                <div
                                  className={`absolute left-0 right-0 h-4 -top-4 flex items-center justify-center cursor-pointer group/divider transition-opacity z-10 ${snapshot.isDragging ? 'opacity-0 pointer-events-none' : 'opacity-0 hover:opacity-100'}`}
	                                  onClick={(e) => {
	                                    e.preventDefault();
	                                    e.stopPropagation();
	                                    openInsertPointForm(index);
	                                  }}
	                                >
                                  <div
                                    className="h-0.5 w-full rounded flex items-center justify-center relative"
                                    style={outlineInsertAccent.lineStyle}
                                  >
                                    <span
                                      className={`absolute inline-flex items-center justify-center rounded-full p-1 ring-1 ring-white/70 dark:ring-slate-800/80 transition-transform duration-150 group-hover/divider:scale-105 ${outlineInsertAccent.badgeClassName}`}
                                      style={outlineInsertAccent.badgeShadowStyle}
                                    >
                                      <PlusIcon className="h-4 w-4" />
                                    </span>
                                  </div>
                                </div>
                              )}
                              <SermonPointPlaceholder
                                point={point}
                                items={items}
                                containerId={id}
                                onEdit={onEdit}
                                isHighlighted={isItemHighlighted}
                                getHighlightType={getItemHighlightType}
                                onKeepItem={onKeepItem}
                                onRevertItem={onRevertItem}
                                onTogglePointLock={resolvedPointToggleHandler}
                                onToggleThoughtLock={onToggleThoughtLock}
                                headerColor={headerColor}
                                t={t}
                                activeId={activeId}
                                onMoveToAmbiguous={onMoveToAmbiguous}
                                sermonId={sermonId}
                                onAudioThoughtCreated={onAudioThoughtCreated}
                                isFocusMode={false}
                                onAddThought={onAddThought}
                                sectionTitle={title}
                                setAudioError={setAudioError}
                                onRetryPendingThought={onRetryPendingThought}
                                onAiSortPoint={onAiSortPoint}
                                isOnline={isOnline}
                                isSorting={isLoading}
                                isSortReviewPending={isDiffModeActive}
                                sortingOutlinePointId={sortingOutlinePointId}
                                dragHandleProps={providedDraggable.dragHandleProps as unknown as React.HTMLAttributes<HTMLElement>}
                                onEditPoint={handleStartEdit}
                                onDeletePoint={(pointId) => setDeletePointId(pointId)}
                                onSaveEdit={handleSaveEditDirect}
                                onAddSubPoint={handleAddSubPoint}
                                onEditSubPoint={handleEditSubPoint}
                                onDeleteSubPoint={handleDeleteSubPoint}
                              />
                            </div>
                          )}
                        </Draggable>
                      </React.Fragment>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {/* Bottom Add Point Button for normal mode */}
            {/* Bottom Add Point Button for normal mode */}
            {localSermonPoints.length > 0 && renderAddPointButton()}

            {renderUnassignedThoughtsSection(unassignedItemsForDisplay)}
          </div>
        ) : (
          /* Fallback: show all items in simple list if no outline points exist */
          items.length === 0 ? (
            <div className="space-y-6">
              {renderAddPointButton()}
              <div className={`p-4 text-center ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} border-dashed border-2 border-blue-300 dark:border-blue-600`}>
                {t('structure.noEntries')}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {renderAddPointButton()}
              {items.map((item) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  containerId={id}
                  onEdit={onEdit}
                  isHighlighted={item.id in highlightedItems}
                  highlightType={highlightedItems[item.id]?.type}
                  onKeep={onKeepItem}
                  onRevert={onRevertItem}
                  activeId={activeId}
                  onMoveToAmbiguous={onMoveToAmbiguous}
                  onRetrySync={onRetryPendingThought}
                  onToggleLock={onToggleThoughtLock}
                  isLocked={Boolean(item.isLocked)}
                  disabled={isPendingItem(item)}
                />
              ))}
            </div>
          )
        )}
        {/* Extra dummy element to always provide a drop target */}
        <div id="dummy-drop-zone" className="h-8" />
      </div>
    </SortableContext>
  );

  // Render in focus mode (vertical layout with sidebar)
  if (isFocusMode) {
    return (
      <>
        <FocusModeLayout
          className={className}
          sidebar={(
            <FocusSidebar
              visible={isSidebarVisible}
              style={headerBgStyle}
              header={renderFocusSidebarHeader()}
              actions={renderFocusSidebarActions()}
              points={renderFocusSidebarPoints()}
            />
          )}
          content={renderFocusContent()}
        />
        <DeletePointConfirmModal
          isOpen={!!deletePointId}
          onClose={() => setDeletePointId(null)}
          onConfirm={confirmDeletePoint}
          pointName={pointToDeleteDetail?.text || ''}
        />
      </>
    );
  }

  // Normal mode UI (non-focused)
  return (
    <div className={`flex flex-col ${className}`}>
      {renderNormalHeader()}
      {renderNormalBody()}
      <DeletePointConfirmModal
        isOpen={!!deletePointId}
        onClose={() => setDeletePointId(null)}
        onConfirm={confirmDeletePoint}
        pointName={pointToDeleteDetail?.text || ''}
      />
    </div>
  );
}
