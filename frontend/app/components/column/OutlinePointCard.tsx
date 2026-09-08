"use client";

import { useDroppable } from '@dnd-kit/core';
import { PlusIcon, CheckIcon, XMarkIcon, TrashIcon, Bars3Icon, SparklesIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { FlatRecorderButton } from '@/components/FlatRecorderButton';
import { FocusRecorderButton } from '@/components/FocusRecorderButton';
import PointNote from '@/components/PointNote';
import { OutlinePointGuidanceTooltip } from '@/components/SermonGuidanceTooltips';
import { getOutlinePointAiSortState } from '@/utils/aiSorting';
import { debugLog } from '@/utils/debugMode';
import { capitalizeFirstLetter, normalizeCapitalizedTitle } from '@/utils/textNormalization';

import { recordAudioThought } from './audio';
import { BG_GRAY_LIGHTER_DARK, INLINE_EDIT_ACTION_BUTTON_BASE_CLASS, TRANSLATION_COMMON_CANCEL, TRANSLATION_COMMON_DELETE, TRANSLATION_COMMON_SAVE, TRANSLATION_STRUCTURE_ADD_THOUGHT } from './constants';
import { SubPointList } from './SubPointList';
import { PointThoughtLane } from './ThoughtLanes';
import { getPlaceholderColors, getPointLockToggleLabel, isPointAudioSection, openPointEditor } from './utils';

import type { OnAudioThoughtCreated, ThoughtItemRenderer, Translate } from './types';
import type { Item, SermonPoint, SubPoint } from '@/models/models';

// Component for rendering outline point placeholder with thoughts
export const OutlinePointCard: React.FC<{
  point: SermonPoint;
  pointItems: Item[];
  renderItem: ThoughtItemRenderer;
  containerId: string;
  onTogglePointLock?: (outlinePointId: string, isLocked: boolean) => Promise<void> | void;
  onToggleReviewed?: (outlinePointId: string, isReviewed: boolean) => Promise<void> | void;
  headerColor?: string;
  t: Translate;
  activeId?: string | null;
  sermonId?: string;
  onAudioThoughtCreated?: OnAudioThoughtCreated;
  isFocusMode?: boolean;
  onAddThought?: (sectionId: string, outlinePointId?: string) => void;
  sectionTitle?: string;
  audioError?: string | null;
  setAudioError: (error: string | null) => void;
  onClearAudioError: () => void;
  onAiSortPoint?: (outlinePointId: string) => void;
  isOnline: boolean;
  aiBlocked?: boolean;
  transcriptionBlocked?: boolean;
  transcriptionUnavailableLabel?: string;
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
  onSetPointNote?: (pointId: string, note?: string) => void;
  onSetSubPointNote?: (pointId: string, subPointId: string, note?: string) => void;
  onDeleteSubPoint?: (outlinePointId: string, subPointId: string) => void;
  onReorderSubPoints?: (outlinePointId: string, sourceIndex: number, destinationIndex: number) => void;
  showNotes?: boolean;
}> = ({
  point,
  pointItems,
  renderItem,
  containerId,
  onTogglePointLock,
  onToggleReviewed,
  headerColor,
  t,
  activeId,
  sermonId,
  onAudioThoughtCreated,
  isFocusMode,
  onAddThought,
  sectionTitle,
  audioError,
  setAudioError,
  onClearAudioError,
  onAiSortPoint,
  isOnline,
  aiBlocked = false,
  transcriptionBlocked = false,
  transcriptionUnavailableLabel,
  isSorting = false,
  isSortReviewPending = false,
  sortingOutlinePointId,
  dragHandleProps,
  onEditPoint,
  onDeletePoint,
  onSaveEdit,
  onAddSubPoint,
  onEditSubPoint,
  onSetPointNote,
  onSetSubPointNote,
  onDeleteSubPoint,
  onReorderSubPoints,
  showNotes = false,
  // eslint-disable-next-line sonarjs/cognitive-complexity -- dense UI component with multiple conditional controls
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `outline-point-${point.id}`,
    data: { container: containerId, outlinePointId: point.id }
  });

  const hasItems = pointItems.length > 0;
  const isPointLocked = hasItems && pointItems.every((item) => item.isLocked);
  const aiSortState = getOutlinePointAiSortState({
    items: pointItems,
    outlinePointId: point.id,
    isOnline,
    aiBlocked,
    isSorting,
    isDiffModeActive: isSortReviewPending,
  });
  const isSortingThisPoint = isSorting && sortingOutlinePointId === point.id;

  const colors = getPlaceholderColors(containerId, headerColor);

  const [isCollapsed, setIsCollapsed] = React.useState<boolean>(false);

  // Local state for audio recording (per outline point)
  const [isRecordingAudio, setIsRecordingAudio] = React.useState<boolean>(false);
  const [subPointProcessingTarget, setSubPointProcessingTarget] = React.useState<string | null>(null);
  const [subPointAudioErrors, setSubPointAudioErrors] = React.useState<Record<string, string>>({});

  const createSubPointProcessingSetter = React.useCallback((subPointId: string): React.Dispatch<React.SetStateAction<boolean>> => {
    return (value) => {
      setSubPointProcessingTarget((current) => {
        const next = value instanceof Function ? value(current === subPointId) : value;
        if (next) return subPointId;
        return current === subPointId ? null : current;
      });
    };
  }, []);

  const setSubPointAudioError = React.useCallback((subPointId: string, error: string | null) => {
    setSubPointAudioErrors((previous) => {
      if (!error) {
        const next = { ...previous };
        delete next[subPointId];
        return next;
      }

      return { ...previous, [subPointId]: error };
    });
  }, []);

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
    const textToSave = normalizeCapitalizedTitle(localEditText);
    if (!textToSave) {
      setIsEditingLocally(false);
      setLocalEditText(point.text);
      return;
    }
    onSaveEdit?.(point.id, textToSave);
    setIsEditingLocally(false);
  };

  const handleLocalCancel = () => {
    setIsEditingLocally(false);
    setLocalEditText(point.text);
  };

  const pointLockToggleLabel = getPointLockToggleLabel(isPointLocked, t);
  const pointToggleHandler = onTogglePointLock ?? onToggleReviewed;
  const canUseInlineRecorder = Boolean(sermonId && isPointAudioSection(containerId));
  const renderSubPointRecorder = canUseInlineRecorder
    ? (subPoint: SubPoint) => (
      <FlatRecorderButton
        disabled={isPointLocked || transcriptionBlocked}
        title={transcriptionBlocked ? transcriptionUnavailableLabel : undefined}
        transcriptionError={subPointAudioErrors[subPoint.id] ?? null}
        onClearError={() => setSubPointAudioError(subPoint.id, null)}
        onRecordingComplete={(audioBlob) => {
          if (transcriptionBlocked) return;
          if (!sermonId) return;
          void recordAudioThought({
            audioBlob,
            sectionId: containerId,
            sermonId,
            pointId: point.id,
            subPointId: subPoint.id,
            setIsRecordingAudio: createSubPointProcessingSetter(subPoint.id),
            setAudioError: (error) => setSubPointAudioError(subPoint.id, error),
            onAudioThoughtCreated,
            t,
            errorContext: "Error recording audio for sub-point:",
          });
        }}
        isProcessing={subPointProcessingTarget === subPoint.id}
        onError={(error) => {
          setSubPointAudioError(subPoint.id, error);
          setSubPointProcessingTarget((current) => current === subPoint.id ? null : current);
        }}
      />
    )
    : undefined;
  const aiSortTooltip = (() => {
    if (isSortingThisPoint) {
      return t("structure.sorting", { defaultValue: "Sorting..." });
    }
    switch (aiSortState.disabledReason) {
      case "offline":
        return t("structure.aiSortPointDisabledOffline", {
          defaultValue: "AI sorting is unavailable offline.",
        });
      case "quotaExhausted":
        return t("structure.aiSortPointDisabledQuotaExhausted", {
          defaultValue: "Not enough AI usage remaining.",
        });
      case "sorting":
        return t("structure.aiSortPointDisabledSorting", {
          defaultValue: "AI sorting is already running.",
        });
      case "review":
        return t("structure.aiSortPointDisabledReview", {
          defaultValue: "Review or revert current AI suggestions first.",
        });
      case "tooMany":
        return t("structure.aiSortPointDisabledTooMany", {
          defaultValue: "AI sorting supports up to 25 thoughts in one structure point.",
        });
      case "insufficientUnlocked":
        return t("structure.aiSortPointDisabledTooFewUnlocked", {
          defaultValue: "Need at least 2 unlocked thoughts in this structure point.",
        });
      default:
        return t("structure.aiSortPoint", {
          defaultValue: "Sort this structure point with AI. Locked thoughts stay fixed.",
        });
    }
  })();

  return (
    <>
      <div
        ref={isCollapsed ? setNodeRef : undefined}
        className={`group ${colors.border} ${colors.bg} rounded-lg transition duration-200 ${isOver ? 'ring-2 ring-blue-400 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'
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
                  onChange={(e) => setLocalEditText(capitalizeFirstLetter(e.target.value))}
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
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {point.subPoints && point.subPoints.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsCollapsed(prev => !prev);
                    }}
                    className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 transition-colors flex-shrink-0"
                    title={isCollapsed ? t('common.expand') : t('common.collapse')}
                    aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
                  aria-expanded={!isCollapsed}
                  >
                    <ChevronDownIcon
                      className={`h-3.5 w-3.5 transform transition-transform duration-200 ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                  </button>
                )}
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
                    className={`p-1 rounded-full border transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:focus-visible:ring-amber-300 ${
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
                  className={`p-1.5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300 flex-shrink-0 ${isPointLocked
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
                  className={`w-[30px] h-[30px] flex-shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:focus-visible:ring-green-300 flex items-center justify-center ${isPointLocked ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed opacity-50' : 'bg-gray-400 hover:bg-green-500'}`}
                  title={isPointLocked ? t('structure.pointLocked', { defaultValue: 'All thoughts in this structure point are locked' }) : t(TRANSLATION_STRUCTURE_ADD_THOUGHT, { section: sectionTitle || containerId })}
                  aria-label={isPointLocked ? t('structure.pointLocked', { defaultValue: 'All thoughts in this structure point are locked' }) : t(TRANSLATION_STRUCTURE_ADD_THOUGHT, { section: sectionTitle || containerId })}
                >
                  <PlusIcon className="h-4 w-4 text-white" />
                </button>
              )}

              {canUseInlineRecorder && (
                <>
                  <FocusRecorderButton
                    size="small"
                    disabled={isPointLocked || transcriptionBlocked}
                    title={transcriptionBlocked ? transcriptionUnavailableLabel : undefined}
                    transcriptionError={audioError ?? null}
                    onClearError={onClearAudioError}
                    onRecordingComplete={(audioBlob) => {
                      if (transcriptionBlocked) return;
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

          {showNotes && !isEditingLocally && (
            <PointNote
              note={point.note}
              onChange={(note) => onSetPointNote?.(point.id, note)}
              isReadOnly={isPointLocked}
              indentClass="ml-6"
              addRevealClass="opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
            />
          )}
        </div>

        {!isFocusMode && !isEditingLocally && !isCollapsed && ((point.subPoints?.length ?? 0) > 0 || Boolean(onAddSubPoint && onEditSubPoint && onDeleteSubPoint)) && (
          <SubPointList
            subPoints={point.subPoints ?? []}
            outlinePointId={point.id}
            isPointLocked={isPointLocked}
            onAdd={onAddSubPoint ?? (() => undefined)}
            onEdit={onEditSubPoint ?? (() => undefined)}
            onDelete={onDeleteSubPoint ?? (() => undefined)}
            onReorder={onReorderSubPoints}
            getAffectedThoughtCount={(spId) => pointItems.filter((it) => it.subPointId === spId).length}
            t={t}
          />
        )}

        {/* Drop zone for thoughts — grouped by sub-point */}
        {!isCollapsed && <PointThoughtLane
          setNodeRef={setNodeRef}
          isOver={isOver}
          pointItems={pointItems}
          subPoints={point.subPoints ?? []}
          containerId={containerId}
          outlinePointId={point.id}
          hasItems={hasItems}
          renderItem={renderItem}
          activeId={activeId}
          renderSubPointRecorder={renderSubPointRecorder}
          showNotes={showNotes}
          isPointLocked={isPointLocked}
          onSetSubPointNote={onSetSubPointNote}
          t={t}
        />}
      </div>
    </>
  );
};
