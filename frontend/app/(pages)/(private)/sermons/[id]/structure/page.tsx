"use client";

import { DndContext, DragOverlay, pointerWithin, type DragEndEvent } from "@dnd-kit/core";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import React, { useState, useEffect, Suspense, useRef, useCallback, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import CardContent from "@/components/CardContent";
import Column from "@/components/Column";
import EditThoughtModal from "@/components/EditThoughtModal";
import { StructurePageSkeleton } from "@/components/skeletons/StructurePageSkeleton";
import { useSermonStructureData } from "@/hooks/useSermonStructureData";
import { Item, Sermon, SermonPoint, Thought, SermonOutline, ThoughtsBySection } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { deleteThought } from "@/services/thought.service";
import "@locales/i18n";
import { getExportContent } from "@/utils/exportContent";
import { getCanonicalTagForSection, normalizeStructureTag } from "@/utils/tagUtils";
import { getSectionLabel } from "@lib/sections";
import { getSermonPlanData } from "@utils/sermonPlanAccess";
import { insertThoughtIdInStructure, resolveSectionFromOutline } from "@utils/thoughtOrdering";

import { AmbiguousSection } from "./components/AmbiguousSection";
import { FocusNav } from "./components/FocusNav";
import { useAiSortingDiff } from "./hooks/useAiSortingDiff";
import { useFocusMode } from "./hooks/useFocusMode";
import { useOutlineStats } from "./hooks/useOutlineStats";
import { usePendingThoughts } from "./hooks/usePendingThoughts";
import { usePersistence } from "./hooks/usePersistence";
import { useSermonActions } from "./hooks/useSermonActions";
import { useStructureDnd } from "./hooks/useStructureDnd";
import { isLocalThoughtId, isStructureChanged, findOutlinePoint } from "./utils/structure";

// Translation key constants
const TRANSLATION_KEYS = {
  ERRORS: {
    SAVING_ERROR: 'errors.savingError',
  },
} as const;

interface UseSermonStructureDataReturn {
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: SermonPoint[]; main: SermonPoint[]; conclusion: SermonPoint[] };
  requiredTagColors: { introduction?: string; main?: string; conclusion?: string };
  allowedTags: { name: string; color: string }[];
  loading: boolean;
  error: string | null;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isAmbiguousVisible: boolean;
  setIsAmbiguousVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function StructurePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StructurePageContent />
    </Suspense>
  );
}

function StructurePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const sermonIdFromPath = params?.id;
  const sermonIdFromQuery = searchParams?.get("sermonId");
  const sermonId = sermonIdFromPath ?? sermonIdFromQuery ?? null;
  const { t } = useTranslation();
  const [isClient, setIsClient] = useState(false);
  const [isVerticalLayout, setIsVerticalLayout] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('structureLayoutVertical') === 'true';
    }
    return false;
  });

  const handleToggleLayout = useCallback(() => {
    setIsVerticalLayout(prev => {
      const next = !prev;
      localStorage.setItem('structureLayoutVertical', String(next));
      return next;
    });
  }, []);

  // Handle switching to plan view
  const handleSwitchToPlan = useCallback((sectionId?: string) => {
    if (sermonId) {
      const url = sectionId
        ? `/sermons/${encodeURIComponent(sermonId)}/plan?section=${sectionId}`
        : `/sermons/${encodeURIComponent(sermonId)}/plan`;
      router.push(url);
    }
  }, [sermonId, router]);

  // Use effect to mark when component is mounted on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Use the hook to manage data fetching and related state
  const {
    sermon,
    setSermon,
    containers,
    setContainers,
    outlinePoints,
    requiredTagColors,
    allowedTags,
    loading,
    error,
    isAmbiguousVisible,
    setIsAmbiguousVisible
  }: UseSermonStructureDataReturn = useSermonStructureData(sermonId, t);

  // Ref to hold the latest containers state
  const containersRef = useRef(containers);
  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);

  const columnTitles = useMemo((): Record<string, string> => ({
    introduction: getSectionLabel(t, 'introduction'),
    main: getSectionLabel(t, 'main'),
    conclusion: getSectionLabel(t, 'conclusion'),
    ambiguous: getSectionLabel(t, 'ambiguous'),
  }), [t]);

  // Persistence hook
  const { debouncedSaveThought, debouncedSaveStructure } = usePersistence({ setSermon });

  const pendingActions = usePendingThoughts({
    sermonId,
    sermon,
    allowedTags,
    setContainers,
    containersRef,
    containers,
  });

  // Sermon actions hook
  const {
    editingItem,
    addingThoughtToSection,
    handleEdit,
    handleCloseEdit,
    handleAddThoughtToSection,
    handleSaveEdit,
    handleMoveToAmbiguous,
    handleRetryPendingThought,
  } = useSermonActions({
    sermon,
    setSermon,
    containers,
    setContainers,
    containersRef,
    allowedTags,
    debouncedSaveThought,
    debouncedSaveStructure,
    pendingActions,
  });

  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Focus mode hook
  const {
    focusedColumn,
    handleToggleFocusMode,
    navigateToSection,
  } = useFocusMode({ searchParams, sermonId });

  // SermonOutline stats hook
  const { thoughtsPerSermonPoint } = useOutlineStats({ sermon, containers });

  // AI sorting diff hook
  const {
    highlightedItems,
    isDiffModeActive,
    isSorting,
    handleAiSort,
    handleKeepItem,
    handleRevertItem,
    handleKeepAll,
    handleRevertAll,
    setHighlightedItems,
    setIsDiffModeActive,
    setPreSortState,
  } = useAiSortingDiff({
    containers,
    setContainers,
    outlinePoints,
    sermon,
    sermonId,
    debouncedSaveThought,
    debouncedSaveStructure,
  });

  // No changes needed here, just removing the old columnTitles definition later

  // DnD hook
  const {
    sensors: dndSensors,
    activeId: dndActiveId,
    handleDragStart: onDragStartHook,
    handleDragOver: onDragOverHook,
    handleDragEnd,
  } = useStructureDnd({
    containers,
    setContainers,
    containersRef,
    sermon,
    setSermon,
    debouncedSaveThought,
  });

  // Safety timeout to prevent stuck drag state (especially on touch devices)
  useEffect(() => {
    if (!dndActiveId) return;

    // If drag is active for more than 30 seconds, something went wrong - reset state
    const safetyTimeout = setTimeout(() => {
      console.warn('[DnD Safety Guard] Drag state timeout detected, resetting');
      // The state will be cleared by the DnD hook's cleanup
    }, 30000);

    return () => clearTimeout(safetyTimeout);
  }, [dndActiveId]);

  // Handle a newly created audio thought: append to data model and UI, and persist structure
  const handleAudioThoughtCreated = useCallback(async (thought: Thought, sectionId: 'introduction' | 'main' | 'conclusion') => {
    if (!sermon) return;

    try {
      const outlineSection = resolveSectionFromOutline(sermon, thought.outlinePointId ?? null);
      const finalSection = outlineSection && outlineSection !== 'ambiguous' ? outlineSection : sectionId;
      const sectionTag = getCanonicalTagForSection(finalSection);

      // Compute custom tags (exclude structural tag), preserving original order
      const customTags = (thought.tags || []).filter((tag) => normalizeStructureTag(tag) === null);

      // Build UI item - find outline point if available
      const outlinePoint = findOutlinePoint(thought.outlinePointId ?? undefined, sermon);

      const newItem: Item = {
        id: thought.id,
        content: thought.text,
        requiredTags: [sectionTag],
        customTagNames: customTags.map((name) => ({
          name,
          color: allowedTags.find((t) => t.name === name)?.color || '#4c51bf',
        })),
        outlinePointId: thought.outlinePointId,
        outlinePoint,
      };

      // 1) Update containers UI (append to end of the target section)
      setContainers((prev) => {
        const next = { ...prev };
        const items = prev[finalSection] || [];
        const insertAtOutlineGroupEnd = (list: Item[], item: Item): Item[] => {
          if (!item.outlinePointId) return [...list, item];
          let lastIndex = -1;
          list.forEach((existing, index) => {
            if (existing.outlinePointId === item.outlinePointId) {
              lastIndex = index;
            }
          });
          if (lastIndex === -1) return [...list, item];
          const nextList = [...list];
          nextList.splice(lastIndex + 1, 0, item);
          return nextList;
        };
        next[finalSection] = insertAtOutlineGroupEnd(items, newItem);
        return next;
      });

      // 2) Persist updated structure (append id to the section)
      const insertAtOutlineGroupEnd = (list: Item[], item: Item): Item[] => {
        if (!item.outlinePointId) return [...list, item];
        let lastIndex = -1;
        list.forEach((existing, index) => {
          if (existing.outlinePointId === item.outlinePointId) {
            lastIndex = index;
          }
        });
        if (lastIndex === -1) return [...list, item];
        const nextList = [...list];
        nextList.splice(lastIndex + 1, 0, item);
        return nextList;
      };
      const updatedContainers = {
        ...containersRef.current,
        [finalSection]: insertAtOutlineGroupEnd(containersRef.current[finalSection] || [], newItem),
      } as Record<string, Item[]>;

      containersRef.current = updatedContainers;

      const thoughtsById = new Map(
        [...(sermon.thoughts || []), thought].map((t) => [t.id, t])
      );
      const newStructure = insertThoughtIdInStructure({
        structure: {
          introduction: (updatedContainers.introduction || []).map((it) => it.id),
          main: (updatedContainers.main || []).map((it) => it.id),
          conclusion: (updatedContainers.conclusion || []).map((it) => it.id),
          ambiguous: (updatedContainers.ambiguous || []).map((it) => it.id),
        },
        section: finalSection,
        thoughtId: thought.id,
        outlinePointId: thought.outlinePointId,
        thoughtsById,
        thoughts: [...(sermon.thoughts || []), thought],
        outline: sermon.outline,
      });

      // 3) Update sermon state (thoughts + structure)
      setSermon((prev) => prev ? { ...prev, thoughts: [...prev.thoughts, thought], structure: newStructure, thoughtsBySection: newStructure } : prev);

      // Use debounced structure save
      debouncedSaveStructure(sermon.id, newStructure);
    } catch (e) {
      console.error('Error handling audio thought creation:', e);
      toast.error(t(TRANSLATION_KEYS.ERRORS.SAVING_ERROR));
    }
  }, [allowedTags, debouncedSaveStructure, sermon, t, setContainers, setSermon]);

  const getExportContentForFocusedColumn = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => {
    if (!focusedColumn || !sermon) {
      return '';
    }

    // Pass format and includeTags parameters to getExportContent
    return getExportContent(sermon, focusedColumn, {
      format,
      includeTags: options?.includeTags
    });
  };

  const planData = useMemo(() => {
    return getSermonPlanData(sermon);
  }, [sermon]);

  // REVISED HANDLER: Function to DELETE a thought and remove it from the structure
  const handleRemoveFromStructure = async (itemId: string, containerId: string) => {
    if (!sermonId || !sermon || containerId !== 'ambiguous') {
      toast.error(t('errors.removingError') || "Error removing item.");
      return;
    }

    // Find thought first to use its text in confirmation
    const thoughtToDelete = sermon.thoughts.find(t => t.id === itemId);
    if (!thoughtToDelete) {
      toast.error(t('errors.deletingError') || "Failed to find thought to delete.");
      return;
    }

    const confirmMessage = t('sermon.deleteThoughtConfirm', {
      defaultValue: `Are you sure you want to permanently delete this thought: "${thoughtToDelete.text}"?`,
      text: thoughtToDelete.text
    });
    if (!window.confirm(confirmMessage)) {
      return;
    }

    // Set deleting state BEFORE async call
    setDeletingItemId(itemId);

    try {
      await deleteThought(sermonId, thoughtToDelete);

      // --- Update State on Successful Deletion ---
      // Capture previous state for potential rollback (though less critical here)
      const previousSermon = sermon;
      const previousContainers = { ...containersRef.current };

      // 1. Update main sermon state (using a loop instead of filter)
      const updatedThoughts: Thought[] = [];
      for (const thought of previousSermon.thoughts) {
        if (thought.id !== itemId) {
          updatedThoughts.push(thought);
        }
      }
      const sermonWithDeletedThought = { ...previousSermon, thoughts: updatedThoughts };

      // 2. Update local containers state
      const updatedAmbiguous = previousContainers.ambiguous.filter((item: Item) => item.id !== itemId);
      const newContainers: Record<string, Item[]> = {
        ...previousContainers,
        ambiguous: updatedAmbiguous
      };

      // 3. Recalculate structure for DB update (based on updated containers)
      const newStructure: ThoughtsBySection = {
        introduction: (newContainers.introduction || []).map((item: Item) => item.id),
        main: (newContainers.main || []).map((item: Item) => item.id),
        conclusion: (newContainers.conclusion || []).map((item: Item) => item.id),
        ambiguous: (newContainers.ambiguous || []).map((item: Item) => item.id),
      };

      // 4. Update UI *after* successful deletion confirmation
      setSermon(sermonWithDeletedThought); // Update sermon state 
      setContainers(newContainers); // Update containers state
      containersRef.current = newContainers; // Keep ref in sync

      // 5. Update structure in DB (if changed)
      const structureDidChange = isStructureChanged(previousSermon.structure || {}, newStructure);
      if (structureDidChange) {
        try {
          await updateStructure(sermonId, newStructure);
        } catch {
          toast.error(t(TRANSLATION_KEYS.ERRORS.SAVING_ERROR) || "Error saving structure changes after deleting item.");
        }
      }

      toast.success(t('structure.thoughtDeletedSuccess') || "Thought deleted successfully.");

    } catch {
      toast.error(t('errors.deletingError') || "Failed to delete thought.");
    } finally {
      // Clear deleting state AFTER operation (success or error)
      setDeletingItemId(null);
    }
  };

  // Function to handle outline updates from Column components
  const handleOutlineUpdate = (updatedOutline: SermonOutline) => {
    setSermon((prevSermon: Sermon | null) => {
      if (!prevSermon) return null;

      // Merge the updated outline sections with existing ones
      const mergedOutline: SermonOutline = {
        introduction: updatedOutline.introduction.length > 0 ? updatedOutline.introduction : (prevSermon.outline?.introduction || []),
        main: updatedOutline.main.length > 0 ? updatedOutline.main : (prevSermon.outline?.main || []),
        conclusion: updatedOutline.conclusion.length > 0 ? updatedOutline.conclusion : (prevSermon.outline?.conclusion || [])
      };

      return {
        ...prevSermon,
        outline: mergedOutline
      };
    });
  };

  const handleToggleReviewed = async (outlinePointId: string, isReviewed: boolean) => {
    if (!sermon) return;

    try {
      // Find and update the outline point in the outline
      const updatedOutline: SermonOutline = {
        introduction: sermon.outline?.introduction?.map(point =>
          point.id === outlinePointId ? { ...point, isReviewed } : point
        ) || [],
        main: sermon.outline?.main?.map(point =>
          point.id === outlinePointId ? { ...point, isReviewed } : point
        ) || [],
        conclusion: sermon.outline?.conclusion?.map(point =>
          point.id === outlinePointId ? { ...point, isReviewed } : point
        ) || []
      };

      // Update sermon state
      setSermon(prevSermon => prevSermon ? { ...prevSermon, outline: updatedOutline } : null);

      // Save to backend
      const { updateSermonOutline } = await import('@/services/outline.service');
      await updateSermonOutline(sermon.id, updatedOutline);

      toast.success(t(isReviewed ? 'structure.markedAsReviewed' : 'structure.markedAsUnreviewed', {
        defaultValue: isReviewed ? 'Marked as reviewed' : 'Marked as unreviewed'
      }));
    } catch (error) {
      console.error('Error updating outline point review status:', error);
      toast.error(t(TRANSLATION_KEYS.ERRORS.SAVING_ERROR));
    }
  };

  const handleOutlinePointDeleted = (pointId: string, sectionId: string) => {
    if (!sermon) return;

    const thoughtsToUpdate = sermon.thoughts.filter(t => t.outlinePointId === pointId);
    if (thoughtsToUpdate.length === 0) return;

    try {
      // 1. Update local sermon state
      setSermon(prevSermon => {
        if (!prevSermon) return null;
        return {
          ...prevSermon,
          thoughts: prevSermon.thoughts.map(thought =>
            thought.outlinePointId === pointId
              ? { ...thought, outlinePointId: undefined }
              : thought
          )
        };
      });

      // 2. Update local containers state so UI updates
      setContainers(prevContainers => {
        const nextContainers = { ...prevContainers };
        if (nextContainers[sectionId]) {
          nextContainers[sectionId] = nextContainers[sectionId].map(item =>
            item.outlinePointId === pointId
              ? { ...item, outlinePointId: undefined, outlinePoint: undefined }
              : item
          );
        }
        return nextContainers;
      });

      // 3. Update backend for each thought
      thoughtsToUpdate.forEach(thought => {
        debouncedSaveThought(sermon.id, { ...thought, outlinePointId: null });
      });

    } catch (error) {
      console.error('Error updating thoughts after outline point deletion:', error);
      toast.error(t('errors.saveOutlineError', { defaultValue: 'Error updating thoughts' }));
    }
  };

  const handleAddOutlinePoint = async (sectionId: string, index: number, text: string) => {
    if (!sermon || !text.trim()) return;

    try {
      // 1. Generate a temporary ID for the new point
      const newPointId = `temp-${Date.now()}`;
      const newPoint: SermonPoint = {
        id: newPointId,
        text: text.trim(),
        isReviewed: false
      };

      // 2. clone existing outline
      const updatedOutline: SermonOutline = {
        introduction: [...(sermon.outline?.introduction || [])],
        main: [...(sermon.outline?.main || [])],
        conclusion: [...(sermon.outline?.conclusion || [])]
      };

      // 3. insert new point at specified index
      const sectionPoints = updatedOutline[sectionId as keyof SermonOutline] || [];
      if (index >= sectionPoints.length) {
        sectionPoints.push(newPoint);
      } else {
        sectionPoints.splice(index, 0, newPoint);
      }
      updatedOutline[sectionId as keyof SermonOutline] = sectionPoints;

      // 4. Update local sermon state
      setSermon(prev => prev ? { ...prev, outline: updatedOutline } : null);

      // 5. Save to backend
      const { updateSermonOutline } = await import('@/services/outline.service');
      await updateSermonOutline(sermon.id, updatedOutline);

    } catch (error) {
      console.error('Error adding outline point:', error);
      toast.error(t('errors.saveOutlineError', { defaultValue: 'Error updating outline' }));
    }
  };

  const onDragEndWrapper = (event: DragEndEvent) => {
    const { active } = event;
    const activeKey = String(active?.id ?? "");
    if (activeKey && activeKey in highlightedItems) {
      setHighlightedItems((prev) => {
        const next = { ...prev } as typeof prev;
        delete next[activeKey];
        if (Object.keys(next).length === 0) {
          setIsDiffModeActive(false);
          setPreSortState(null);
        }
        return next;
      });
    }
    handleDragEnd(event);
  };

  // Add loading and error handling based on the hook's state
  if (loading) {
    return <StructurePageSkeleton isFocusMode={!!focusedColumn} />;
  }

  if (error) {
    // Display error message from hook, potentially already handled by toast in hook
    return <div className="text-red-500 p-4">{isClient ? t('errors.fetchSermonStructureError') : "Error"}: {error}</div>;
  }

  if (!sermon) {
    return <div className="p-4">{isClient ? t('structure.sermonNotFound') : "Sermon not found"}</div>;
  }

  return (
    <div className="p-4">
      <div className={`w-full`}>
        <div className="mb-4">
          <h1 className="text-4xl font-extrabold text-center mb-2 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            {t('structure.title')} {sermon.title}
          </h1>
          <FocusNav
            sermon={sermon}
            sermonId={sermonId}
            focusedColumn={focusedColumn}
            onToggleFocusMode={handleToggleFocusMode}
            onNavigateToSection={navigateToSection}
          />
          {/* Layout toggle button — only shown when not in focus mode */}
          {!focusedColumn && (
            <div className="flex justify-end mt-2">
              <button
                onClick={handleToggleLayout}
                title={isVerticalLayout ? t('structure.switchToHorizontalLayout', { defaultValue: 'Switch to horizontal layout' }) : t('structure.switchToVerticalLayout', { defaultValue: 'Switch to vertical layout' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600"
                data-testid="layout-toggle-button"
              >
                {isVerticalLayout ? (
                  // Horizontal layout icon (3 columns)
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="5" height="18" rx="1" />
                    <rect x="10" y="3" width="5" height="18" rx="1" />
                    <rect x="17" y="3" width="5" height="18" rx="1" />
                  </svg>
                ) : (
                  // Vertical layout icon (stacked rows)
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="5" rx="1" />
                    <rect x="3" y="10" width="18" height="5" rx="1" />
                    <rect x="3" y="17" width="18" height="5" rx="1" />
                  </svg>
                )}
                <span>{isVerticalLayout ? t('structure.horizontalLayout', { defaultValue: 'Horizontal' }) : t('structure.verticalLayout', { defaultValue: 'Vertical' })}</span>
              </button>
            </div>
          )}
        </div>

        <DndContext
          data-testid="dnd-context"
          sensors={dndSensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStartHook}
          onDragOver={onDragOverHook}
          onDragEnd={onDragEndWrapper}
        >
          <AmbiguousSection
            items={containers.ambiguous}
            isVisible={isAmbiguousVisible}
            onToggleVisibility={() => setIsAmbiguousVisible(!isAmbiguousVisible)}
            onEdit={handleEdit}
            onDelete={handleRemoveFromStructure}
            deletingItemId={deletingItemId}
            activeId={dndActiveId}
            focusedColumn={focusedColumn}
            columnTitle={columnTitles["ambiguous"]}
          />

          <div className={`${!focusedColumn ? (isVerticalLayout ? 'flex flex-col gap-6' : 'grid grid-cols-1 md:grid-cols-3 gap-6') : 'flex flex-col'} w-full mt-8`}>
            {/* Introduction column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "introduction") && (
              <Column
                key="introduction"
                id="introduction"
                title={getSectionLabel(t, 'introduction')}
                items={containers.introduction || []}
                headerColor={requiredTagColors.introduction}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.introduction}
                showFocusButton={true}
                isFocusMode={focusedColumn === "introduction"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("introduction")}
                isLoading={isSorting && focusedColumn === "introduction"}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                isDiffModeActive={isDiffModeActive}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("introduction")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
                onToggleReviewed={handleToggleReviewed}
                onSwitchPage={handleSwitchToPlan}
                onNavigateToSection={navigateToSection}
                onRetryPendingThought={handleRetryPendingThought}
                planData={planData}
                onOutlinePointDeleted={handleOutlinePointDeleted}
                onAddOutlinePoint={handleAddOutlinePoint}
              />
            )}

            {/* Main column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "main") && (
              <Column
                key="main"
                id="main"
                title={getSectionLabel(t, 'main')}
                items={containers.main || []}
                headerColor={requiredTagColors.main}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.main}
                showFocusButton={true}
                isFocusMode={focusedColumn === "main"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("main")}
                isLoading={isSorting && focusedColumn === "main"}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                isDiffModeActive={isDiffModeActive}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("main")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
                onToggleReviewed={handleToggleReviewed}
                onSwitchPage={handleSwitchToPlan}
                onNavigateToSection={navigateToSection}
                onRetryPendingThought={handleRetryPendingThought}
                planData={planData}
                onOutlinePointDeleted={handleOutlinePointDeleted}
                onAddOutlinePoint={handleAddOutlinePoint}
              />
            )}
            {(!focusedColumn || focusedColumn === "conclusion") && (
              <Column
                key="conclusion"
                id="conclusion"
                title={getSectionLabel(t, 'conclusion')}
                items={containers.conclusion || []}
                headerColor={requiredTagColors.conclusion}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.conclusion}
                showFocusButton={true}
                isFocusMode={focusedColumn === "conclusion"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("conclusion")}
                isLoading={isSorting && focusedColumn === "conclusion"}
                getExportContent={getExportContentForFocusedColumn}
                sermonId={sermonId || undefined}
                onAddThought={handleAddThoughtToSection}
                onAudioThoughtCreated={handleAudioThoughtCreated}
                onOutlineUpdate={handleOutlineUpdate}
                thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                isDiffModeActive={isDiffModeActive}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={handleKeepAll}
                onRevertAll={() => handleRevertAll("conclusion")}
                activeId={dndActiveId}
                onMoveToAmbiguous={handleMoveToAmbiguous}
                onToggleReviewed={handleToggleReviewed}
                onSwitchPage={handleSwitchToPlan}
                onNavigateToSection={navigateToSection}
                onRetryPendingThought={handleRetryPendingThought}
                planData={planData}
                onOutlinePointDeleted={handleOutlinePointDeleted}
                onAddOutlinePoint={handleAddOutlinePoint}
              />
            )}
          </div>
          <DragOverlay>
            {dndActiveId && (() => {
              const containerKey = Object.keys(containers).find(
                (key) => containers[key].some((item) => item.id === dndActiveId)
              );

              const activeItem = containerKey
                ? containers[containerKey].find((item) => item.id === dndActiveId)
                : null;

              return activeItem ? (
                <div
                  className="flex items-start space-x-2 p-4 bg-white dark:bg-gray-800 rounded-md border border-gray-300 dark:border-gray-600 shadow-lg"
                  style={{
                    width: 'auto',
                    opacity: 1,                    // Always fully visible
                    zIndex: 9999,                  // Above everything
                    pointerEvents: 'none',         // Don't intercept pointer events
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',  // Slightly transparent
                  }}
                >
                  <div className="flex-grow">
                    <CardContent item={activeItem} />
                  </div>
                  <div className="flex flex-col space-y-1 w-8 flex-shrink-0">
                  </div>
                </div>
              ) : null;
            })()}
          </DragOverlay>
        </DndContext>
        {editingItem && (
          <EditThoughtModal
            initialText={editingItem.content}
            initialTags={editingItem.customTagNames?.map((tag) => tag.name) || []}
            initialSermonPointId={editingItem.outlinePointId || undefined}
            allowedTags={allowedTags}
            sermonOutline={sermon?.outline}
            containerSection={addingThoughtToSection || Object.keys(containers).find(key =>
              containers[key].some(item => item.id === editingItem.id)
            )}
            onSave={handleSaveEdit}
            onClose={handleCloseEdit}
            allowOffline={editingItem.id.startsWith('temp-') || isLocalThoughtId(editingItem.id)}
          />
        )}
      </div>
    </div>
  );
}
