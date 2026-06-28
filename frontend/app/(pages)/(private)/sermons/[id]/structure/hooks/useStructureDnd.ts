import {
  useSensors,
  useSensor,
  MouseSensor,
  TouchSensor,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent
} from "@dnd-kit/core";
import { useState, useCallback, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Item, Sermon, SermonPoint, Thought, ThoughtsBySection } from "@/models/models";
import { updateStructure } from "@/services/structure.service";


import {
  isStructureChanged,
  ensureUniqueItems,
  removeIdFromOtherSections,
  calculateIntermediatePosition,
  calculateGroupPosition,
  buildStructureFromContainers
} from "../utils/structure";

// Debug probe (gated on window.__DND_DEBUG) — emit the drag lifecycle so behaviour is
// observable from the console (immune to DragOverlay/scroll artifacts in DOM queries).
const dlog = (...a: unknown[]): void => {
  if (typeof window !== 'undefined' && (window as unknown as { __DND_DEBUG?: boolean }).__DND_DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[DND]', ...a);
  }
};

// Find an item by id across all containers → its container, index, and the item itself.
const locateItem = (
  containers: Record<string, Item[]>,
  id: string,
): { container: string; index: number; item: Item } | null => {
  for (const key of Object.keys(containers)) {
    const idx = containers[key].findIndex((it) => it.id === id);
    if (idx !== -1) return { container: key, index: idx, item: containers[key][idx] };
  }
  return null;
};

// Constants for drag target prefixes
const OUTLINE_POINT_PREFIX = 'outline-point-';
const UNASSIGNED_PREFIX = 'unassigned-';
const SUB_POINT_PREFIX = 'sub-point-';
const OUTLINE_GAP_PREFIX = 'outline-gap-';

// Helper function to determine destination container and outline point
const determineDestination = (
  overId: string,
  over: { data?: { current?: Record<string, unknown> } },
  state: Record<string, Item[]>
): {
  dstContainerKey: string | undefined;
  targetSermonPointId: string | null | undefined;
  targetSubPointId: string | null | undefined;
  targetBeforeItemId: string | null | undefined;
  targetAfterItemId: string | null | undefined;
} => {
  let dstContainerKey: string | undefined = over.data?.current?.container as string | undefined;
  let targetSermonPointId: string | null | undefined = over.data?.current?.outlinePointId as string | undefined;
  let targetSubPointId: string | null | undefined = over.data?.current?.subPointId as string | undefined;
  const targetBeforeItemId: string | null | undefined = over.data?.current?.beforeItemId as string | undefined;
  const targetAfterItemId: string | null | undefined = over.data?.current?.afterItemId as string | undefined;

  if (overId.startsWith(SUB_POINT_PREFIX)) {
    dstContainerKey = over.data?.current?.container as string | undefined;
    targetSermonPointId = (over.data?.current?.outlinePointId as string) || undefined;
    targetSubPointId = (over.data?.current?.subPointId as string) || undefined;
  } else if (overId.startsWith(OUTLINE_GAP_PREFIX)) {
    dstContainerKey = over.data?.current?.container as string | undefined;
    targetSermonPointId = (over.data?.current?.outlinePointId as string) || undefined;
    targetSubPointId = null;
  } else if (overId.startsWith(OUTLINE_POINT_PREFIX)) {
    dstContainerKey = over.data?.current?.container as string | undefined;
    targetSermonPointId = (over.data?.current?.outlinePointId as string) || undefined;
    targetSubPointId = null; // Explicitly dropping on outline point clears sub-point
  } else if (overId.startsWith(UNASSIGNED_PREFIX)) {
    dstContainerKey = over.data?.current?.container as string | undefined;
    targetSermonPointId = null;
    targetSubPointId = null;
  } else if (!dstContainerKey) {
    // over on item or container id
    dstContainerKey = ["introduction", "main", "conclusion", "ambiguous"].includes(overId)
      ? overId
      : Object.keys(state).find((k) => state[k].some((it) => it.id === overId));
    if (!dstContainerKey) {
      return {
        dstContainerKey: undefined,
        targetSermonPointId: undefined,
        targetSubPointId: undefined,
        targetBeforeItemId: undefined,
        targetAfterItemId: undefined,
      };
    }

    // If over is an item, inherit its outline point group for preview
    if (overId !== dstContainerKey) {
      const overIdx = state[dstContainerKey].findIndex((it) => it.id === overId);
      if (overIdx !== -1) {
        targetSermonPointId = state[dstContainerKey][overIdx].outlinePointId ?? null;
      }
    }
  }

  return {
    dstContainerKey,
    targetSermonPointId,
    targetSubPointId,
    targetBeforeItemId,
    targetAfterItemId,
  };
};

const resolveExplicitInsertIndex = (
  items: Item[],
  beforeItemId?: string | null,
  afterItemId?: string | null,
): number | null => {
  if (beforeItemId) {
    const beforeIndex = items.findIndex((item) => item.id === beforeItemId);
    if (beforeIndex !== -1) return beforeIndex;
  }

  if (afterItemId) {
    const afterIndex = items.findIndex((item) => item.id === afterItemId);
    if (afterIndex !== -1) return afterIndex + 1;
  }

  return null;
};

// Helper function to calculate insertion index
const calculateInsertIndex = (
  overId: string,
  dstContainerKey: string,
  targetSermonPointId: string | null | undefined,
  state: Record<string, Item[]>,
  targetBeforeItemId?: string | null,
  targetAfterItemId?: string | null,
): number => {
  const explicitInsertIndex = resolveExplicitInsertIndex(
    state[dstContainerKey] || [],
    targetBeforeItemId,
    targetAfterItemId,
  );
  if (explicitInsertIndex !== null) return explicitInsertIndex;

  let insertIndex = state[dstContainerKey].length;

  if (
    overId !== dstContainerKey &&
    !overId.startsWith(OUTLINE_POINT_PREFIX) &&
    !overId.startsWith(UNASSIGNED_PREFIX) &&
    !overId.startsWith(OUTLINE_GAP_PREFIX) &&
    !overId.startsWith(SUB_POINT_PREFIX)
  ) {
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
  intendedSubPoint: string | undefined,
  state: Record<string, Item[]>
): boolean => {
  if (srcContainerKey === dstContainerKey) {
    const currentIdx = state[dstContainerKey].findIndex((it) => it.id === dragged.id);
    const sameGroup = (dragged.outlinePointId ?? undefined) === intendedOutline;
    const sameSubPoint = (dragged.subPointId ?? undefined) === intendedSubPoint;
    const noReorder = insertIndex === currentIdx || insertIndex === currentIdx + 1;
    if (sameGroup && sameSubPoint && noReorder) {
      return true;
    }
  } else {
    const currentDestIdx = state[dstContainerKey].findIndex((it) => it.id === dragged.id);
    if (currentDestIdx !== -1) {
      const alreadyAtIndex = currentDestIdx === insertIndex;
      const alreadyGroup = (state[dstContainerKey][currentDestIdx].outlinePointId ?? undefined) === intendedOutline;
      const alreadySubPoint = (state[dstContainerKey][currentDestIdx].subPointId ?? undefined) === intendedSubPoint;
      if (alreadyAtIndex && alreadyGroup && alreadySubPoint) {
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
  subPointId: string | null | undefined;
  beforeItemId: string | null | undefined;
  afterItemId: string | null | undefined;
  prevPosition: number | undefined;
  nextPosition: number | undefined;
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
      subPointId: undefined,
      beforeItemId: undefined,
      afterItemId: undefined,
      prevPosition: undefined,
      nextPosition: undefined,
      droppedOnItem: false,
      targetItemIndex: -1,
      targetItemSermonPointId: null,
    };
  }

  let overContainer = over.data.current?.container;
  let outlinePointId = over.data.current?.outlinePointId;
  let subPointId: string | null | undefined = over.data.current?.subPointId;
  const beforeItemId: string | null | undefined = over.data.current?.beforeItemId;
  const afterItemId: string | null | undefined = over.data.current?.afterItemId;
  const prevPosition = typeof over.data.current?.prevPosition === 'number' ? over.data.current.prevPosition : undefined;
  const nextPosition = typeof over.data.current?.nextPosition === 'number' ? over.data.current.nextPosition : undefined;
  let droppedOnItem = false;
  let targetItemIndex = -1;
  let targetItemSermonPointId: string | null = null;

  // Check if we're dropping on a sub-point
  if (over.id.toString().startsWith(SUB_POINT_PREFIX)) {
    subPointId = over.data.current?.subPointId;
    outlinePointId = over.data.current?.outlinePointId;
    overContainer = over.data.current?.container;
  } else if (over.id.toString().startsWith(OUTLINE_GAP_PREFIX)) {
    outlinePointId = over.data.current?.outlinePointId;
    overContainer = over.data.current?.container;
    subPointId = null;
  } else if (over.id.toString().startsWith(OUTLINE_POINT_PREFIX)) {
    const dropTargetId = over.id.toString();
    outlinePointId = dropTargetId.replace(OUTLINE_POINT_PREFIX, '');
    overContainer = over.data.current?.container;
    subPointId = null; // Clear sub-point when dropping on outline point directly
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
    !over.id.toString().startsWith(UNASSIGNED_PREFIX) &&
    !over.id.toString().startsWith(SUB_POINT_PREFIX) &&
    !over.id.toString().startsWith(OUTLINE_GAP_PREFIX)
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
    subPointId,
    beforeItemId,
    afterItemId,
    prevPosition,
    nextPosition,
    droppedOnItem,
    targetItemIndex,
    targetItemSermonPointId,
  };
};

const hasInsertIndex = (insertIndex: number | null | undefined): insertIndex is number => (
  insertIndex !== null && typeof insertIndex !== 'undefined'
);

const moveItem = (items: Item[], fromIndex: number, toIndex: number): Item[] => {
  const nextItems = [...items];
  const [draggedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, draggedItem);
  return nextItems;
};

const resolveSameContainerInsertIndex = (
  items: Item[],
  oldIndex: number,
  droppedOnItem: boolean,
  targetItemIndex: number,
  explicitInsertIndex?: number | null,
): number | null => {
  if (hasInsertIndex(explicitInsertIndex)) {
    return oldIndex < explicitInsertIndex ? explicitInsertIndex - 1 : explicitInsertIndex;
  }

  if (droppedOnItem && targetItemIndex !== -1) {
    return targetItemIndex;
  }

  if (!droppedOnItem) {
    return items.length - 1;
  }

  return null;
};

const moveWithinContainer = (
  containers: Record<string, Item[]>,
  activeContainer: string,
  activeId: string | number,
  droppedOnItem: boolean,
  targetItemIndex: number,
  explicitInsertIndex?: number | null,
): Record<string, Item[]> => {
  const items = containers[activeContainer];
  const oldIndex = items.findIndex((item) => item.id === activeId);

  if (oldIndex === -1) {
    return containers;
  }

  const insertIndex = resolveSameContainerInsertIndex(
    items,
    oldIndex,
    droppedOnItem,
    targetItemIndex,
    explicitInsertIndex,
  );

  if (insertIndex === null) {
    return containers;
  }

  return {
    ...containers,
    [activeContainer]: moveItem(items, oldIndex, insertIndex),
  };
};

const resolveCrossContainerInsertIndex = (
  overItems: Item[],
  droppedOnItem: boolean,
  targetItemIndex: number,
  explicitInsertIndex?: number | null,
): number => {
  if (hasInsertIndex(explicitInsertIndex)) {
    return explicitInsertIndex;
  }

  return droppedOnItem && targetItemIndex !== -1 ? targetItemIndex : overItems.length;
};

const moveBetweenContainers = (
  containers: Record<string, Item[]>,
  activeContainer: string,
  overContainer: string,
  activeId: string | number,
  droppedOnItem: boolean,
  targetItemIndex: number,
  explicitInsertIndex?: number | null,
): Record<string, Item[]> => {
  const activeItems = [...containers[activeContainer]];
  const overItems = [...containers[overContainer]];
  const activeIndex = activeItems.findIndex((item) => item.id === activeId);

  if (activeIndex === -1) {
    return containers;
  }

  const [draggedItem] = activeItems.splice(activeIndex, 1);
  const insertIndex = resolveCrossContainerInsertIndex(
    overItems,
    droppedOnItem,
    targetItemIndex,
    explicitInsertIndex,
  );
  overItems.splice(insertIndex, 0, draggedItem);

  return {
    ...containers,
    [activeContainer]: activeItems,
    [overContainer]: overItems,
  };
};

// Helper: Calculate item placement in containers
const calculateItemPlacement = (
  containers: Record<string, Item[]>,
  activeContainer: string,
  overContainer: string,
  activeId: string | number,
  droppedOnItem: boolean,
  targetItemIndex: number,
  explicitInsertIndex?: number | null,
): Record<string, Item[]> => {
  if (activeContainer === overContainer) {
    return moveWithinContainer(
      containers,
      activeContainer,
      activeId,
      droppedOnItem,
      targetItemIndex,
      explicitInsertIndex,
    );
  }

  return moveBetweenContainers(
    containers,
    activeContainer,
    overContainer,
    activeId,
    droppedOnItem,
    targetItemIndex,
    explicitInsertIndex,
  );
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
  updatedContainers: Record<string, Item[]>,
  movedIndex: number,
  positionHint?: {
    prevPosition?: number;
    nextPosition?: number;
  }
): Item => {
  // Determine the correct required tag for the destination container
  const updatedRequiredTags: string[] = [];

  // Compute new positional rank within the destination group
  const groupKey = finalSermonPointId || '__unassigned__';
  const newPos = positionHint
    ? calculateIntermediatePosition(positionHint.prevPosition, positionHint.nextPosition)
    : calculateGroupPosition(updatedContainers[overContainer], movedIndex, groupKey);

  return {
    ...movedItem,
    requiredTags: updatedRequiredTags,
    outlinePointId: finalSermonPointId,
    position: newPos,
  };
};

const hasMeaningfulDropChange = (
  previousContainers: Record<string, Item[]>,
  nextContainers: Record<string, Item[]>,
  movedItemId: string
): boolean => {
  const previousStructure = buildStructureFromContainers(previousContainers);
  const nextStructure = buildStructureFromContainers(nextContainers);

  if (isStructureChanged(previousStructure, nextStructure)) {
    return true;
  }

  const findMovedItem = (state: Record<string, Item[]>): Item | undefined =>
    Object.values(state).flat().find((item) => item.id === movedItemId);

  const previousItem = findMovedItem(previousContainers);
  const nextItem = findMovedItem(nextContainers);

  return (previousItem?.outlinePointId ?? null) !== (nextItem?.outlinePointId ?? null)
    || (previousItem?.subPointId ?? null) !== (nextItem?.subPointId ?? null);
};

// Helper: Persist thought change
const persistThoughtChange = (
  sermon: Sermon,
  movedItem: Item,
  updatedRequiredTags: string[],
  finalSermonPointId: string | null | undefined,
  finalSubPointId: string | null | undefined,
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
      subPointId: finalSubPointId ?? null,
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
  newStructure: ThoughtsBySection,
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>
): Promise<void> => {
  const normalizedStructure: ThoughtsBySection = {
    ...newStructure,
    ambiguous: newStructure.ambiguous ?? [],
  };
  const changesDetected = isStructureChanged(sermon.structure || {}, normalizedStructure);
  if (changesDetected) {
    await updateStructure(sermon.id, normalizedStructure);
    setSermon((prev: Sermon | null) => (prev ? { ...prev, structure: normalizedStructure } : prev));
  }
};

interface UseStructureDndProps {
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  containersRef: React.MutableRefObject<Record<string, Item[]>>;
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  debouncedSaveThought: (sermonId: string, thought: Thought) => void;
}

export const useStructureDnd = ({
  containers,
  setContainers,
  containersRef,
  sermon,
  setSermon,
  debouncedSaveThought,
}: UseStructureDndProps) => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [originalContainer, setOriginalContainer] = useState<string | null>(null);
  const [isDragEnding, setIsDragEnding] = useState(false);
  const dragStartContainersRef = useRef<Record<string, Item[]> | null>(null);
  const previewRafRef = useRef<number | null>(null);
  // Track last two drag destinations to detect A→B→A oscillation at subpoint boundaries
  const dragDestHistoryRef = useRef<{ current: string; previous: string }>({ current: '', previous: '' });

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
    dlog('start: active =', id);

    // Capture the original container at the start of the drag
    const original = Object.keys(containers).find((key) =>
      containers[key].some((item) => item.id === id)
    );
    setOriginalContainer(original || null);

    // Reset oscillation tracking
    dragDestHistoryRef.current = { current: '', previous: '' };

    // Snapshot the original containers for handleDragEnd calculations
    const snapshot: Record<string, Item[]> = {};
    for (const key of Object.keys(containers)) {
      snapshot[key] = [...containers[key]];
    }
    dragStartContainersRef.current = snapshot;
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
    const {
      dstContainerKey,
      targetSermonPointId,
      targetSubPointId,
      targetBeforeItemId,
      targetAfterItemId,
    } = determineDestination(overId, over, state);
    if (!dstContainerKey) return;

    // Early compute current positions before building draft
    const srcIdx = state[srcContainerKey].findIndex((it) => it.id === activeId);
    if (srcIdx === -1) return;
    const dragged = state[srcContainerKey][srcIdx];

    // Calculate insertion index
    const insertIndex = calculateInsertIndex(
      overId,
      dstContainerKey,
      targetSermonPointId,
      state,
      targetBeforeItemId,
      targetAfterItemId,
    );

    const intendedOutline: string | undefined =
      targetSermonPointId === undefined ? (dragged.outlinePointId || undefined) : (targetSermonPointId || undefined);
    const intendedSubPoint: string | undefined =
      targetSubPointId === undefined
        ? (targetSermonPointId === undefined ? (dragged.subPointId || undefined) : undefined)
        : (targetSubPointId || undefined);

    // Check if update is needed
    if (shouldSkipUpdate(srcContainerKey, dstContainerKey, insertIndex, dragged, intendedOutline, intendedSubPoint, state)) {
      return;
    }

    // Detect A→B→A oscillation at subpoint/group boundaries.
    // When the cursor sits at the edge between two targets, each state update
    // shifts rects so the pointer alternates between them. Break the cycle by
    // refusing to move back to the position we just left.
    const destKey = `${dstContainerKey}:${intendedOutline ?? ''}:${intendedSubPoint ?? ''}:${insertIndex}`;
    if (destKey === dragDestHistoryRef.current.previous && destKey !== dragDestHistoryRef.current.current) {
      return;
    }
    dragDestHistoryRef.current = { current: destKey, previous: dragDestHistoryRef.current.current };

    // Build new state preview
    const draft: Record<string, Item[]> = { ...state };
    const previewItem: Item = {
      ...dragged,
      outlinePointId: intendedOutline,
      subPointId: intendedSubPoint,
    };

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

    // Update preview item's position so buildSubPointRenderableEntries
    // sorts it in the correct visual order (between its neighbors).
    // Without this, the item keeps its old position and renders in the wrong spot.
    const draftItems = draft[dstContainerKey];
    const previewIdx = draftItems.findIndex((it) => it.id === previewItem.id);
    if (previewIdx !== -1) {
      const prevPos = previewIdx > 0 ? draftItems[previewIdx - 1].position : undefined;
      const nextPos = previewIdx < draftItems.length - 1 ? draftItems[previewIdx + 1].position : undefined;
      draftItems[previewIdx] = {
        ...draftItems[previewIdx],
        position: calculateIntermediatePosition(prevPos, nextPos),
      };
    }

    // Update ref immediately for dnd-kit calculations
    containersRef.current = draft;

    // Batch state update via RAF to prevent infinite re-render loops.
    // Without RAF, setContainers triggers re-render → dnd-kit recalculates rects →
    // fires onDragOver again → setContainers → infinite loop.
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
    }
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = null;
      setContainers(containersRef.current);
    });
  }, [isDragEnding, containersRef, setContainers]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    dlog('dragEnd: over =', over ? String(over.id) : null, '| active =', String(active?.id));

    // Set drag ending flag immediately to prevent interference
    setIsDragEnding(true);

    // Use the original (pre-drag) snapshot for all calculations
    const originalContainers = dragStartContainersRef.current || containers;

    // Helper to restore original state and clean up drag
    const resetDragState = () => {
      dlog('end: REVERT (no change / invalid drop) → restored original');
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
        previewRafRef.current = null;
      }
      setContainers(originalContainers);
      containersRef.current = originalContainers;
      setActiveId(null);
      setOriginalContainer(null);
      setIsDragEnding(false);
      dragStartContainersRef.current = null;
    };

    // Early return if no valid drop target
    if (!over || !sermon) {
      resetDragState();
      return;
    }

    const activeContainer = originalContainer;

    // Identify drop target using original state
    const dropTarget = identifyDropTarget(over, originalContainers);
    const {
      overContainer,
      outlinePointId,
      subPointId: targetSubPointId,
      beforeItemId,
      afterItemId,
      prevPosition,
      nextPosition,
      droppedOnItem,
      targetItemIndex,
      targetItemSermonPointId,
    } = dropTarget;
    dlog('  dropTarget:', { overContainer, droppedOnItem, targetItemIndex, outlinePointId, activeContainer });

    if (
      !activeContainer ||
      !overContainer ||
      !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
    ) {
      dlog('  reason: invalid container (active/over not a section)');
      resetDragState();
      return;
    }

    // Store the previous state for potential rollback (original pre-drag state)
    const previousContainers = { ...originalContainers };
    const previousSermon = { ...sermon };

    const explicitInsertIndex = resolveExplicitInsertIndex(
      originalContainers[overContainer] || [],
      beforeItemId,
      afterItemId,
    );

    // Calculate placement from original (pre-drag) state
    let updatedContainers = calculateItemPlacement(
      originalContainers,
      activeContainer,
      overContainer,
      active.id,
      droppedOnItem,
      targetItemIndex,
      explicitInsertIndex,
    );

    // Find moved item
    const movedIndex = updatedContainers[overContainer].findIndex(item => item.id === active.id);
    if (movedIndex === -1) {
      resetDragState();
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

    // Determine final sub-point assignment
    const finalSubPointId = targetSubPointId !== undefined ? targetSubPointId : (
      // If dropping on outline point or changing container, clear subPointId
      (outlinePointId !== undefined || activeContainer !== overContainer) ? null : movedItem.subPointId
    );

    // Update outline point ID and sub-point ID in the moved item
    if (activeContainer !== overContainer || finalSermonPointId !== undefined || finalSubPointId !== undefined) {
      updatedContainers[overContainer][movedIndex] = {
        ...updatedContainers[overContainer][movedIndex],
        outlinePointId: finalSermonPointId,
        subPointId: finalSubPointId,
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

    if (!hasMeaningfulDropChange(previousContainers, updatedContainers, String(active.id))) {
      // The snapshot-based recompute is a no-op. But the LIVE PREVIEW may already hold a real
      // reorder: in a 2-card point the preview swaps the cards, they separate, so `over`
      // collapses onto the dragged card itself and the recompute sees nothing. Commit the
      // preview instead of discarding it. (Root proven via live [DND] logs.)
      const preview = containersRef.current;
      const before = locateItem(previousContainers, String(active.id));
      const now = locateItem(preview, String(active.id));
      // Recovery is ONLY for a same-container reorder whose snapshot recompute came out a
      // no-op. Cross-section / assignment / zone drops keep going through the normal apply
      // path (which runs the full finalization); committing their raw preview metadata here
      // could persist a stale outlinePointId. (Codex P1.)
      const reordered = !!before && !!now && before.container === now.container && before.index !== now.index;

      if (reordered && now) {
        dlog('  recovered: same-container preview reorder, snapshot no-op → committing preview');
        setContainers(preview);
        containersRef.current = preview;
        setActiveId(null);
        setOriginalContainer(null);
        setIsDragEnding(false);
        dragStartContainersRef.current = null;

        try {
          await handleStructureUpdate(sermon, buildStructureFromContainers(preview), setSermon);
          // Persist the moved thought's position ONLY after structure persistence succeeds,
          // so a failed structure save can't leave a half-applied move. (Codex P2.)
          const movedThought = sermon.thoughts.find((th: Thought) => th.id === String(active.id));
          if (movedThought) {
            debouncedSaveThought(sermon.id, {
              ...movedThought,
              position: typeof now.item.position === 'number' ? now.item.position : movedThought.position,
              outlinePointId: now.item.outlinePointId,
              subPointId: now.item.subPointId ?? null,
            });
          }
        } catch (error) {
          console.error('Error committing preview drag:', error);
          setContainers(previousContainers);
          containersRef.current = previousContainers;
          setSermon(previousSermon);
          toast.error(t('errors.dragDropUpdateFailed', { defaultValue: 'Failed to update. Changes have been reverted.' }));
        }
        dlog('end: APPLIED (from preview) →', now.container, (preview[now.container] || []).map((i) => i.id));
        return;
      }

      dlog('  reason: hasMeaningfulDropChange=false (order/assignment identical)');
      resetDragState();
      return;
    }

    // Cancel any pending preview RAF before applying final state
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }

    // Apply state updates immediately
    setContainers(updatedContainers);
    containersRef.current = updatedContainers;
    dlog('end: APPLIED →', overContainer, (updatedContainers[overContainer] || []).map((i) => i.id));

    // Clear drag state immediately
    setActiveId(null);
    setOriginalContainer(null);
    setIsDragEnding(false);
    dragStartContainersRef.current = null;

    // Build newStructure for API update
    const newStructure = buildStructureFromContainers(updatedContainers);

    // Make API calls in background with rollback on error
    try {
      // Update outline point assignment and required section tag if needed
      let positionPersisted = false;
      const positionHint = prevPosition !== undefined || nextPosition !== undefined
        ? { prevPosition, nextPosition }
        : undefined;
      if (activeContainer !== overContainer || finalSermonPointId !== undefined || finalSubPointId !== undefined) {
        const updatedMoved = updatedContainers[overContainer][movedIndex];
        const updatedItem = {
          ...buildUpdatedItem(
            updatedMoved,
            overContainer,
            finalSermonPointId,
            updatedContainers,
            movedIndex,
            positionHint
          ),
          subPointId: finalSubPointId,
        };

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
          updatedItem.subPointId,
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
    debouncedSaveThought,
    setSermon,
    t
  ]);

  const handleDragCancel = useCallback(() => {
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    if (dragStartContainersRef.current) {
      setContainers(dragStartContainersRef.current);
      containersRef.current = dragStartContainersRef.current;
    }
    setActiveId(null);
    setOriginalContainer(null);
    setIsDragEnding(false);
    dragStartContainersRef.current = null;
  }, [setContainers, containersRef]);

  return {
    sensors,
    activeId,
    setActiveId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
};
