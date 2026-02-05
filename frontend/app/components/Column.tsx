"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import { QuestionMarkCircleIcon, PlusIcon, PencilIcon, CheckIcon, XMarkIcon, TrashIcon, Bars3Icon, ArrowUturnLeftIcon, SparklesIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import "@locales/i18n";

import { MicrophoneIcon, SwitchViewIcon } from "@/components/Icons";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSectionLabel } from "@/lib/sections";
import { Item, SermonOutline, SermonPoint, Thought } from "@/models/models";
import { generateSermonPointsForSection, getSermonOutline, updateSermonOutline } from "@/services/outline.service";
import { debugLog } from "@/utils/debugMode";
import { LOCAL_THOUGHT_PREFIX } from "@/utils/pendingThoughtsStore";
import { getCanonicalTagForSection } from "@/utils/tagUtils";
import { SERMON_SECTION_COLORS, UI_COLORS } from "@/utils/themeColors";

import { PlanData } from "../../utils/wordExport";

import { AudioRecorder } from "./AudioRecorder";
import ExportButtons from "./ExportButtons";
import FocusModeLayout from "./FocusModeLayout";
import { FocusRecorderButton } from "./FocusRecorderButton";
import FocusSidebar from "./FocusSidebar";
import { OutlinePointGuidanceTooltip, SermonSectionGuidanceTooltip } from "./SermonGuidanceTooltips";
import SortableItem from "./SortableItem";

// Translation key constants to avoid duplicate strings
const TRANSLATION_STRUCTURE_ADD_THOUGHT = 'structure.addThoughtToSection';
const TRANSLATION_STRUCTURE_UNASSIGNED_THOUGHTS = 'structure.unassignedThoughts';
const TRANSLATION_STRUCTURE_ALL_POINTS_BLOCKED = 'structure.allPointsBlocked';
const TRANSLATION_STRUCTURE_RECORD_AUDIO = 'structure.recordAudio';
const DEFAULT_UNASSIGNED_THOUGHTS_TEXT = 'Unassigned Thoughts';
const DEFAULT_ALL_POINTS_BLOCKED_TEXT = 'All outline points are reviewed';
const DEFAULT_RECORD_AUDIO_TEXT = 'Record voice note';

// CSS class constants to avoid duplicate strings
const BG_GRAY_LIGHT_DARK = 'bg-gray-50 dark:bg-gray-800';
const BG_GRAY_LIGHTER_DARK = 'bg-gray-100 dark:bg-gray-700';

interface ColumnProps {
  id: string;
  title: string;
  items: Item[];
  headerColor?: string; // optional color for header and border
  onEdit?: (item: Item) => void;
  outlinePoints?: SermonPoint[]; // New prop for outline points
  showFocusButton?: boolean; // Whether to show the focus button
  isFocusMode?: boolean; // Whether this column is in focus mode
  onToggleFocusMode?: (columnId: string) => void; // Callback for toggling focus mode
  onAiSort?: () => void; // Callback for AI sorting
  isLoading?: boolean; // Whether the AI sorting is in progress
  className?: string; // Custom class name for the column container
  getExportContent?: (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => Promise<string>; // Function to get export content
  sermonId?: string; // Add sermonId prop for export functionality
  onAddThought?: (sectionId: string, outlinePointId?: string) => void; // New callback for adding a thought to this section
  onOutlineUpdate?: (updatedOutline: SermonOutline) => void; // Add callback for outline updates propagating back to parent
  thoughtsPerSermonPoint?: Record<string, number>; // Add this prop for non-focus mode display
  // New props for AI sort with interactive confirmation
  isDiffModeActive?: boolean;
  highlightedItems?: Record<string, { type: 'assigned' | 'moved' }>;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  onKeepAll?: (columnId: string) => void;
  onRevertAll?: (columnId: string) => void;
  activeId?: string | null; // Add activeId prop for proper drag state detection
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void; // Move-to-ambiguous action
  onAudioThoughtCreated?: (thought: Thought, sectionId: 'introduction' | 'main' | 'conclusion') => void; // New callback: append audio thought into section
  onToggleReviewed?: (outlinePointId: string, isReviewed: boolean) => void; // Toggle reviewed status for outline point
  onSwitchPage?: (sectionId?: string) => void; // Callback to switch to plan view
  onNavigateToSection?: (sectionId: string) => void; // Callback for navigating between sections in Focus Mode
  onRetryPendingThought?: (itemId: string) => void; // Retry pending thought sync
  planData?: PlanData; // Structured plan data for export
}

// Define SectionType based on Column ID mapping
type SectionType = 'introduction' | 'mainPart' | 'conclusion';

// Helper to map column ID to SectionType used in SermonOutline model
const mapColumnIdToSectionType = (columnId: string): SectionType | null => {
  switch (columnId) {
    case 'introduction': return 'introduction';
    case 'main': return 'mainPart';
    case 'conclusion': return 'conclusion';
    default: return null; // Handle cases like 'ambiguous' or others
  }
};

const isPendingItem = (item: Item) => item.id.startsWith(LOCAL_THOUGHT_PREFIX) || Boolean(item.syncStatus);

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
  onToggleReviewed?: (outlinePointId: string, isReviewed: boolean) => void;
  headerColor?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  sermonId?: string;
  onAudioThoughtCreated?: (thought: Thought, sectionId: 'introduction' | 'main' | 'conclusion') => void;
  isFocusMode?: boolean;
  onAddThought?: (sectionId: string, outlinePointId?: string) => void;
  sectionTitle?: string;
  setAudioError: (error: string | null) => void;
  onRetryPendingThought?: (itemId: string) => void;
}> = ({
  point,
  items,
  containerId,
  onEdit,
  isHighlighted,
  getHighlightType,
  onKeepItem,
  onRevertItem,
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
}) => {
    const { setNodeRef, isOver } = useDroppable({
      id: `outline-point-${point.id}`,
      data: { container: containerId, outlinePointId: point.id }
    });

    const pointItems = items.filter(item => item.outlinePointId === point.id);
    const hasItems = pointItems.length > 0;

    // Local info popover state
    const [showHint, setShowHint] = React.useState(false);
    const hintRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
      function onDocClick(e: MouseEvent | TouchEvent) {
        if (!hintRef.current) return;
        const target = e.target as Node;
        if (!hintRef.current.contains(target)) {
          setShowHint(false);
        }
      }
      if (showHint) {
        document.addEventListener('mousedown', onDocClick, true);
        document.addEventListener('touchstart', onDocClick, true);
      }
      return () => {
        document.removeEventListener('mousedown', onDocClick, true);
        document.removeEventListener('touchstart', onDocClick, true);
      };
    }, [showHint]);

    // Color scheme based on section
    const getPlaceholderColors = () => {
      if (headerColor) {
        return {
          border: `border-2 border-opacity-30`,
          bg: BG_GRAY_LIGHT_DARK,
          header: BG_GRAY_LIGHTER_DARK,
          headerText: 'text-gray-700 dark:text-gray-200'
        };
      }

      switch (containerId) {
        case 'introduction':
          return {
            border: `border-2 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`,
            bg: `${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg}`,
            header: `${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg}`,
            headerText: `${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`
          };
        case 'main':
          return {
            border: `border-2 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`,
            bg: `${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg}`,
            header: `${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg}`,
            headerText: `${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`
          };
        case 'conclusion':
          return {
            border: `border-2 ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`,
            bg: `${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg}`,
            header: `${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg}`,
            headerText: `${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`
          };
        default:
          return {
            border: 'border-2 border-gray-200 dark:border-gray-700',
            bg: BG_GRAY_LIGHT_DARK,
            header: BG_GRAY_LIGHTER_DARK,
            headerText: 'text-gray-700 dark:text-gray-200'
          };
      }
    };

    const colors = getPlaceholderColors();

    // Local state for audio recording (per outline point)
    const [isRecordingAudio, setIsRecordingAudio] = React.useState<boolean>(false);

    return (
      <div
        className={`${colors.border} ${colors.bg} rounded-lg mb-4 transition-all duration-200 ${isOver ? 'ring-2 ring-blue-400 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'
          }`}
        style={headerColor ? { borderColor: headerColor } : {}}
      >
        {/* SermonOutline point header */}
        <div
          className={`px-4 py-2 rounded-t-lg border-b border-opacity-20 dark:border-opacity-30 ${headerColor ? BG_GRAY_LIGHTER_DARK : colors.header}`}
          style={headerColor ? { backgroundColor: `${headerColor}20` } : {}}
        >
          <div className="flex items-center justify-between">
            <h4 className={`font-medium text-sm ${headerColor ? 'text-gray-800 dark:text-gray-200' : colors.headerText}`}>
              {point.text}
            </h4>
            <div className="flex items-center gap-2">
              {/* Toggle reviewed status button */}
              {onToggleReviewed && (
                <button
                  onClick={() => onToggleReviewed(point.id, !point.isReviewed)}
                  className={`p-1.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300 ${point.isReviewed
                    ? 'bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-700 dark:text-green-300'
                    : 'bg-white/20 hover:bg-white/30 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  title={point.isReviewed
                    ? t('structure.markAsUnreviewed', { defaultValue: 'Mark as unreviewed' })
                    : t('structure.markAsReviewed', { defaultValue: 'Mark as reviewed' })
                  }
                  aria-label={point.isReviewed
                    ? t('structure.markAsUnreviewed', { defaultValue: 'Mark as unreviewed' })
                    : t('structure.markAsReviewed', { defaultValue: 'Mark as reviewed' })
                  }
                >
                  <CheckIcon className={`h-4 w-4 ${point.isReviewed ? 'text-green-700 dark:text-green-300' : ''}`} />
                </button>
              )}
              {/* Quick help for outline point */}
              <OutlinePointGuidanceTooltip t={t} popoverAlignment="right" />
              <span className={`text-xs ${headerColor ? 'text-gray-600 dark:text-gray-400' : colors.headerText} opacity-70`}>
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
                    onAddThought(containerId, point.id);
                  }}
                  disabled={point.isReviewed}
                  className={`w-[39px] h-[39px] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:focus-visible:ring-green-300 flex items-center justify-center ${point.isReviewed ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed opacity-50' : 'bg-gray-400 hover:bg-green-500'}`}
                  title={point.isReviewed ? t('structure.pointBlocked', { defaultValue: 'Point is reviewed and blocked' }) : t(TRANSLATION_STRUCTURE_ADD_THOUGHT, { section: sectionTitle || containerId })}
                  aria-label={point.isReviewed ? t('structure.pointBlocked', { defaultValue: 'Point is reviewed and blocked' }) : t(TRANSLATION_STRUCTURE_ADD_THOUGHT, { section: sectionTitle || containerId })}
                >
                  <PlusIcon className="h-[30px] w-[30px] text-white" />
                </button>
              )}
              {sermonId && (containerId === 'introduction' || containerId === 'main' || containerId === 'conclusion') && (
                <>
                  <FocusRecorderButton
                    size="small"
                    disabled={point.isReviewed}
                    onRecordingComplete={async (audioBlob) => {
                      try {
                        setIsRecordingAudio(true);
                        setAudioError(null);
                        const forceTag =
                          containerId === 'introduction' ? getCanonicalTagForSection('introduction') :
                            containerId === 'main' ? getCanonicalTagForSection('main') :
                              containerId === 'conclusion' ? getCanonicalTagForSection('conclusion') :
                                undefined;
                        const { createAudioThoughtWithForceTag } = await import('@/services/thought.service');
                        const newThought = await createAudioThoughtWithForceTag(
                          audioBlob,
                          sermonId!,
                          forceTag || null,
                          0,
                          3,
                          point.id
                        );

                        // Inform parent to append to UI under current section
                        onAudioThoughtCreated?.(newThought, containerId as 'introduction' | 'main' | 'conclusion');
                        toast.success(t('manualThought.addedSuccess', { defaultValue: 'Thought added successfully' }));
                      } catch (err) {
                        console.error('Error recording audio for outline point:', err);
                        const msg = err instanceof Error ? err.message : t('errors.audioProcessing');
                        setAudioError(String(msg));
                        toast.error(String(msg));
                      } finally {
                        setIsRecordingAudio(false);
                      }
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
                    disabled={point.isReviewed || isPendingItem(item)}
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
      </div>
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
  t: (key: string, options?: Record<string, unknown>) => string;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onRetryPendingThought?: (itemId: string) => void;
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
  onRetryPendingThought
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
  onAiSort,
  isLoading = false,
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
  onToggleReviewed,
  onSwitchPage,
  onNavigateToSection,
  onRetryPendingThought,
  planData
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  // Basic state for outline points UI
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [addingNewPoint, setAddingNewPoint] = useState<boolean>(false);
  const [newPointText, setNewPointText] = useState<string>('');
  const [showTooltip, setShowTooltip] = useState<boolean>(false);
  const [isGeneratingSermonPoints, setIsGeneratingSermonPoints] = useState<boolean>(false);

  // Refs for focus management
  const editInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  // State for responsive sidebar visibility on small screens
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);

  // Calculate counts for assigned and unassigned items
  const assignedItems = items.filter(item => item.outlinePointId).length;
  const unassignedItems = items.length - assignedItems;

  // Calculate if this column has any highlighted items
  const hasHighlightedItems = items.some(item => item.id in highlightedItems);

  // --- State for SermonOutline Point Editing (only relevant in focus mode) ---
  const [localSermonPoints, setLocalSermonPoints] = useState<SermonPoint[]>(initialSermonPoints);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate if all outline points are blocked (reviewed) - only block if there are points AND all are reviewed
  const allPointsBlocked = localSermonPoints.length > 0 && localSermonPoints.every(point => point.isReviewed);

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

  // Update local state if the prop changes (e.g., after initial load or external update)
  useEffect(() => {
    setLocalSermonPoints(initialSermonPoints);
  }, [initialSermonPoints]);

  // Focus input when starting to add/edit
  useEffect(() => {
    if (addingNewPoint && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingNewPoint]);

  useEffect(() => {
    if (editingPointId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingPointId]);

  // Debounced save function - упрощенная версия по аналогии с SermonOutline.tsx
  const triggerSaveOutline = (updatedPoints: SermonPoint[]) => {
    if (!sermonId || !isFocusMode) return; // Only save in focus mode with sermonId
    if (!isOnline) {
      toast.error(t('errors.saveOutlineError', { defaultValue: 'Failed to save outline' }));
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }



    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // Determine the key to use in the outline (mainPart -> main)
        const sectionType = mapColumnIdToSectionType(id);
        if (!sectionType) {
          console.error("Cannot save outline: Invalid section ID", id);
          return;
        }

        // First fetch the current outline to avoid overwriting other sections
        const currentOutline = await getSermonOutline(sermonId);

        // Create a merged outline that preserves other sections
        const outlineToSave: SermonOutline = {
          introduction: sectionType === 'introduction' ? updatedPoints : (currentOutline?.introduction || []),
          main: sectionType === 'mainPart' ? updatedPoints : (currentOutline?.main || []),
          conclusion: sectionType === 'conclusion' ? updatedPoints : (currentOutline?.conclusion || [])
        };

        // Call the API to update the outline with the complete data
        await updateSermonOutline(sermonId, outlineToSave);

        // Propagate the change UP using the callback
        onOutlineUpdate?.(outlineToSave);

        toast.success(t('structure.outlineSavedSuccess', { defaultValue: 'SermonOutline saved' }));
      } catch (error) {
        console.error("Error saving sermon outline:", error);
        toast.error(t('errors.saveOutlineError', { defaultValue: 'Failed to save outline' }));
      } finally {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
      }
    }, 200); // Используем более короткую задержку для дебаунса
  };

  // Clear pending outline save timeout on unmount to avoid stray requests
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  const handleAddPoint = () => {
    if (!newPointText.trim()) {
      setAddingNewPoint(false); // Close if empty
      return;
    }
    const newPoint: SermonPoint = {
      id: `new-${Date.now().toString()}`, // Temporary ID
      text: newPointText.trim(),
    };
    const updatedPoints = [...localSermonPoints, newPoint];
    setLocalSermonPoints(updatedPoints);
    setNewPointText("");
    setAddingNewPoint(false);
    triggerSaveOutline(updatedPoints);
  };

  const handleStartEdit = (point: SermonPoint) => {
    setEditingPointId(point.id);
    setEditingText(point.text);
    setAddingNewPoint(false); // Ensure add mode is off
  };

  const handleCancelEdit = () => {
    setEditingPointId(null);
    setEditingText("");
  };

  const handleSaveEdit = () => {
    if (!editingPointId || !editingText.trim()) {
      handleCancelEdit(); // Cancel if text is empty
      return;
    }
    const updatedPoints = localSermonPoints.map(p =>
      p.id === editingPointId ? { ...p, text: editingText.trim() } : p
    );
    setLocalSermonPoints(updatedPoints);
    handleCancelEdit(); // Reset editing state
    triggerSaveOutline(updatedPoints);
  };

  const handleDeletePoint = (pointId: string) => {
    // Find the point to get its text for the confirmation message
    const pointToDelete = localSermonPoints.find(p => p.id === pointId);
    const pointText = pointToDelete ? pointToDelete.text : ''; // Get text or empty string

    // Construct the confirmation message using translation and interpolation
    const confirmMessage = t('structure.deletePointConfirm', {
      defaultValue: `Are you sure you want to delete this outline point: "${pointText}"?`,
      text: pointText // Pass text for interpolation if the key supports it
    });

    if (window.confirm(confirmMessage)) {
      const updatedPoints = localSermonPoints.filter(p => p.id !== pointId);
      setLocalSermonPoints(updatedPoints);
      if (editingPointId === pointId) handleCancelEdit(); // Cancel edit if deleting the item being edited
      triggerSaveOutline(updatedPoints);
    }
  };

  // Оптимизированная версия handleDragEnd для @hello-pangea/dnd
  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    // Dropped outside the list or same position
    if (!destination || (destination.index === source.index)) {
      return;
    }

    // Create a shallow copy of the outline points array
    const updatedPoints = Array.from(localSermonPoints);
    const [removed] = updatedPoints.splice(source.index, 1);
    updatedPoints.splice(destination.index, 0, removed);

    // Update state
    setLocalSermonPoints(updatedPoints);

    // Save changes
    triggerSaveOutline(updatedPoints);
  };

  // Always use vertical list strategy regardless of focus mode
  const sortingStrategy = verticalListSortingStrategy;

  // Background color for header based on id or custom color (use canonical palette hex)
  const headerBgStyle: React.CSSProperties | undefined = (() => {
    if (headerColor) return { backgroundColor: headerColor };
    const colors = id === 'main' ? SERMON_SECTION_COLORS.mainPart
      : id === 'introduction' ? SERMON_SECTION_COLORS.introduction
        : id === 'conclusion' ? SERMON_SECTION_COLORS.conclusion
          : undefined;
    return colors ? { backgroundColor: colors.base } : undefined;
  })();

  // Border color based on id or custom color
  const borderColor = !headerColor
    ? (
      id === 'introduction' ? SERMON_SECTION_COLORS.introduction.border.split(' ')[0]
        : id === 'main' ? SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]
          : id === 'conclusion' ? SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]
            : 'border-gray-200'
    )
    : "";

  // Add a new function to handle generating outline points
  const handleGenerateSermonPoints = async () => {
    if (!sermonId || !isFocusMode) return;

    // Map id to the section name expected by API
    const sectionName = id === 'main' ? 'main' : id;

    try {
      setIsGeneratingSermonPoints(true);

      const newPoints = await generateSermonPointsForSection(sermonId, sectionName as 'introduction' | 'main' | 'conclusion');

      if (newPoints.length === 0) {
        toast.error(t('structure.generateSermonPointsError', { defaultValue: 'Failed to generate outline points' }));
        return;
      }

      // Add new points to existing ones (if there are any)
      const updatedPoints = [...localSermonPoints, ...newPoints];

      // Update state and save
      setLocalSermonPoints(updatedPoints);
      triggerSaveOutline(updatedPoints);

      toast.success(t('structure.outlinePointsGenerated', { defaultValue: 'SermonOutline points generated successfully', count: newPoints.length }));
    } catch (error) {
      console.error('Error generating outline points:', error);
      toast.error(t('structure.generateSermonPointsError', { defaultValue: 'Failed to generate outline points' }));
    } finally {
      setIsGeneratingSermonPoints(false);
    }
  };

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
        />
      </div>
    </div>
  );

  const renderFocusSidebarHeader = () => {
    const sections: string[] = ['introduction', 'main', 'conclusion'];
    const currentIndex = sections.indexOf(id);
    const prevSectionId = currentIndex > 0 ? sections[currentIndex - 1] : null;
    const nextSectionId = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

    return (
      <div className="flex items-center justify-between w-full">
        {prevSectionId && onNavigateToSection ? (
          <button
            onClick={() => onNavigateToSection(prevSectionId)}
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
            onRecordingComplete={async (audioBlob) => {
              try {
                setIsRecordingAudio(true);
                setAudioError(null);

                // Determine the force tag based on column ID
                const sectionLabel =
                  id === 'introduction' ? getSectionLabel(t, 'introduction') :
                    id === 'main' ? getSectionLabel(t, 'main') :
                      id === 'conclusion' ? getSectionLabel(t, 'conclusion') :
                        undefined;
                const forceTag =
                  id === 'introduction' ? getCanonicalTagForSection('introduction') :
                    id === 'main' ? getCanonicalTagForSection('main') :
                      id === 'conclusion' ? getCanonicalTagForSection('conclusion') :
                        undefined;

                // Import the service function dynamically to avoid circular dependencies
                const { createAudioThoughtWithForceTag } = await import('@/services/thought.service');
                const newThought = await createAudioThoughtWithForceTag(audioBlob, sermonId!, forceTag || null);
                // Append newly created thought into the current section (UI + structure)
                onAudioThoughtCreated?.(newThought, id as 'introduction' | 'main' | 'conclusion');

                toast.success(`Запись добавлена в раздел "${sectionLabel}"`);
              } catch (error) {
                console.error('Error recording audio thought:', error);
                const errorMessage = error instanceof Error ? error.message : 'Ошибка при записи аудио';
                setAudioError(errorMessage);
                toast.error(errorMessage);
              } finally {
                setIsRecordingAudio(false);
              }
            }}
            isProcessing={isRecordingAudio}
            onError={(error) => {
              setAudioError(error);
              setIsRecordingAudio(false);
            }}
          />
        </div>
      )}

      {onAiSort && (
        <button
          onClick={onAiSort}
          disabled={isLoading}
          className={`w-full px-4 py-2.5 text-sm font-medium rounded-md transition-colors shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed border ${isLoading ? `${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} ${UI_COLORS.neutral.text} dark:${UI_COLORS.neutral.darkText} ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}` :
            id === 'introduction' ? `${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg} ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText} ${SERMON_SECTION_COLORS.introduction.hover} dark:${SERMON_SECTION_COLORS.introduction.darkHover} ${SERMON_SECTION_COLORS.introduction.border} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} shadow-md` :
              id === 'main' ? `${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg} ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText} ${SERMON_SECTION_COLORS.mainPart.hover} dark:${SERMON_SECTION_COLORS.mainPart.darkHover} ${SERMON_SECTION_COLORS.mainPart.border} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} shadow-md` :
                id === 'conclusion' ? `${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg} ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} ${SERMON_SECTION_COLORS.conclusion.hover} dark:${SERMON_SECTION_COLORS.conclusion.darkHover} ${SERMON_SECTION_COLORS.conclusion.border} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} shadow-md` :
                  `${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} ${UI_COLORS.neutral.text} dark:${UI_COLORS.neutral.darkText} hover:bg-gray-400 dark:hover:bg-gray-500 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} shadow-md`
            }`}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4 mr-2 text-gray-800 dark:text-gray-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {t('structure.sorting')}
            </>
          ) : (
            <>
              <span className="flex items-center justify-center">
                <span className="text-base font-medium">{t('structure.sortButton')}</span>
                <span className="text-yellow-300 dark:text-yellow-200 ml-1.5 animate-pulse text-lg">✨</span>
              </span>
              <div className="relative flex items-center group">
                <QuestionMarkCircleIcon className="w-4 h-4 ml-2 text-white dark:text-gray-100 opacity-80 hover:opacity-100" />
                <div className="absolute bottom-full left-1/3 -translate-x-2 mb-2 p-2 bg-gray-800 dark:bg-gray-900 text-white dark:text-gray-100 text-xs rounded shadow-lg w-48 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-normal">
                  {t('structure.sortInfo', {
                    defaultValue: 'Sorting only processes unassigned thoughts, up to 25 at a time.'
                  })}
                </div>
              </div>
            </>
          )}
        </button>
      )
      }

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
              className="space-y-2 flex-grow"
            >
              {localSermonPoints.map((point, index) => (
                <Draggable key={point.id} draggableId={point.id} index={index}>
                  {(providedDraggable, snapshot) => (
                    <li
                      ref={providedDraggable.innerRef}
                      {...providedDraggable.draggableProps}
                      className={`relative flex items-center group p-2 rounded ${snapshot.isDragging ? 'bg-white/30 dark:bg-gray-200/30 shadow-md' : 'hover:bg-white/15 dark:hover:bg-gray-200/15'}`}
                      style={providedDraggable.draggableProps.style}
                    >
                      {/* Drag handle */}
                      <div {...providedDraggable.dragHandleProps} className="cursor-grab mr-2 text-white dark:text-gray-100">
                        <Bars3Icon className="h-5 w-5" />
                      </div>

                      {/* Edit form or display */}
                      {editingPointId === point.id ? (
                        <div ref={editInputRef} className="flex-grow flex items-center space-x-1">
                          <input
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit(); }}
                            className="flex-grow p-1 text-sm bg-white/90 dark:bg-gray-100/90 text-gray-800 dark:text-gray-800 rounded border border-white/30 dark:border-gray-300 focus:outline-none focus:border-white dark:focus:border-gray-400"
                            placeholder={t('structure.editPointPlaceholder')}
                            autoFocus
                          />
                          <button aria-label={t('common.save')} onClick={handleSaveEdit} className="p-1 text-green-400 hover:text-green-300">
                            <CheckIcon className="h-5 w-5" />
                          </button>
                          <button aria-label={t('common.cancel')} onClick={handleCancelEdit} className="p-1 text-red-400 hover:text-red-300">
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-1 min-w-0 items-center gap-2 mr-2">
                            <span
                              className="text-sm text-white dark:text-gray-100 flex-1 min-w-0"
                              onDoubleClick={() => handleStartEdit(point)}
                            >
                              {point.text}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex-shrink-0">
                            {/* Quick help for outline point */}
                            <button aria-label={t('common.edit')} onClick={() => handleStartEdit(point)} className="p-1 text-white/70 dark:text-gray-400 hover:text-white dark:hover:text-gray-200">
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button aria-label={t('common.delete')} onClick={() => handleDeletePoint(point.id)} className="p-1 text-white/70 dark:text-gray-400 hover:text-white dark:hover:text-gray-200">
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                          {thoughtsPerSermonPoint[point.id] > 0 && (
                            <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-xs leading-none align-middle tabular-nums text-gray-700 dark:bg-gray-200 dark:text-gray-700 flex-shrink-0">
                              {thoughtsPerSermonPoint[point.id]}
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}

              {addingNewPoint ? (
                <div ref={addInputRef} className="mt-2 flex items-center space-x-1">
                  <input
                    type="text"
                    value={newPointText}
                    onChange={(e) => setNewPointText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddPoint(); if (e.key === 'Escape') setAddingNewPoint(false); }}
                    placeholder={t('structure.addPointPlaceholder')}
                    className="flex-grow p-2 text-sm bg-white/90 dark:bg-gray-100/90 text-gray-800 dark:text-gray-800 rounded border border-white/30 dark:border-gray-300 focus:outline-none focus:border-white dark:focus:border-gray-400"
                    autoFocus
                  />
                  <button aria-label={t('common.save')} onClick={handleAddPoint} className="p-1 text-green-400 hover:text-green-300">
                    <CheckIcon className="h-5 w-5" />
                  </button>
                  <button aria-label={t('common.cancel')} onClick={() => setAddingNewPoint(false)} className="p-1 text-red-400 hover:text-red-300">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setAddingNewPoint(true); setEditingPointId(null); }}
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
        className={`flex-grow w-full min-w-0 md:min-w-[500px] lg:min-w-[700px] xl:min-w-[900px] min-h-[600px] overflow-y-auto p-6 ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} rounded-lg border-2 shadow-lg transition-all ${borderColor} dark:${UI_COLORS.neutral.darkBorder} ${isOver ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""} relative`}
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
              {/* Render placeholders for each outline point with their thoughts */}
              {localSermonPoints.map((point) => (
                <SermonPointPlaceholder
                  key={point.id}
                  point={point}
                  items={items}
                  containerId={id}
                  onEdit={onEdit}
                  isHighlighted={isItemHighlighted}
                  getHighlightType={getItemHighlightType}
                  onKeepItem={onKeepItem}
                  onRevertItem={onRevertItem}
                  onToggleReviewed={onToggleReviewed}
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
                />
              ))}
              {/* Always show unassigned thoughts section in focus mode */}
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
          {sermonId && onAudioThoughtCreated && (id === 'introduction' || id === 'main' || id === 'conclusion') && (
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
                      onRecordingComplete={async (audioBlob) => {
                        try {
                          setIsRecordingAudio(true);
                          setAudioError(null);
                          const forceTag =
                            id === 'introduction' ? getCanonicalTagForSection('introduction') :
                              id === 'main' ? getCanonicalTagForSection('main') :
                                id === 'conclusion' ? getCanonicalTagForSection('conclusion') :
                                  undefined;
                          const { createAudioThoughtWithForceTag } = await import('@/services/thought.service');
                          const newThought = await createAudioThoughtWithForceTag(audioBlob, sermonId!, forceTag || null);
                          onAudioThoughtCreated?.(newThought, id as 'introduction' | 'main' | 'conclusion');
                          setShowAudioPopover(false);
                          toast.success(
                            t('manualThought.addedSuccess', { defaultValue: 'Thought added successfully' })
                          );
                        } catch (error) {
                          console.error('Error recording audio thought (normal mode):', error);
                          const errorMessage = error instanceof Error ? error.message : t('errors.audioProcessing');
                          setAudioError(String(errorMessage));
                          toast.error(String(errorMessage));
                        } finally {
                          setIsRecordingAudio(false);
                        }
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
              <li key={point.id} className="flex items-center">
                <span>{point.text}</span>
                {thoughtsPerSermonPoint[point.id] > 0 && (
                  <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-xs leading-none align-middle tabular-nums text-gray-700">
                    {thoughtsPerSermonPoint[point.id]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

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
            {/* Render placeholders for each outline point with their thoughts */}
            {localSermonPoints.map((point) => (
              <SermonPointPlaceholder
                key={point.id}
                point={point}
                items={items}
                containerId={id}
                onEdit={onEdit}
                isHighlighted={isItemHighlighted}
                getHighlightType={getItemHighlightType}
                onKeepItem={onKeepItem}
                onRevertItem={onRevertItem}
                onToggleReviewed={onToggleReviewed}
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
              />
            ))}

            {renderUnassignedThoughtsSection(unassignedItemsForDisplay)}
          </div>
        ) : (
          /* Fallback: show all items in simple list if no outline points exist */
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
    );
  }

  // Normal mode UI (non-focused)
  return (
    <div className={`flex flex-col ${className}`}>
      {renderNormalHeader()}
      {renderNormalBody()}
    </div>
  );
}
