import { useState, useRef, useCallback, useMemo } from "react";
import { 
  useSensors, 
  useSensor, 
  MouseSensor,
  TouchSensor,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent 
} from "@dnd-kit/core";
import { updateStructure } from "@/services/structure.service";
import { Item, Sermon, OutlinePoint, Thought, Outline } from "@/models/models";
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import debounce from 'lodash/debounce';
import { 
  isStructureChanged, 
  dedupeIds, 
  ensureUniqueItems, 
  removeIdFromOtherSections,
  calculateGroupPosition 
} from "../utils/structure";

interface UseStructureDndProps {
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  containersRef: React.MutableRefObject<Record<string, Item[]>>;
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  outlinePoints: { introduction: OutlinePoint[]; main: OutlinePoint[]; conclusion: OutlinePoint[] };
  columnTitles: Record<string, string>;
  debouncedSaveThought: (sermonId: string, thought: Thought) => void;
}

export const useStructureDnd = ({
  containers,
  setContainers,
  containersRef,
  sermon,
  setSermon,
  outlinePoints,
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

    let dstContainerKey: string | undefined = over.data?.current?.container as string | undefined;
    let targetOutlinePointId: string | null | undefined = over.data?.current?.outlinePointId as string | undefined;

    if (overId.startsWith('outline-point-')) {
      dstContainerKey = over.data?.current?.container as string | undefined;
      targetOutlinePointId = (over.data?.current?.outlinePointId as string) || undefined;
    } else if (overId.startsWith('unassigned-')) {
      dstContainerKey = over.data?.current?.container as string | undefined;
      targetOutlinePointId = null;
    } else if (!dstContainerKey) {
      // over on item or container id
      dstContainerKey = ["introduction", "main", "conclusion", "ambiguous"].includes(overId)
        ? overId
        : Object.keys(state).find((k) => state[k].some((it) => it.id === overId));
      if (!dstContainerKey) return;

      // If over is an item, inherit its outline point group for preview
      if (overId !== dstContainerKey) {
        const overIdx = state[dstContainerKey].findIndex((it) => it.id === overId);
        if (overIdx !== -1) {
          targetOutlinePointId = state[dstContainerKey][overIdx].outlinePointId ?? null;
        }
      }
    }

    if (!dstContainerKey) return;

    // Early compute current positions before building draft
    const srcIdx = state[srcContainerKey].findIndex((it) => it.id === activeId);
    if (srcIdx === -1) return;
    const dragged = state[srcContainerKey][srcIdx];

    // Determine insertion index in destination relative to over target
    let insertIndex = state[dstContainerKey].length;
    if (overId !== dstContainerKey && !overId.startsWith('outline-point-') && !overId.startsWith('unassigned-')) {
      const overIdx = state[dstContainerKey].findIndex((it) => it.id === overId);
      if (overIdx !== -1) insertIndex = overIdx; // insert before target item
    } else if (targetOutlinePointId !== undefined) {
      // Append to end of that group
      const groupKey = targetOutlinePointId || null;
      // find last index of items in that group
      let lastGroupIndex = -1;
      for (let i = 0; i < state[dstContainerKey].length; i++) {
        const it = state[dstContainerKey][i];
        const itGroup = (it.outlinePointId ?? null);
        if (itGroup === groupKey) lastGroupIndex = i;
      }
      insertIndex = lastGroupIndex === -1 ? state[dstContainerKey].length : lastGroupIndex + 1;
    }

    const intendedOutline: string | undefined =
      targetOutlinePointId === undefined ? (dragged.outlinePointId || undefined) : (targetOutlinePointId || undefined);

    // If the item is already at the intended place/group, skip updating state
    if (srcContainerKey === dstContainerKey) {
      // In the same container, if inserting before the same next element, this might be a no-op
      const currentIdx = state[dstContainerKey].findIndex((it) => it.id === activeId);
      const sameGroup = (dragged.outlinePointId ?? undefined) === intendedOutline;
      const noReorder = insertIndex === currentIdx || insertIndex === currentIdx + 1;
      if (sameGroup && noReorder) {
        return;
      }
    } else {
      const currentDestIdx = state[dstContainerKey].findIndex((it) => it.id === activeId);
      if (currentDestIdx !== -1) {
        const alreadyAtIndex = currentDestIdx === insertIndex;
        const alreadyGroup = (state[dstContainerKey][currentDestIdx].outlinePointId ?? undefined) === intendedOutline;
        if (alreadyAtIndex && alreadyGroup) {
          return;
        }
      }
    }

    // Build new state preview without duplicating when source === destination
    const draft: Record<string, Item[]> = { ...state };
    const previewItem: Item = { ...dragged, outlinePointId: intendedOutline };
    if (srcContainerKey === dstContainerKey) {
      const arr = [...state[srcContainerKey]];
      // Remove from current index
      arr.splice(srcIdx, 1);
      // Adjust insert index if needed
      const safeIndex = Math.min(Math.max(insertIndex, 0), arr.length);
      // Insert at new index
      arr.splice(safeIndex, 0, previewItem);
      draft[srcContainerKey] = arr;
    } else {
      draft[srcContainerKey] = [...state[srcContainerKey]];
      draft[dstContainerKey] = [...state[dstContainerKey]];
      // Remove from source
      draft[srcContainerKey].splice(srcIdx, 1);
      // Insert into destination
      draft[dstContainerKey].splice(insertIndex, 0, previewItem);
    }

    // Store preview state in ref only - don't trigger re-render during drag
    // This prevents infinite loops while maintaining preview functionality
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
    let overContainer = over.data.current?.container;
    let outlinePointId = over.data.current?.outlinePointId;
    
    // Check if we're dropping on an outline point placeholder
    if (over.id.toString().startsWith('outline-point-')) {
      const dropTargetId = over.id.toString();
      outlinePointId = dropTargetId.replace('outline-point-', '');
      overContainer = over.data.current?.container;
    } 
    else if (over.id.toString().startsWith('unassigned-')) {
      outlinePointId = null;
      overContainer = over.data.current?.container;
    } 
    else if (over.id === "dummy-drop-zone" || over.id === "ambiguous-additional-drop") {
      overContainer = "ambiguous";
    } else if (!overContainer) {
      overContainer = String(over.id);
    }
    
    // Find the index of the target item in the destination container
    let targetItemIndex = -1;
    let droppedOnItem = false;
    let targetItemOutlinePointId: string | null = null;

    if (
      over.id !== overContainer &&
      !over.id.toString().startsWith('outline-point-') &&
      !over.id.toString().startsWith('unassigned-')
    ) {
      droppedOnItem = true;
      targetItemIndex = containers[overContainer]?.findIndex((item) => item.id === over.id) ?? -1;
      if (targetItemIndex !== -1) {
        const targetItem = containers[overContainer][targetItemIndex];
        // If target item is unassigned, explicitly use null to signal clearing assignment
        targetItemOutlinePointId = targetItem?.outlinePointId ?? null;
      }
    }
    
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
    let updatedContainers = { ...containers };
    
    if (activeContainer === overContainer) {
      const items = [...updatedContainers[activeContainer]];
      const oldIndex = items.findIndex((item) => item.id === active.id);
      
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
      
      const activeIndex = activeItems.findIndex((item) => item.id === active.id);
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
    
    // Update outline point ID in the moved item immediately (before API calls)
    // If dropped on a specific item and no explicit outline point target was set,
    // inherit the target item's outline point assignment
    if (typeof outlinePointId === 'undefined' && droppedOnItem) {
      outlinePointId = targetItemOutlinePointId;
    }
    // If dropped on container area (not a specific item or special placeholder),
    // default to unassigned in the current/target section
    if (typeof outlinePointId === 'undefined' && !droppedOnItem) {
      outlinePointId = null;
    }

    if (activeContainer !== overContainer || outlinePointId !== undefined) {
      const itemIndex = updatedContainers[overContainer].findIndex(item => item.id === active.id);
      if (itemIndex !== -1) {
        updatedContainers[overContainer][itemIndex] = {
          ...updatedContainers[overContainer][itemIndex],
          outlinePointId: outlinePointId
        };
      }
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
      if (activeContainer !== overContainer || outlinePointId !== undefined) {
        const movedIndex = updatedContainers[overContainer].findIndex((item) => item.id === active.id);
        const movedItem = movedIndex !== -1 ? updatedContainers[overContainer][movedIndex] : undefined;

        if (movedItem && sermon) {
          // Determine the correct required tag for the destination container
          let updatedRequiredTags: string[] = [];
          if (["introduction", "main", "conclusion"].includes(String(overContainer))) {
            updatedRequiredTags = [columnTitles[overContainer as keyof typeof columnTitles]];
          }

          // Determine final outlinePointId value to persist
          let finalOutlinePointId: string | null | undefined = undefined;

          if (typeof outlinePointId === 'string') {
            finalOutlinePointId = outlinePointId;
          } else if (outlinePointId === null) {
            finalOutlinePointId = null;
          } else {
            // No explicit outline point change requested
            finalOutlinePointId = movedItem.outlinePointId;

            // If container changed and previous outline point belongs to a different section, clear it
            if (activeContainer !== overContainer && finalOutlinePointId && sermon.outline) {
              const sectionPoints =
                overContainer === 'introduction' ? sermon.outline.introduction
                : overContainer === 'main' ? sermon.outline.main
                : overContainer === 'conclusion' ? sermon.outline.conclusion
                : [];
              const belongsToNewSection = sectionPoints?.some((p: OutlinePoint) => p.id === finalOutlinePointId);
              if (!belongsToNewSection) {
                finalOutlinePointId = null;
              }
            }
          }

          // Compute new positional rank within the destination group
          const groupKey = finalOutlinePointId || '__unassigned__';
          const newPos = calculateGroupPosition(updatedContainers[overContainer], movedIndex, groupKey);

          // Reflect these updates in local containers immediately to keep UI and persistence consistent
          updatedContainers[overContainer][movedIndex] = {
            ...movedItem,
            requiredTags: updatedRequiredTags,
            outlinePointId: finalOutlinePointId,
            position: newPos,
          };
          setContainers(updatedContainers);
          containersRef.current = updatedContainers;

          // Persist the updated thought
          const thought = sermon.thoughts.find((t: Thought) => t.id === movedItem.id);
          if (thought) {
            const updatedThought: Thought = {
              ...thought,
              tags: [
                ...updatedRequiredTags,
                ...(movedItem.customTagNames || []).map((tag) => tag.name),
              ],
              outlinePointId: finalOutlinePointId,
              position: newPos,
            };
            debouncedSaveThought(sermon.id, updatedThought);
            positionPersisted = true;
          }
        }
      }

      // If only reordering within the same group (no container or outline change), still persist position
      if (!positionPersisted) {
        const movedIndex = updatedContainers[overContainer].findIndex((item) => item.id === active.id);
        const movedItem = movedIndex !== -1 ? updatedContainers[overContainer][movedIndex] : undefined;
        if (movedItem && sermon) {
          const groupKey = (movedItem.outlinePointId || '__unassigned__');
          const newPos = calculateGroupPosition(updatedContainers[overContainer], movedIndex, groupKey);

          // Update UI and persist
          updatedContainers[overContainer][movedIndex] = {
            ...movedItem,
            position: newPos,
          };
          setContainers(updatedContainers);
          containersRef.current = updatedContainers;

          const thought = sermon.thoughts.find((t: Thought) => t.id === movedItem.id);
          if (thought) {
            const updatedThought: Thought = {
              ...thought,
              position: newPos,
            };
            debouncedSaveThought(sermon.id, updatedThought);
          }
        }
      }
      
      // Update structure if needed
      const changesDetected = isStructureChanged(sermon.structure || {}, newStructure);
      if (changesDetected) {
        await updateStructure(sermon.id, newStructure);
        setSermon((prev: Sermon | null) => (prev ? { ...prev, structure: newStructure} : prev));
      }
      
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
