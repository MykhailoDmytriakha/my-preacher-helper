import { useState, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Item, SermonPoint, Thought, Sermon, ThoughtsBySection } from "@/models/models";
import { sortItemsWithAI } from "@/services/sortAI.service";
import {
  MAX_AI_SORT_ITEMS,
  getOutlinePointAiSortState,
  hasLockedThoughtAnchorsPreserved,
  replaceScopedItemsInColumn,
} from "@/utils/aiSorting";

import { buildStructureFromContainers, isLocalThoughtId } from "../utils/structure";

type AiSortTarget = {
  columnId: string;
  outlinePointId?: string | null;
};

const MAX_LOCKED_ANCHOR_SORT_ATTEMPTS = 3;

interface UseAiSortingDiffProps {
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: SermonPoint[]; main: SermonPoint[]; conclusion: SermonPoint[] };
  sermon: Sermon | null;
  sermonId: string | null;
  debouncedSaveThought: (sermonId: string, thought: Thought) => void;
  debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection) => void;
}

// Helper function to collect thought updates from highlighted items
const collectThoughtUpdates = (
  highlightedItems: Record<string, { type: 'assigned' | 'moved' }>,
  containers: Record<string, Item[]>,
  sermon: Sermon | null
): Array<{id: string, outlinePointId?: string}> => {
  const thoughtUpdates: Array<{id: string, outlinePointId?: string}> = [];

  for (const itemId of Object.keys(highlightedItems)) {
    for (const items of Object.values(containers)) {
      if (!Array.isArray(items)) continue;

      const item = items.find(i => i.id === itemId);
      if (item && item.outlinePointId && sermon) {
        const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
        if (thought && thought.outlinePointId !== item.outlinePointId) {
          thoughtUpdates.push({
            id: itemId,
            outlinePointId: item.outlinePointId
          });
        }
      }
    }
  }

  return thoughtUpdates;
};

// Helper function to process thought updates
const processThoughtUpdates = (
  thoughtUpdates: Array<{id: string, outlinePointId?: string}>,
  sermon: Sermon,
  debouncedSaveThought: (sermonId: string, thought: Thought) => void,
  sermonId: string
): void => {
  for (const update of thoughtUpdates) {
    const thought = sermon.thoughts.find((t: Thought) => t.id === update.id);
    if (thought) {
      const updatedThought: Thought = {
        ...thought,
        outlinePointId: update.outlinePointId
      };
      debouncedSaveThought(sermonId, updatedThought);
    }
  }
};

// Helper function to create new structure from containers
const createStructureFromContainers = (containers: Record<string, Item[]>): ThoughtsBySection => {
  return buildStructureFromContainers(containers);
};

const resolveAiSortTarget = (target: string | AiSortTarget): AiSortTarget => (
  typeof target === "string" ? { columnId: target } : target
);

const getRetryValidationError = () => new Error("AI_SORT_LOCKED_ANCHORS_INVALID");

export const useAiSortingDiff = ({
  containers,
  setContainers,
  outlinePoints,
  sermon,
  sermonId,
  debouncedSaveThought,
  debouncedSaveStructure,
}: UseAiSortingDiffProps) => {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  
  // AI Sort with Interactive Confirmation state
  const [preSortState, setPreSortState] = useState<Record<string, Item[]> | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, { type: 'assigned' | 'moved' }>>({});
  const [isDiffModeActive, setIsDiffModeActive] = useState<boolean>(false);
  const [isSorting, setIsSorting] = useState(false);
  const [sortingTarget, setSortingTarget] = useState<AiSortTarget | null>(null);

  const handleAiSort = useCallback(async (targetInput: string | AiSortTarget) => {
    const target = resolveAiSortTarget(targetInput);
    const { columnId, outlinePointId } = target;

    if (isSorting || !sermon || !sermonId) return;

    const currentColumnItems: Item[] = containers[columnId] || [];
    const scopedItems = outlinePointId
      ? currentColumnItems.filter((item) => item.outlinePointId === outlinePointId)
      : currentColumnItems;

    if (outlinePointId) {
      const pointSortState = getOutlinePointAiSortState({
        items: currentColumnItems,
        outlinePointId,
        isOnline,
        isSorting,
        isDiffModeActive,
      });

      switch (pointSortState.disabledReason) {
        case "offline":
          toast.info(t("structure.aiSortPointDisabledOffline", {
            defaultValue: "AI sorting is unavailable offline.",
          }));
          return;
        case "sorting":
          return;
        case "review":
          toast.info(t("structure.aiSortPointDisabledReview", {
            defaultValue: "Review or revert current AI suggestions first.",
          }));
          return;
        case "pending":
          toast.info(t("structure.aiSortPointDisabledPending", {
            defaultValue: "Finish syncing local thoughts in this outline point first.",
          }));
          return;
        case "tooMany":
          toast.warning(t("structure.aiSortPointDisabledTooMany", {
            defaultValue: "AI sorting supports up to 25 thoughts in one outline point.",
          }));
          return;
        case "insufficientUnlocked":
          toast.info(t("structure.aiSortPointDisabledTooFewUnlocked", {
            defaultValue: "Need at least 2 unlocked thoughts in this outline point.",
          }));
          return;
        default:
          break;
      }
    }

    const sortableItems = scopedItems.filter((item) => !isLocalThoughtId(item.id));

    if (sortableItems.length === 0) {
      toast.info(t("structure.noItemsToSort", {
        defaultValue: "No items to sort.",
      }));
      return;
    }

    if (sortableItems.length > MAX_AI_SORT_ITEMS) {
      toast.warning(t("structure.tooManyThoughts", {
        defaultValue: "Too many thoughts to sort. Please reduce to 25 or fewer.",
      }));
      return;
    }

    setIsSorting(true);
    setSortingTarget(target);
    setPreSortState({ [columnId]: [...currentColumnItems] });

    try {
      const outlinePointsForColumn = outlinePoints[columnId as keyof typeof outlinePoints] || [];
      const outlinePointsForSort = outlinePointId
        ? outlinePointsForColumn.filter((point) => point.id === outlinePointId)
        : outlinePointsForColumn;

      let sortedItems: Item[] | null = null;

      for (let attempt = 1; attempt <= MAX_LOCKED_ANCHOR_SORT_ATTEMPTS; attempt += 1) {
        const aiSortedItems = await sortItemsWithAI(
          columnId,
          sortableItems,
          sermonId,
          outlinePointsForSort,
        );

        if (!aiSortedItems || !Array.isArray(aiSortedItems)) {
          throw new Error("AI_SORT_FAILED_FORMAT");
        }

        const mergedSortedItems = aiSortedItems.map((sortedItem) => {
          const originalItem = sortableItems.find((item) => item.id === sortedItem.id);
          return originalItem ? { ...originalItem, ...sortedItem } : sortedItem;
        });

        if (!outlinePointId || hasLockedThoughtAnchorsPreserved(sortableItems, mergedSortedItems)) {
          sortedItems = mergedSortedItems;
          break;
        }
      }

      if (!sortedItems) {
        throw getRetryValidationError();
      }

      const finalSortedItems = replaceScopedItemsInColumn({
        columnItems: currentColumnItems,
        scopedItemIds: sortableItems.map((item) => item.id),
        sortedScopedItems: sortedItems,
      });

      const newHighlightedItems: Record<string, { type: 'assigned' | 'moved' }> = {};

      for (const item of sortedItems) {
        const originalItem = sortableItems.find((sortableItem) => sortableItem.id === item.id);
        if (!originalItem) continue;

        if (item.outlinePointId && !originalItem.outlinePointId) {
          newHighlightedItems[item.id] = { type: 'assigned' };
          continue;
        }

        const previousIndex = currentColumnItems.findIndex((columnItem) => columnItem.id === item.id);
        const nextIndex = finalSortedItems.findIndex((columnItem) => columnItem.id === item.id);

        if (previousIndex !== nextIndex) {
          newHighlightedItems[item.id] = { type: 'moved' };
        }
      }

      const hasChanges = Object.keys(newHighlightedItems).length > 0;

      if (hasChanges) {
        setHighlightedItems(newHighlightedItems);
        setIsDiffModeActive(true);
        setContainers((prev) => ({
          ...prev,
          [columnId]: finalSortedItems,
        }));
        toast.success(t('structure.aiSortSuggestionsReady', {
          defaultValue: 'AI sorting completed. Review and confirm the changes.',
        }));
      } else {
        setContainers((prev) => ({
          ...prev,
          [columnId]: finalSortedItems,
        }));
        toast.info(t('structure.aiSortNoChanges', {
          defaultValue: 'AI sort did not suggest any changes.',
        }));
        setPreSortState(null);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "AI_SORT_LOCKED_ANCHORS_INVALID") {
        toast.error(t("structure.aiSortLockedValidationFailed", {
          defaultValue: "AI could not keep locked thoughts fixed. No changes were applied.",
        }));
      } else if (error instanceof Error && error.message === "AI_SORT_FAILED_FORMAT") {
        toast.error(t("errors.aiSortFailedFormat"));
      } else {
        toast.error(t('errors.failedToSortItems'));
      }
      setPreSortState(null);
    } finally {
      setIsSorting(false);
      setSortingTarget(null);
    }
  }, [
    containers,
    isDiffModeActive,
    isOnline,
    isSorting,
    outlinePoints,
    sermon,
    sermonId,
    setContainers,
    t,
  ]);

  // Handler for accepting a single item change
  const handleKeepItem = useCallback((itemId: string, columnId: string) => {
    // Find the current item
    const sectionItems = containers[columnId];
    if (!Array.isArray(sectionItems)) return;
    
    const item = sectionItems.find(i => i.id === itemId);
    if (!item) return;

    // Remove from highlighted items
    setHighlightedItems(prev => {
      const newHighlighted = { ...prev };
      delete newHighlighted[itemId];
      
      // If no more highlighted items, exit diff mode
      if (Object.keys(newHighlighted).length === 0) {
        setIsDiffModeActive(false);
        setPreSortState(null);
      }
      
      return newHighlighted;
    });

    // Persist outline point change if it differs (including clearing to null)
    if (sermon) {
      const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
      if (thought) {
        const prevOutline = (thought.outlinePointId ?? null);
        const nextOutline = (item.outlinePointId ?? null);
        if (prevOutline !== nextOutline) {
          const updatedThought: Thought = {
            ...thought,
            outlinePointId: nextOutline
          };
          debouncedSaveThought(sermonId!, updatedThought);
        }
      }
    }

    // Save the current structure
    const newStructure: ThoughtsBySection = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
  }, [
    containers, 
    sermon, 
    sermonId, 
    debouncedSaveThought, 
    debouncedSaveStructure
  ]);

  // Handler for reverting a single item change
  const handleRevertItem = useCallback((itemId: string, columnId: string) => {
    if (!preSortState || !preSortState[columnId]) return;
    
    // Find the original item state
    const originalItem = preSortState[columnId].find(i => i.id === itemId);
    if (!originalItem) return;
    
    // Find current position in the container
    const currentIndex = containers[columnId].findIndex(i => i.id === itemId);
    if (currentIndex === -1) return;
    
    // Find original position
    const originalIndex = preSortState[columnId].findIndex(i => i.id === itemId);
    
    // Update containers to revert this item
    setContainers(prev => {
      // Create a copy of the current items
      const updatedItems = [...prev[columnId]];
      
      // Remove item from current position
      updatedItems.splice(currentIndex, 1);
      
      // Find proper insertion position (considering other items may have moved)
      let insertPosition = originalIndex;
      if (insertPosition > updatedItems.length) {
        insertPosition = updatedItems.length;
      }
      
      // Insert item at the proper position
      updatedItems.splice(insertPosition, 0, originalItem);
      
      return {
        ...prev,
        [columnId]: updatedItems
      };
    });
    
    // Remove from highlighted items
    setHighlightedItems(prev => {
      const newHighlighted = { ...prev };
      delete newHighlighted[itemId];
      
      // If no more highlighted items, exit diff mode
      if (Object.keys(newHighlighted).length === 0) {
        setIsDiffModeActive(false);
        setPreSortState(null);
      }
      
      return newHighlighted;
    });
    
    // If there was an outline point change, revert it in the database
    if (sermon) {
      const currentItem = containers[columnId][currentIndex];
      if (currentItem.outlinePointId !== originalItem.outlinePointId) {
        const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
        if (thought) {
          // Create reverted thought
          const updatedThought: Thought = {
            ...thought,
            outlinePointId: originalItem.outlinePointId
          };
          
          // Save the thought
          debouncedSaveThought(sermonId!, updatedThought);
        }
      }
    }
    
    // Save the updated structure
    const newStructure: ThoughtsBySection = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
  }, [
    preSortState, 
    containers, 
    setContainers, 
    sermon, 
    sermonId, 
    debouncedSaveThought, 
    debouncedSaveStructure
  ]);

  // Handler for accepting all remaining changes
  const handleKeepAll = useCallback(() => {
    if (!highlightedItems || Object.keys(highlightedItems).length === 0) return;

    // Collect thought updates from highlighted items
    const thoughtUpdates = collectThoughtUpdates(highlightedItems, containers, sermon);

    // Process thought updates
    if (thoughtUpdates.length > 0 && sermon && sermonId) {
      processThoughtUpdates(thoughtUpdates, sermon, debouncedSaveThought, sermonId);
    }

    // Create and save new structure
    const newStructure = createStructureFromContainers(containers);
    debouncedSaveStructure(sermonId!, newStructure);

    // Clear highlighted items and exit diff mode
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);

    // Show confirmation toast
    toast.success(t('structure.aiSortChangesAccepted', {
      defaultValue: 'All AI suggestions accepted.'
    }));
  }, [
    highlightedItems,
    containers,
    sermon,
    sermonId,
    debouncedSaveThought,
    debouncedSaveStructure,
    setHighlightedItems,
    setIsDiffModeActive,
    setPreSortState,
    t
  ]);

  // Handler for reverting all changes
  const handleRevertAll = useCallback((columnId: string) => {
    if (!preSortState || !preSortState[columnId]) return;
    
    // Revert the column to its pre-sort state
    setContainers(prev => ({
      ...prev,
      [columnId]: [...preSortState[columnId]]
    }));
    
    // Clear highlighted items and exit diff mode
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);
    
    // Show confirmation toast
    toast.info(t('structure.aiSortChangesReverted', {
      defaultValue: 'All AI suggestions reverted.'
    }));
  }, [preSortState, setContainers, t]);

  return {
    // State
    preSortState,
    highlightedItems,
    isDiffModeActive,
    isSorting,
    sortingTarget,
    
    // Actions
    handleAiSort,
    handleKeepItem,
    handleRevertItem,
    handleKeepAll,
    handleRevertAll,
    
    // Setters for external use (e.g., when dragging highlighted items)
    setHighlightedItems,
    setIsDiffModeActive,
    setPreSortState,
  };
};
