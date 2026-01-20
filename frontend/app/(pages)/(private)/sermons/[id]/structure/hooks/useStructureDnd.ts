import {
  useSensors,
  useSensor,
  MouseSensor,
  TouchSensor,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent
} from "@dnd-kit/core";
import { useState, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Item, Sermon, SermonPoint, Thought } from "@/models/models";
import { updateStructure } from "@/services/structure.service";


import {
  isStructureChanged,
  dedupeIds,
  ensureUniqueItems,
  removeIdFromOtherSections,
  calculateGroupPosition
} from "../utils/structure";

// Constants for drag target prefixes
const OUTLINE_POINT_PREFIX = 'outline-point-';
const UNASSIGNED_PREFIX = 'unassigned-';

// Helper function to determine destination container and outline point
const determineDestination = (
  overId: string,
  over: { data?: { current?: { container?: string; outlinePointId?: string } } },
  state: Record<string, Item[]>
): { dstContainerKey: string | undefined; targetSermonPointId: string | null | undefined } => {
  let dstContainerKey: string | undefined = over.data?.current?.container as string | undefined;
  let targetSermonPointId: string | null | undefined = over.data?.current?.outlinePointId as string | undefined;

  if (overId.startsWith(OUTLINE_POINT_PREFIX)) {
    dstContainerKey = over.data?.current?.container as string | undefined;
    targetSermonPointId = (over.data?.current?.outlinePointId as string) || undefined;
  } else if (overId.startsWith(UNASSIGNED_PREFIX)) {
    dstContainerKey = over.data?.current?.container as string | undefined;
    targetSermonPointId = null;
  } else if (!dstContainerKey) {
    // over on item or container id
    dstContainerKey = ["introduction", "main", "conclusion", "ambiguous"].includes(overId)
      ? overId
      : Object.keys(state).find((k) => state[k].some((it) => it.id === overId));
    if (!dstContainerKey) return { dstContainerKey: undefined, targetSermonPointId: undefined };

    // If over is an item, inherit its outline point group for preview
    if (overId !== dstContainerKey) {
      const overIdx = state[dstContainerKey].findIndex((it) => it.id === overId);
      if (overIdx !== -1) {
        targetSermonPointId = state[dstContainerKey][overIdx].outlinePointId ?? null;
      }
    }
  }

  return { dstContainerKey, targetSermonPointId };
};

// Helper function to calculate insertion index
const calculateInsertIndex = (
  overId: string,
  dstContainerKey: string,
  targetSermonPointId: string | null | undefined,
  state: Record<string, Item[]>
): number => {
  let insertIndex = state[dstContainerKey].length;

  if (overId !== dstContainerKey && !overId.startsWith(OUTLINE_POINT_PREFIX) && !overId.startsWith(UNASSIGNED_PREFIX)) {
    const overIdx = state[dstContainerKey].findIndex((it) => it.id === overId);
    if (overIdx !== -1) insertIndex = overIdx; // insert before target item
  } else if (targetSermonPointId !== undefined) {
    // Append to end of that group
    const groupKey = targetSermonPointId || null;
    // find last index of items in that group
    let lastGroupIndex = -1;
    for (let i = 0; i < state[dstContainerKey].length; i++) {
      const it = state[dstContainerKey][i];
      const itGroup = (it.outlinePointId ?? null);
      if (itGroup === groupKey) lastGroupIndex = i;
    }
    insertIndex = lastGroupIndex === -1 ? state[dstContainerKey].length : lastGroupIndex + 1;
  }

  return insertIndex;
};

// Helper function to check if update is needed
const shouldSkipUpdate = (
  srcContainerKey: string,
  dstContainerKey: string,
  insertIndex: number,
  dragged: Item,
  intendedOutline: string | undefined,
  state: Record<string, Item[]>
): boolean => {
  if (srcContainerKey === dstContainerKey) {
    const currentIdx = state[dstContainerKey].findIndex((it) => it.id === dragged.id);
    const sameGroup = (dragged.outlinePointId ?? undefined) === intendedOutline;
    const noReorder = insertIndex === currentIdx || insertIndex === currentIdx + 1;
    if (sameGroup && noReorder) {
      return true;
    }
  } else {
    const currentDestIdx = state[dstContainerKey].findIndex((it) => it.id === dragged.id);
    if (currentDestIdx !== -1) {
      const alreadyAtIndex = currentDestIdx === insertIndex;
      const alreadyGroup = (state[dstContainerKey][currentDestIdx].outlinePointId ?? undefined) === intendedOutline;
      if (alreadyAtIndex && alreadyGroup) {
        return true;
      }
    }
  }
  return false;
};

// Helper: Identify drop target and metadata
interface DropTargetInfo {
  overContainer: string;
  outlinePointId: string | null | undefined;
  droppedOnItem: boolean;
  targetItemIndex: number;
  targetItemSermonPointId: string | null;
}

const identifyDropTarget = (
  over: DragEndEvent['over'],
  containers: Record<string, Item[]>
): DropTargetInfo => {
  // Provide defaults if over is null (shouldn't happen but TypeScript requires it)
  if (!over) {
    return {
      overContainer: '',
      outlinePointId: undefined,
      droppedOnItem: false,
      targetItemIndex: -1,
      targetItemSermonPointId: null,
    };
  }

  let overContainer = over.data.current?.container;
  let outlinePointId = over.data.current?.outlinePointId;
  let droppedOnItem = false;
  let targetItemIndex = -1;
  let targetItemSermonPointId: string | null = null;

  // Check if we're dropping on an outline point placeholder
  if (over.id.toString().startsWith(OUTLINE_POINT_PREFIX)) {
    const dropTargetId = over.id.toString();
    outlinePointId = dropTargetId.replace(OUTLINE_POINT_PREFIX, '');
    overContainer = over.data.current?.container;
  } else if (over.id.toString().startsWith(UNASSIGNED_PREFIX)) {
    outlinePointId = null;
    overContainer = over.data.current?.container;
  } else if (over.id === "dummy-drop-zone" || over.id === "ambiguous-additional-drop") {
    overContainer = "ambiguous";
  } else if (!overContainer) {
    overContainer = String(over.id);
  }

  // Find the index of the target item in the destination container
  if (
    over.id !== overContainer &&
    !over.id.toString().startsWith(OUTLINE_POINT_PREFIX) &&
    !over.id.toString().startsWith(UNASSIGNED_PREFIX)
  ) {
    droppedOnItem = true;
    targetItemIndex = containers[overContainer]?.findIndex((item) => item.id === over.id) ?? -1;
    if (targetItemIndex !== -1) {
      const targetItem = containers[overContainer][targetItemIndex];
      targetItemSermonPointId = targetItem?.outlinePointId ?? null;
    }
  }

  return {
    overContainer,
    outlinePointId,
    droppedOnItem,
    targetItemIndex,
    targetItemSermonPointId,
  };
};

// Helper: Calculate item placement in containers
const calculateItemPlacement = (
  containers: Record<string, Item[]>,
  activeContainer: string,
  overContainer: string,
  activeId: string | number,
  droppedOnItem: boolean,
  targetItemIndex: number
): Record<string, Item[]> => {
  const updatedContainers = { ...containers };

  if (activeContainer === overContainer) {
    const items = [...updatedContainers[activeContainer]];
    const oldIndex = items.findIndex((item) => item.id === activeId);

    if (oldIndex !== -1) {
      if (droppedOnItem && targetItemIndex !== -1) {
        const [draggedItem] = items.splice(oldIndex, 1);
        items.splice(targetItemIndex, 0, draggedItem);
      } else if (!droppedOnItem) {
        const [draggedItem] = items.splice(oldIndex, 1);
        items.push(draggedItem);
      }

      updatedContainers[activeContainer] = items;
    }
  } else {
    const activeItems = [...updatedContainers[activeContainer]];
    const overItems = [...updatedContainers[overContainer]];

    const activeIndex = activeItems.findIndex((item) => item.id === activeId);
    if (activeIndex !== -1) {
      const [draggedItem] = activeItems.splice(activeIndex, 1);

      if (droppedOnItem && targetItemIndex !== -1) {
        overItems.splice(targetItemIndex, 0, draggedItem);
      } else {
        overItems.push(draggedItem);
      }

      updatedContainers[activeContainer] = activeItems;
      updatedContainers[overContainer] = overItems;
    }
  }

  return updatedContainers;
};

// Helper: Determine outline point assignment
const determineOutlinePointAssignment = (
  outlinePointId: string | null | undefined,
  droppedOnItem: boolean,
  targetItemSermonPointId: string | null,
  movedItem: Item,
  activeContainer: string,
  overContainer: string,
  sermon: Sermon
): string | null | undefined => {
  // If dropped on a specific item and no explicit outline point target was set,
  // inherit the target item's outline point assignment
  if (typeof outlinePointId === 'undefined' && droppedOnItem) {
    return targetItemSermonPointId;
  }

  // If dropped on container area (not a specific item or special placeholder),
  // default to unassigned in the current/target section
  if (typeof outlinePointId === 'undefined' && !droppedOnItem) {
    return null;
  }

  // Explicit assignment
  if (typeof outlinePointId === 'string') {
    return outlinePointId;
  }

  if (outlinePointId === null) {
    return null;
  }

  // No explicit outline point change requested
  const preliminarySermonPointId: string | null | undefined = movedItem.outlinePointId;

  // If container changed and previous outline point belongs to a different section, clear it
  if (activeContainer !== overContainer && preliminarySermonPointId && sermon.outline) {
    const sectionPoints =
      overContainer === 'introduction' ? sermon.outline.introduction
        : overContainer === 'main' ? sermon.outline.main
          : overContainer === 'conclusion' ? sermon.outline.conclusion
            : [];
    const belongsToNewSection = sectionPoints?.some((p: SermonPoint) => p.id === preliminarySermonPointId);
    if (!belongsToNewSection) {
      return null;
    }
  }

  return preliminarySermonPointId;
};

// Helper: Build updated item with new properties
const buildUpdatedItem = (
  movedItem: Item,
  overContainer: string,
  finalSermonPointId: string | null | undefined,
  columnTitles: Record<string, string>,
  updatedContainers: Record<string, Item[]>,
  movedIndex: number
): Item => {
  // Determine the correct required tag for the destination container
  let updatedRequiredTags: string[] = [];
  if (["introduction", "main", "conclusion"].includes(String(overContainer))) {
    updatedRequiredTags = [columnTitles[overContainer as keyof typeof columnTitles]];
  }

  // Compute new positional rank within the destination group
  const groupKey = finalSermonPointId || '__unassigned__';
  const newPos = calculateGroupPosition(updatedContainers[overContainer], movedIndex, groupKey);

  return {
    ...movedItem,
    requiredTags: updatedRequiredTags,
    outlinePointId: finalSermonPointId,
    position: newPos,
  };
};

// Helper: Persist thought change
const persistThoughtChange = (
  sermon: Sermon,
  movedItem: Item,
  updatedRequiredTags: string[],
  finalSermonPointId: string | null | undefined,
  newPos: number,
  debouncedSaveThought: (sermonId: string, thought: Thought) => void
): boolean => {
  const thought = sermon.thoughts.find((t: Thought) => t.id === movedItem.id);
  if (thought) {
    const updatedThought: Thought = {
      ...thought,
      tags: [
        ...updatedRequiredTags,
        ...(movedItem.customTagNames || []).map((tag) => tag.name),
      ],
      outlinePointId: finalSermonPointId,
      position: newPos,
    };
    debouncedSaveThought(sermon.id, updatedThought);
    return true;
  }
  return false;
};

// Helper: Handle structure update
const handleStructureUpdate = async (
  sermon: Sermon,
  newStructure: { introduction: string[]; main: string[]; conclusion: string[]; ambiguous: string[] },
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>
): Promise<void> => {
  const changesDetected = isStructureChanged(sermon.structure || {}, newStructure);
  if (changesDetected) {
    await updateStructure(sermon.id, newStructure);
    setSermon((prev: Sermon | null) => (prev ? { ...prev, structure: newStructure } : prev));
  }
};

interface UseStructureDndProps {
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  containersRef: React.MutableRefObject<Record<string, Item[]>>;
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  columnTitles: Record<string, string>;
  debouncedSaveThought: (sermonId: string, thought: Thought) => void;
}

export const useStructureDnd = ({
  containers,
  setContainers,
  containersRef,
  sermon,
  setSermon,
  columnTitles,
  debouncedSaveThought,
}: UseStructureDndProps) => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [originalContainer, setOriginalContainer] = useState<string | null>(null);
  const [isDragEnding, setIsDragEnding] = useState(false);

  // Setup sensors - using MouseSensor + TouchSensor for better touch support
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100,      // Reduced from 200ms for better UX
        tolerance: 8,
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);

    setIsDragEnding(false);
    setActiveId(id);

    // Capture the original container at the start of the drag
    const original = Object.keys(containers).find((key) =>
      containers[key].some((item) => item.id === id)
    );
    setOriginalContainer(original || null);
  }, [containers]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || isDragEnding) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Determine current containers based on latest ref
    const state = containersRef.current;
    const srcContainerKey = Object.keys(state).find((k) => state[k].some((it) => it.id === activeId));
    if (!srcContainerKey) return;

    // Determine destination container and outline point
    const { dstContainerKey, targetSermonPointId } = determineDestination(overId, over, state);
    if (!dstContainerKey) return;

    // Early compute current positions before building draft
    const srcIdx = state[srcContainerKey].findIndex((it) => it.id === activeId);
    if (srcIdx === -1) return;
    const dragged = state[srcContainerKey][srcIdx];

    // Calculate insertion index
    const insertIndex = calculateInsertIndex(overId, dstContainerKey, targetSermonPointId, state);

    const intendedOutline: string | undefined =
      targetSermonPointId === undefined ? (dragged.outlinePointId || undefined) : (targetSermonPointId || undefined);

    // Check if update is needed
    if (shouldSkipUpdate(srcContainerKey, dstContainerKey, insertIndex, dragged, intendedOutline, state)) {
      return;
    }

    // Build new state preview
    const draft: Record<string, Item[]> = { ...state };
    const previewItem: Item = { ...dragged, outlinePointId: intendedOutline };

    if (srcContainerKey === dstContainerKey) {
      const arr = [...state[srcContainerKey]];
      arr.splice(srcIdx, 1);
      const safeIndex = Math.min(Math.max(insertIndex, 0), arr.length);
      arr.splice(safeIndex, 0, previewItem);
      draft[srcContainerKey] = arr;
    } else {
      draft[srcContainerKey] = [...state[srcContainerKey]];
      draft[dstContainerKey] = [...state[dstContainerKey]];
      draft[srcContainerKey].splice(srcIdx, 1);
      draft[dstContainerKey].splice(insertIndex, 0, previewItem);
    }

    // Store preview state in ref only - don't trigger re-render during drag
    containersRef.current = draft;
  }, [isDragEnding, containersRef]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    // Set drag ending flag immediately to prevent interference
    setIsDragEnding(true);

    // Early return if no valid drop target
    if (!over || !sermon) {
      setActiveId(null);
      setOriginalContainer(null);
      setIsDragEnding(false);
      return;
    }

    const activeContainer = originalContainer;

    // Identify drop target
    const dropTarget = identifyDropTarget(over, containers);
    const { overContainer, outlinePointId, droppedOnItem, targetItemIndex, targetItemSermonPointId } = dropTarget;

    if (
      !activeContainer ||
      !overContainer ||
      !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
    ) {
      setActiveId(null);
      setOriginalContainer(null);
      setIsDragEnding(false);
      return;
    }

    // Store the previous state for potential rollback
    const previousContainers = { ...containers };
    const previousSermon = { ...sermon };

    // Perform the UI update immediately for smooth UX
    let updatedContainers = calculateItemPlacement(
      containers,
      activeContainer,
      overContainer,
      active.id,
      droppedOnItem,
      targetItemIndex
    );

    // Find moved item
    const movedIndex = updatedContainers[overContainer].findIndex(item => item.id === active.id);
    if (movedIndex === -1) {
      setActiveId(null);
      setOriginalContainer(null);
      setIsDragEnding(false);
      return;
    }

    const movedItem = updatedContainers[overContainer][movedIndex];

    // Determine final outline point assignment
    const finalSermonPointId = determineOutlinePointAssignment(
      outlinePointId,
      droppedOnItem,
      targetItemSermonPointId,
      movedItem,
      activeContainer,
      overContainer,
      sermon
    );

    // Update outline point ID in the moved item
    if (activeContainer !== overContainer || finalSermonPointId !== undefined) {
      updatedContainers[overContainer][movedIndex] = {
        ...updatedContainers[overContainer][movedIndex],
        outlinePointId: finalSermonPointId
      };
    }

    // Dedupe by id within affected containers before applying (safety)
    if (activeContainer === overContainer) {
      updatedContainers[overContainer] = ensureUniqueItems(updatedContainers[overContainer]);
    } else {
      updatedContainers[activeContainer] = ensureUniqueItems(updatedContainers[activeContainer]);
      updatedContainers[overContainer] = ensureUniqueItems(updatedContainers[overContainer]);
    }

    // Ensure the moved item exists only in the destination container across all sections
    updatedContainers = removeIdFromOtherSections(updatedContainers, overContainer, String(active.id));

    // Apply state updates immediately
    setContainers(updatedContainers);
    containersRef.current = updatedContainers;

    // Clear drag state immediately
    setActiveId(null);
    setOriginalContainer(null);
    setIsDragEnding(false);

    // Build newStructure for API update
    const newStructure = {
      introduction: dedupeIds(updatedContainers.introduction.map((item) => item.id)),
      main: dedupeIds(updatedContainers.main.map((item) => item.id)),
      conclusion: dedupeIds(updatedContainers.conclusion.map((item) => item.id)),
      ambiguous: dedupeIds(updatedContainers.ambiguous.map((item) => item.id)),
    };

    // Make API calls in background with rollback on error
    try {
      // Update outline point assignment and required section tag if needed
      let positionPersisted = false;
      if (activeContainer !== overContainer || finalSermonPointId !== undefined) {
        const updatedMoved = updatedContainers[overContainer][movedIndex];
        const updatedItem = buildUpdatedItem(
          updatedMoved,
          overContainer,
          finalSermonPointId,
          columnTitles,
          updatedContainers,
          movedIndex
        );

        // Update UI with final item
        updatedContainers[overContainer][movedIndex] = updatedItem;
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;

        // Persist the updated thought
        positionPersisted = persistThoughtChange(
          sermon,
          updatedItem,
          updatedItem.requiredTags || [],
          updatedItem.outlinePointId,
          updatedItem.position || 0,
          debouncedSaveThought
        );
      }

      // If only reordering within the same group (no container or outline change), still persist position
      if (!positionPersisted) {
        const currentMoved = updatedContainers[overContainer][movedIndex];
        const groupKey = (currentMoved.outlinePointId || '__unassigned__');
        const newPos = calculateGroupPosition(updatedContainers[overContainer], movedIndex, groupKey);

        // Update UI and persist
        updatedContainers[overContainer][movedIndex] = {
          ...currentMoved,
          position: newPos,
        };
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;

        const thought = sermon.thoughts.find((t: Thought) => t.id === currentMoved.id);
        if (thought) {
          const updatedThought: Thought = {
            ...thought,
            position: newPos,
          };
          debouncedSaveThought(sermon.id, updatedThought);
        }
      }

      // Update structure if needed
      await handleStructureUpdate(sermon, newStructure, setSermon);

    } catch (error) {
      console.error("Error updating drag and drop:", error);

      // Rollback optimistic updates on error
      setContainers(previousContainers);
      containersRef.current = previousContainers;
      setSermon(previousSermon);

      // Show user-friendly error message
      toast.error(t('errors.dragDropUpdateFailed', { defaultValue: 'Failed to update. Changes have been reverted.' }));
    }
  }, [
    sermon,
    originalContainer,
    containers,
    setContainers,
    containersRef,
    setActiveId,
    setOriginalContainer,
    setIsDragEnding,
    columnTitles,
    debouncedSaveThought,
    setSermon,
    t
  ]);

  return {
    sensors,
    activeId,
    setActiveId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
};
