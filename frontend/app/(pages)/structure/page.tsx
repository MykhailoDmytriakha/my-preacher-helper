"use client";

import React, { useState, useEffect, Suspense, useRef, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  useDroppable,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Column from "@/components/Column";
import SortableItem from "@/components/SortableItem";
import { Item, Sermon, OutlinePoint, Thought, Outline, Tag } from "@/models/models";
import EditThoughtModal from "@/components/EditThoughtModal";
import ExportButtons from "@/components/ExportButtons";
import { getTags } from "@/services/tag.service";
import { getSermonById } from "@/services/sermon.service";
import { updateThought, deleteThought } from "@/services/thought.service";
import { updateStructure } from "@/services/structure.service";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { getSermonOutline } from "@/services/outline.service";
import { sortItemsWithAI } from "@/services/sortAI.service";
import { toast } from 'sonner';
import { getContrastColor } from '@/utils/color';
import CardContent from "@/components/CardContent";
import { getExportContent } from "@/utils/exportContent";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import debounce from 'lodash/debounce';
import { useSermonStructureData } from "@/hooks/useSermonStructureData";

interface UseSermonStructureDataReturn {
  sermon: Sermon | null;
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: OutlinePoint[]; main: OutlinePoint[]; conclusion: OutlinePoint[] };
  requiredTagColors: { introduction?: string; main?: string; conclusion?: string };
  allowedTags: { name: string; color: string }[];
  loading: boolean;
  error: string | null;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isAmbiguousVisible: boolean;
  setIsAmbiguousVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

function DummyDropZone({ container }: { container: string }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: "dummy-drop-zone",
    data: { container },
  });
  return (
    <div
      ref={setNodeRef}
      data-container={container}
      style={{ minHeight: "80px" }}
      className={`p-4 text-center text-gray-500 dark:text-gray-400 border-dashed border-2 border-blue-300 dark:border-blue-600 col-span-full ${
        isOver ? "border-blue-500 border-4" : ""
      }`}
    >
      {t('structure.noEntries')}
    </div>
  );
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
  const sermonId = searchParams?.get("sermonId");
  const { t } = useTranslation();
  const [isClient, setIsClient] = useState(false);

  // Use effect to mark when component is mounted on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Use the new hook to manage data fetching and related state
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
    setLoading,
    isAmbiguousVisible,
    setIsAmbiguousVisible
  }: UseSermonStructureDataReturn = useSermonStructureData(sermonId, t);

  // Ref to hold the latest containers state
  const containersRef = useRef(containers);
  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);

  // New state for AI Sort with Interactive Confirmation
  const [preSortState, setPreSortState] = useState<Record<string, Item[]> | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, { type: 'assigned' | 'moved' }>>({});
  const [isDiffModeActive, setIsDiffModeActive] = useState<boolean>(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [originalContainer, setOriginalContainer] = useState<string | null>(null);
  const [isDragEnding, setIsDragEnding] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [focusedColumn, setFocusedColumn] = useState<string | null>(null);
  const [isSorting, setIsSorting] = useState(false);
  const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Track activeId changes
  useEffect(() => {
    // Removed debugging logs for production
  }, [activeId, isDragEnding]);

  // Configure sensors with proper activation constraints
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Require 5px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const columnTitles: Record<string, string> = {
    introduction: t('structure.introduction'),
    main: t('structure.mainPart'),
    conclusion: t('structure.conclusion'),
    ambiguous: t('structure.underConsideration'),
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
  };

  const handleAddThoughtToSection = (sectionId: string) => {
    // Create an empty thought with predefined section
    const emptyThought: Item = {
      id: `temp-${Date.now()}`, // Temporary ID that will be replaced when saved
      content: '',
      requiredTags: [],
      customTagNames: []
    };
    
    // Set as the editing item with the specific section
    setEditingItem(emptyThought);
    setAddingThoughtToSection(sectionId);
  };

  const handleSaveEdit = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
    if (!sermon) return;
    
    // Check if we're adding a new thought or editing an existing one
    if (editingItem && editingItem.id.startsWith('temp-')) {
      // This is a new thought being added
      const section = addingThoughtToSection;
      
      // Construct the new thought data with the required date property
      const newThought = {
        id: Date.now().toString(), // Will be replaced by server
        text: updatedText,
        tags: [
          ...updatedTags,
          // Add the required section tag based on the section
          ...(section ? [columnTitles[section as keyof typeof columnTitles]] : [])
        ],
        outlinePointId: outlinePointId,
        date: new Date().toISOString() // Adding the required date property
      };
      
      try {
        // Add the thought using the thought service
        const thoughtService = await import('@/services/thought.service');
        const addedThought = await thoughtService.createManualThought(sermon.id, newThought);
        
        // Find outline point info if available
        let outlinePoint: { text: string; section: string } | undefined;
        if (outlinePointId && sermon.outline) {
          const sections = ['introduction', 'main', 'conclusion'] as const;
          const sectionTranslations: Record<string, string> = {
            'introduction': t('outline.introduction') || 'Introduction',
            'main': t('outline.mainPoints') || 'Main Points',
            'conclusion': t('outline.conclusion') || 'Conclusion'
          };
          
          for (const section of sections) {
            const point = sermon.outline[section]?.find((p: OutlinePoint) => p.id === outlinePointId);
            if (point) {
              outlinePoint = {
                text: point.text,
                section: '' // Don't show section in structure page
              };
              break;
            }
          }
        }
        
        // Create item for UI
        const newItem: Item = {
          id: addedThought.id,
          content: updatedText,
          customTagNames: updatedTags.map((tagName) => ({
            name: tagName,
            color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
          })),
          requiredTags: section ? [
            columnTitles[section as keyof typeof columnTitles] || ''
          ] : [],
          outlinePointId: outlinePointId,
          outlinePoint: outlinePoint
        };
        
        // Update sermon state
        setSermon((prevSermon: Sermon | null) => {
          if (!prevSermon) return null;
          return {
            ...prevSermon,
            thoughts: [...prevSermon.thoughts, addedThought]
          };
        });
        
        // Update containers
        if (section) {
          setContainers(prev => ({
            ...prev,
            [section]: [...prev[section], newItem]
          }));
          
          // Update structure in database
          const currentStructure = sermon.structure || {};
          const newStructure = typeof currentStructure === 'string' 
            ? JSON.parse(currentStructure) 
            : { ...currentStructure };
          
          if (!newStructure[section]) {
            newStructure[section] = [];
          }
          newStructure[section] = [...newStructure[section], newItem.id];
          
          await updateStructure(sermon.id, newStructure);
        }
      } catch (error) {
        console.error("Error adding thought:", error);
        toast.error(t('errors.failedToAddThought'));
      } finally {
        setEditingItem(null);
        setAddingThoughtToSection(null);
      }
    } else {
      // Existing code for updating thoughts
      if (!editingItem) return;

      const updatedItem: Thought = {
        ...sermon.thoughts.find((thought: Thought) => thought.id === editingItem.id)!,
        text: updatedText,
        tags: [...(editingItem.requiredTags || []), ...updatedTags],
        outlinePointId: outlinePointId
      };

      try {
        const updatedThought = await updateThought(sermon.id, updatedItem);
        const updatedThoughts = sermon.thoughts.map((thought: Thought) =>
          thought.id === updatedItem.id ? updatedThought : thought
        );
        setSermon((prevSermon: Sermon | null) => prevSermon ? { ...prevSermon, thoughts: updatedThoughts } : null);

        // Find outline point info if available
        let outlinePoint: { text: string; section: string } | undefined;
        if (outlinePointId && sermon.outline) {
          const sections = ['introduction', 'main', 'conclusion'] as const;
          const sectionTranslations: Record<string, string> = {
            'introduction': t('outline.introduction') || 'Introduction',
            'main': t('outline.mainPoints') || 'Main Points',
            'conclusion': t('outline.conclusion') || 'Conclusion'
          };
          
          for (const section of sections) {
            const point = sermon.outline[section]?.find((p: OutlinePoint) => p.id === outlinePointId);
            if (point) {
              outlinePoint = {
                text: point.text,
                section: '' // Don't show section in structure page
              };
              break;
            }
          }
        }

        const newContainers = Object.keys(containers).reduce(
          (acc, key) => {
            acc[key] = containers[key].map((item) =>
              item.id === updatedItem.id
                ? {
                    ...item,
                    content: updatedText,
                    customTagNames: updatedTags.map((tagName) => ({
                      name: tagName,
                      color:
                        allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
                    })),
                    outlinePointId: outlinePointId,
                    outlinePoint: outlinePoint
                  }
                : item
            );
            return acc;
          },
          {} as Record<string, Item[]>
        );

        setContainers(newContainers);
      } catch (error) {
        console.error("Error updating thought:", error);
      } finally {
        setEditingItem(null);
        setAddingThoughtToSection(null);
      }
    }
  };

  const handleCloseEdit = () => {
    setEditingItem(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    
    setIsDragEnding(false);
    setActiveId(id);
    
    // Capture the original container at the start of the drag
    const original = Object.keys(containers).find((key) =>
      containers[key].some((item) => item.id === id)
    );
    setOriginalContainer(original || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    // Early return if no over target
    if (!over) return;
    
    const activeId = active.id;
    const overId = over.id;
    
    // Find which container the active item is in
    const activeContainer = Object.keys(containers).find(
      (key) => containers[key].some((item) => item.id === activeId)
    );
    
    // Find which container the target is in
    let overContainer = over.data?.current?.container;
    
    // Handle outline point placeholders
    if (over.id.toString().startsWith('outline-point-')) {
      overContainer = over.data?.current?.container;
    }
    // Handle unassigned drop targets
    else if (over.id.toString().startsWith('unassigned-')) {
      overContainer = over.data?.current?.container;
    }
    // If over container is not set, try to infer from over.id
    else if (!overContainer) {
      overContainer = over.id.toString();
      
      // Handle special cases
      if (overId === "dummy-drop-zone") {
        overContainer = "ambiguous";
      } else if (!["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)) {
        // Try to find the container of the target item
        overContainer = Object.keys(containers).find(
          (key) => containers[key].some((item) => item.id === overId)
        );
      }
    }
    
    // Just validate - don't move items here, leave all movement to handleDragEnd
    // This prevents the double-movement issue
    return;
  };

  const isStructureChanged = (
    structurePrev: string | Record<string, any>,
    structureNew: string | Record<string, any>
  ): boolean => {
    const parse = (v: string | object) =>
      typeof v === "string" ? JSON.parse(v) : v;
    const prev = parse(structurePrev);
    const curr = parse(structureNew);
    const sections = ["introduction", "main", "conclusion", "ambiguous"];

    return sections.some(
      (section) => {
        const prevSection = prev[section] || [];
        const currSection = curr[section] || [];
        return prevSection.length !== currSection.length ||
          prevSection.some(
            (item: string, index: number) => item !== currSection[index]
          );
      }
    );
  };


  const handleDragEnd = async (event: DragEndEvent) => {
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
    
    // If the dragged item was a highlighted item, confirm the change
    if (active.id in highlightedItems) {
      setHighlightedItems(prev => {
        const newHighlighted = { ...prev };
        delete newHighlighted[active.id as string];
        
        if (Object.keys(newHighlighted).length === 0) {
          setIsDiffModeActive(false);
          setPreSortState(null);
        }
        
        return newHighlighted;
      });
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
    else if (over.id === "dummy-drop-zone") {
      overContainer = "ambiguous";
    } else if (!overContainer) {
      overContainer = String(over.id);
    }
    
    // Find the index of the target item in the destination container
    let targetItemIndex = -1;
    let droppedOnItem = false;
    
    if (over.id !== overContainer && 
        !over.id.toString().startsWith('outline-point-') && 
        !over.id.toString().startsWith('unassigned-')) {
      droppedOnItem = true;
      targetItemIndex = containers[overContainer]?.findIndex(item => item.id === over.id) ?? -1;
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
    if (activeContainer !== overContainer || outlinePointId !== undefined) {
      const itemIndex = updatedContainers[overContainer].findIndex(item => item.id === active.id);
      if (itemIndex !== -1) {
        updatedContainers[overContainer][itemIndex] = {
          ...updatedContainers[overContainer][itemIndex],
          outlinePointId: outlinePointId
        };
      }
    }
    
    // Apply state updates immediately
    setContainers(updatedContainers);
    containersRef.current = updatedContainers;
    
    // Clear drag state immediately
    setActiveId(null);
    setOriginalContainer(null);
    setIsDragEnding(false);
    
    // Build newStructure for API update
    const newStructure = {
      introduction: updatedContainers.introduction.map((item) => item.id),
      main: updatedContainers.main.map((item) => item.id),
      conclusion: updatedContainers.conclusion.map((item) => item.id),
      ambiguous: updatedContainers.ambiguous.map((item) => item.id),
    };
    
    // Make API calls in background with rollback on error
    try {
      // Update outline point assignment if needed (use debounced function for smooth UX)
      if (activeContainer !== overContainer || outlinePointId !== undefined) {
        const movedItem = updatedContainers[overContainer].find((item) => item.id === active.id);
        
        if (movedItem && sermon) {
          const thought = sermon.thoughts.find((thought: Thought) => thought.id === movedItem.id);
          if (thought) {
            const updatedItem: Thought = {
              ...thought,
              tags: [
                ...(movedItem.requiredTags || []),
                ...(movedItem.customTagNames || []).map((tag) => tag.name),
              ],
              outlinePointId: outlinePointId
            };
            
            // Use debounced function instead of direct await to prevent UI blocking
            debouncedSaveThought(sermon.id, updatedItem);
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
  };

  const handleToggleFocusMode = (columnId: string) => {
    if (focusedColumn === columnId) {
      // If the same column is clicked, exit focus mode
      setFocusedColumn(null);
    } else {
      // Otherwise, enter focus mode for the clicked column
      setFocusedColumn(columnId);
    }
  };

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

  const handleAiSort = async (columnId: string) => {
    if (!sermon || !sermonId) return;
    if (isSorting) return;
    setIsSorting(true);

    // Save the current state before sorting for comparison/rollback
    const currentColumnItems = [...containers[columnId]];
    setPreSortState({
      [columnId]: currentColumnItems
    });
    
    try {
      // We'll now sort all items, not just unassigned ones
      const outlinePointsForColumn = outlinePoints[columnId as keyof typeof outlinePoints] || [];
      
      // Limit to reasonable number for AI
      const MAX_THOUGHTS_FOR_SORTING = 25;
      const totalItems = containers[columnId].length;
      const itemsToSort = containers[columnId].slice(0, MAX_THOUGHTS_FOR_SORTING);
      const remainingItems = totalItems > MAX_THOUGHTS_FOR_SORTING ? 
        containers[columnId].slice(MAX_THOUGHTS_FOR_SORTING) : 
        [];
      
      if (itemsToSort.length === 0) {
        toast.info(t('structure.noItemsToSort'));
        setIsSorting(false);
        setPreSortState(null);
        return;
      }
      
      // Call the AI sorting service
      const sortedItems = await sortItemsWithAI(
        columnId,
        itemsToSort,
        sermonId,
        outlinePointsForColumn
      );
      
      if (!sortedItems || !Array.isArray(sortedItems)) {
        toast.error(t('errors.aiSortFailedFormat'));
        setIsSorting(false);
        setPreSortState(null);
        return;
      }
      
      // Track items that were changed by AI
      const newHighlightedItems: Record<string, { type: 'assigned' | 'moved' }> = {};
      
      // Find what changes were made by AI
      for (const item of sortedItems) {
        const originalItem = currentColumnItems.find(i => i.id === item.id);
        
        if (!originalItem) continue; // Should not happen but safety first
        
        // Check if outline point was assigned (only for previously unassigned thoughts)
        if (item.outlinePointId && !originalItem.outlinePointId) {
          newHighlightedItems[item.id] = { type: 'assigned' };
        } 
        // Check if position changed
        else if (
          currentColumnItems.findIndex(i => i.id === item.id) !== 
          sortedItems.findIndex(i => i.id === item.id)
        ) {
          newHighlightedItems[item.id] = { type: 'moved' };
        }
      }
      
      // Combine sorted items with remaining items
      const finalSortedItems = [...sortedItems, ...remainingItems];
      
      // Only enter diff mode if any changes were made
      const hasChanges = Object.keys(newHighlightedItems).length > 0;
      
      if (hasChanges) {
        // Update state with new highlighted items and enable diff mode
        setHighlightedItems(newHighlightedItems);
        setIsDiffModeActive(true);
        
        // Update containers with the new sorted items
        setContainers(prev => ({
          ...prev,
          [columnId]: finalSortedItems
        }));
        
        // Notify the user of changes
        toast.success(t('structure.aiSortSuggestionsReady', { 
          defaultValue: 'AI sorting completed. Review and confirm the changes.'
        }));
      } else {
        // No changes were made, simply inform the user
        toast.info(t('structure.aiSortNoChanges', {
          defaultValue: 'AI sort did not suggest any changes.'
        }));
        
        // Clean up
        setPreSortState(null);
      }
    } catch (error) {
      toast.error(t('errors.failedToSortItems'));
      // Reset state on error
      setPreSortState(null);
    } finally {
      setIsSorting(false);
    }
  };

  // Handler for accepting a single item change
  const handleKeepItem = (itemId: string, columnId: string) => {
    // Find the current item
    const item = containers[columnId].find(i => i.id === itemId);
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

    // Save if outline point was assigned
    if (item.outlinePointId && sermon) {
      const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
      if (thought) {
        // Create updated thought with the new outline point ID
        const updatedThought: Thought = {
          ...thought,
          outlinePointId: item.outlinePointId
        };
        
        // Save the thought
        debouncedSaveThought(sermonId!, updatedThought);
      }
    }

    // Save the current structure
    const newStructure = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
  };

  // Handler for reverting a single item change
  const handleRevertItem = (itemId: string, columnId: string) => {
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
    
    // Update containersRef to match
    containersRef.current = {
      ...containersRef.current,
      [columnId]: [...containers[columnId]]
    };
    
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
    const newStructure = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
  };

  // Handler for accepting all remaining changes
  const handleKeepAll = (columnId: string) => {
    if (!highlightedItems || Object.keys(highlightedItems).length === 0) return;
    
    // Create a list of all thoughts that need to be updated
    const thoughtUpdates: Array<{id: string, outlinePointId?: string}> = [];
    
    // Check for outline point assignments
    for (const itemId of Object.keys(highlightedItems)) {
      // Skip if not an outline point assignment
      if (highlightedItems[itemId].type !== 'assigned') continue;
      
      // Find the item in the containers
      for (const [containerId, items] of Object.entries(containers)) {
        const item = items.find(i => i.id === itemId);
        if (item && item.outlinePointId && sermon) {
          const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
          if (thought && thought.outlinePointId !== item.outlinePointId) {
            // Add to updates list
            thoughtUpdates.push({
              id: itemId,
              outlinePointId: item.outlinePointId
            });
          }
        }
      }
    }
    
    // Process thought updates
    if (thoughtUpdates.length > 0 && sermon) {
      for (const update of thoughtUpdates) {
        const thought = sermon.thoughts.find((t: Thought) => t.id === update.id);
        if (thought) {
          const updatedThought: Thought = {
            ...thought,
            outlinePointId: update.outlinePointId
          };
          
          // Save the thought with debouncing
          debouncedSaveThought(sermonId!, updatedThought);
        }
      }
    }
    
    // Save the current structure
    const newStructure = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
    
    // Clear highlighted items and exit diff mode
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);
    
    // Show confirmation toast
    toast.success(t('structure.aiSortChangesAccepted', {
      defaultValue: 'All AI suggestions accepted.'
    }));
  };

  // Handler for reverting all changes
  const handleRevertAll = (columnId: string) => {
    if (!preSortState || !preSortState[columnId]) return;
    
    // Revert the column to its pre-sort state
    setContainers(prev => ({
      ...prev,
      [columnId]: [...preSortState[columnId]]
    }));
    
    // Update containersRef to match
    containersRef.current = {
      ...containersRef.current,
      [columnId]: [...preSortState[columnId]]
    };
    
    // Clear highlighted items and exit diff mode
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);
    
    // Show confirmation toast
    toast.info(t('structure.aiSortChangesReverted', {
      defaultValue: 'All AI suggestions reverted.'
    }));
  };

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

    // <<< Set deleting state BEFORE async call >>>
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
      const newStructure = {
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
          } catch (structureError) {
              toast.error(t('errors.savingError') || "Error saving structure changes after deleting item.");
          }
      }

      toast.success(t('structure.thoughtDeletedSuccess') || "Thought deleted successfully.");

    } catch (deleteError) {
      toast.error(t('errors.deletingError') || "Failed to delete thought.");
    } finally {
      // <<< Clear deleting state AFTER operation (success or error) >>>
      setDeletingItemId(null);
    }
  };

  // Debounced save functions for structure and thoughts
  const debouncedSaveStructure = useCallback(
    debounce(async (sermonId: string, structure: any) => {
      try {
        await updateStructure(sermonId, structure);
      } catch (error) {
        toast.error(t('errors.failedToSaveStructure'));
      }
    }, 500),
    []
  );

  const debouncedSaveThought = useCallback(
    debounce(async (sermonId: string, thought: Thought) => {
      try {
        const updatedThought = await updateThought(sermonId, thought);
        setSermon((prev: Sermon | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            thoughts: prev.thoughts.map((t: Thought) => (t.id === updatedThought.id ? updatedThought : t)),
          };
        });
      } catch (error) {
        toast.error(t('errors.failedToSaveThought'));
      }
    }, 500),
    [setSermon]
  );

  // Calculate counts of thoughts per outline point
  const getThoughtsPerOutlinePoint = () => {
    if (!sermon || !sermon.outline) return {};
    
    const result: Record<string, number> = {};
    
    // Initialize with zero counts
    for (const section of ['introduction', 'main', 'conclusion']) {
      const points = sermon.outline[section as keyof typeof sermon.outline] || [];
      for (const point of points) {
        result[point.id] = 0;
      }
    }
    
    // Count thoughts per outline point
    for (const section of ['introduction', 'main', 'conclusion']) {
      for (const item of containers[section]) {
        if (item.outlinePointId) {
          result[item.outlinePointId] = (result[item.outlinePointId] || 0) + 1;
        }
      }
    }
    
    return result;
  };
  
  const thoughtsPerOutlinePoint = getThoughtsPerOutlinePoint();

  // Function to handle outline updates from Column components
  const handleOutlineUpdate = (updatedOutline: Outline) => {
    setSermon((prevSermon: Sermon | null) => {
      if (!prevSermon) return null;
      
      // Merge the updated outline sections with existing ones
      const mergedOutline: Outline = {
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

  // Add loading and error handling based on the hook's state
  if (loading) {
    // Fix hydration error by using consistent rendering between server and client
    return <div>{isClient ? t('common.loading') : "Loading"}...</div>;
  }

  if (error) {
    // Display error message from hook, potentially already handled by toast in hook
    return <div className="text-red-500">{isClient ? t('errors.fetchSermonStructureError') : "Error"}: {error}</div>;
  }

  if (!sermon) {
    return <div>{isClient ? t('structure.sermonNotFound') : "Sermon not found"}</div>; // Or handle case where sermonId is missing/invalid
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className={`${focusedColumn ? 'max-w-7xl mx-auto' : 'w-full'}`}>
        <div className="mb-4">
          <h1 className="text-4xl font-extrabold text-center mb-2 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            {t('structure.title')} {sermon.title}
          </h1>
          {!focusedColumn && (
            <div className="text-center">
              <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                {t('structure.backToSermon')}
              </Link>
            </div>
          )}
        </div>
        
        {/* Export Button in Focus Mode */}
        {/* {focusedColumn && (
          <div className="flex justify-end items-center mb-4">
            <div className="flex items-center gap-2">
              <span className="text-gray-700">{t('export.exportTo')}:</span>
              <ExportButtons 
                sermonId={sermon.id}
                getExportContent={getExportContentForFocusedColumn}
                orientation="horizontal"
              />
            </div>
          </div>
        )} */}
        
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Only show ambiguous section if not in focus mode or if it has content */}
          {(!focusedColumn || containers.ambiguous.length > 0) && (
            <div className="mt-8">
              <div
                className={`bg-white dark:bg-gray-800 rounded-md shadow border ${
                  containers.ambiguous.length > 0 ? "border-red-500" : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => setIsAmbiguousVisible(!isAmbiguousVisible)}
                >
                  <h2 className="text-xl font-semibold dark:text-white">
                    {columnTitles["ambiguous"]} <span className="ml-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-0.5 rounded-full">{containers.ambiguous.length}</span>
                  </h2>
                  <svg
                    className={`w-6 h-6 transform transition-transform duration-200 ${
                      isAmbiguousVisible ? "rotate-0" : "-rotate-90"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {isAmbiguousVisible && (
                  <SortableContext items={containers.ambiguous} strategy={focusedColumn ? verticalListSortingStrategy : rectSortingStrategy}>
                    <div className={`min-h-[100px] p-4 ${
                      !focusedColumn ? 'grid grid-cols-1 md:grid-cols-3 gap-4' : 'space-y-3'
                    }`}>
                      {containers.ambiguous.length === 0 ? (
                        <DummyDropZone container="ambiguous" />
                      ) : (
                        containers.ambiguous.map((item) => (
                          <SortableItem 
                            key={item.id} 
                            item={item} 
                            containerId="ambiguous" 
                            onEdit={handleEdit} 
                            showDeleteIcon={true}
                            onDelete={handleRemoveFromStructure}
                            isDeleting={item.id === deletingItemId}
                            activeId={activeId}
                          />
                        ))
                      )}
                    </div>
                  </SortableContext>
                )}
              </div>
            </div>
          )}
          
          <div className={`${!focusedColumn ? 'grid grid-cols-1 md:grid-cols-3 gap-6' : 'flex flex-col'} w-full mt-8`}>
            {/* Introduction column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "introduction") && (
              <Column
                id="introduction"
                title={columnTitles["introduction"]}
                items={containers.introduction}
                headerColor={requiredTagColors.introduction}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.introduction}
                showFocusButton={containers.ambiguous.length === 0}
                isFocusMode={focusedColumn === "introduction"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("introduction")}
                isLoading={isSorting && focusedColumn === "introduction"}
                className={focusedColumn === "introduction" ? "w-full" : ""}
                sermonId={sermon.id}
                getExportContent={getExportContentForFocusedColumn}
                onAddThought={handleAddThoughtToSection}
                isDiffModeActive={isDiffModeActive && focusedColumn === "introduction"}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={() => handleKeepAll("introduction")}
                onRevertAll={() => handleRevertAll("introduction")}
                thoughtsPerOutlinePoint={thoughtsPerOutlinePoint}
                onOutlineUpdate={handleOutlineUpdate}
                activeId={activeId}
              />
            )}
            
            {/* Main column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "main") && (
              <Column
                id="main"
                title={columnTitles["main"]}
                items={containers.main}
                headerColor={requiredTagColors.main}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.main}
                showFocusButton={containers.ambiguous.length === 0}
                isFocusMode={focusedColumn === "main"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("main")}
                isLoading={isSorting && focusedColumn === "main"}
                className={focusedColumn === "main" ? "w-full" : ""}
                sermonId={sermon.id}
                getExportContent={getExportContentForFocusedColumn}
                onAddThought={handleAddThoughtToSection}
                isDiffModeActive={isDiffModeActive && focusedColumn === "main"}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={() => handleKeepAll("main")}
                onRevertAll={() => handleRevertAll("main")}
                thoughtsPerOutlinePoint={thoughtsPerOutlinePoint}
                onOutlineUpdate={handleOutlineUpdate}
                activeId={activeId}
              />
            )}
            
            {/* Conclusion column - only show if not in focus mode or if it's the focused column */}
            {(!focusedColumn || focusedColumn === "conclusion") && (
              <Column
                id="conclusion"
                title={columnTitles["conclusion"]}
                items={containers.conclusion}
                headerColor={requiredTagColors.conclusion}
                onEdit={handleEdit}
                outlinePoints={outlinePoints.conclusion}
                showFocusButton={containers.ambiguous.length === 0}
                isFocusMode={focusedColumn === "conclusion"}
                onToggleFocusMode={handleToggleFocusMode}
                onAiSort={() => handleAiSort("conclusion")}
                isLoading={isSorting && focusedColumn === "conclusion"}
                className={focusedColumn === "conclusion" ? "w-full" : ""}
                sermonId={sermon.id}
                getExportContent={getExportContentForFocusedColumn}
                onAddThought={handleAddThoughtToSection}
                isDiffModeActive={isDiffModeActive && focusedColumn === "conclusion"}
                highlightedItems={highlightedItems}
                onKeepItem={handleKeepItem}
                onRevertItem={handleRevertItem}
                onKeepAll={() => handleKeepAll("conclusion")}
                onRevertAll={() => handleRevertAll("conclusion")}
                thoughtsPerOutlinePoint={thoughtsPerOutlinePoint}
                onOutlineUpdate={handleOutlineUpdate}
                activeId={activeId}
              />
            )}
          </div>
          <DragOverlay>
            {activeId && (() => {
              const containerKey = Object.keys(containers).find(
                (key) => containers[key].some((item) => item.id === activeId)
              );
              
              const activeItem = containerKey
                ? containers[containerKey].find((item) => item.id === activeId)
                : null;
                
              return activeItem ? (
                <div 
                  className="flex items-start space-x-2 p-4 bg-white rounded-md border border-gray-300 shadow-lg opacity-90"
                  style={{ width: 'auto' }}
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
            thoughtId={editingItem.id.startsWith('temp-') ? undefined : editingItem.id}
            initialText={editingItem.content}
            initialTags={editingItem.customTagNames?.map((tag) => tag.name) || []}
            initialOutlinePointId={editingItem.outlinePointId}
            allowedTags={allowedTags}
            sermonOutline={sermon?.outline}
            containerSection={addingThoughtToSection || Object.keys(containers).find(key => 
              containers[key].some(item => item.id === editingItem.id)
            )}
            onSave={handleSaveEdit}
            onClose={handleCloseEdit}
          />
        )}
      </div>
    </div>
  );
}
