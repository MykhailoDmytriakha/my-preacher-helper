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
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Column from "@/components/Column";
import SortableItem from "@/components/SortableItem";
import { Item, Sermon, OutlinePoint, Thought, Outline } from "@/models/models";
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
      className={`p-4 text-center text-gray-500 border-dashed border-2 border-blue-300 col-span-full ${
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
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [containers, setContainers] = useState<Record<string, Item[]>>({
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [],
  });
  const [outlinePoints, setOutlinePoints] = useState<{
    introduction: OutlinePoint[];
    main: OutlinePoint[];
    conclusion: OutlinePoint[];
  }>({
    introduction: [],
    main: [],
    conclusion: [],
  });
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
  const [loading, setLoading] = useState(true);
  const [isAmbiguousVisible, setIsAmbiguousVisible] = useState(true);
  const [requiredTagColors, setRequiredTagColors] = useState<{
    introduction?: string;
    main?: string;
    conclusion?: string;
  }>({});
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const { t } = useTranslation();
  const [isClient, setIsClient] = useState(false);
  const [focusedColumn, setFocusedColumn] = useState<string | null>(null);
  const [isSorting, setIsSorting] = useState(false);
  const [addingThoughtToSection, setAddingThoughtToSection] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const columnTitles: Record<string, string> = {
    introduction: t('structure.introduction'),
    main: t('structure.mainPart'),
    conclusion: t('structure.conclusion'),
    ambiguous: t('structure.underConsideration'),
  };

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    async function initializeSermon() {
      if (!sermonId) {
        setLoading(false);
        return;
      }
  
      try {
        const fetchedSermon = await getSermonById(sermonId);
        if (!fetchedSermon) {
          throw new Error("Failed to fetch sermon");
        }
        setSermon(fetchedSermon);
  
        const tagsData = await getTags(fetchedSermon.userId);
        const allTags: Record<string, { name: string; color?: string }> = {};
        tagsData.requiredTags.forEach((tag: any) => {
          const normalizedName = tag.name.trim().toLowerCase();
          allTags[normalizedName] = { name: tag.name, color: tag.color };
        });
        tagsData.customTags.forEach((tag: any) => {
          const normalizedName = tag.name.trim().toLowerCase();
          allTags[normalizedName] = { name: tag.name, color: tag.color };
        });

        // Set required tag colors directly from the theme, ignore fetched tag colors for these
        setRequiredTagColors({
          introduction: SERMON_SECTION_COLORS.introduction.base,
          main: SERMON_SECTION_COLORS.mainPart.base,
          conclusion: SERMON_SECTION_COLORS.conclusion.base,
        });
  
        // Filter allowed tags and ensure a default color is provided if missing
        const filteredAllowedTags = Object.values(allTags)
          .filter(
            (tag) =>
              !["вступление", "основная часть", "заключение"].includes(tag.name.toLowerCase())
          )
          .map(tag => ({
            ...tag,
            color: tag.color || "#808080" // Provide default gray color if missing
          }));
        setAllowedTags(filteredAllowedTags);
  
        const allThoughtItems: Record<string, Item> = {};
        fetchedSermon.thoughts.forEach((thought: any) => {
          const stableId = thought.id;
          const normalizedTags = thought.tags.map((tag: string) => tag.trim().toLowerCase());
          const customTagNames = normalizedTags.filter(
            (tag: string) => !["вступление", "основная часть", "заключение"].includes(tag)
          );
          const enrichedCustomTags = customTagNames.map((tagName: string) => {
            const tagInfo = allTags[tagName];
            const color = tagInfo?.color || "#4c51bf";
            return {
              name: tagInfo?.name || tagName,
              color: color,
            };
          });
  
          const relevantTags = normalizedTags.filter((tag: string) =>
            ["вступление", "основная часть", "заключение"].includes(tag)
          );
  
          // Find associated outline point if available
          let outlinePoint;
          if (thought.outlinePointId && fetchedSermon.outline) {
            // Check in each section
            const outlineSections = ['introduction', 'main', 'conclusion'] as const;
            const sectionTranslations: Record<string, string> = {
              'introduction': t('outline.introduction') || 'Introduction',
              'main': t('outline.mainPoints') || 'Main Points',
              'conclusion': t('outline.conclusion') || 'Conclusion'
            };
            
            for (const section of outlineSections) {
              const point = fetchedSermon.outline[section]?.find((p: OutlinePoint) => p.id === thought.outlinePointId);
              if (point) {
                outlinePoint = {
                  text: point.text,
                  section: '' // Don't show section in structure page
                };
                break;
              }
            }
          }

          const item: Item = {
            id: stableId,
            content: thought.text,
            customTagNames: enrichedCustomTags,
            requiredTags: relevantTags.map((tag: string) => allTags[tag]?.name || tag),
            outlinePoint: outlinePoint,
            outlinePointId: thought.outlinePointId
          };
          allThoughtItems[stableId] = item;
        });
  
        let intro: Item[] = [];
        let main: Item[] = [];
        let concl: Item[] = [];
        let ambiguous: Item[] = [];
        const usedIds = new Set<string>();
  
        // Step 1: Process structure (skip ambiguous)
        if (fetchedSermon.structure) {
          let structureObj = typeof fetchedSermon.structure === "string" ? JSON.parse(fetchedSermon.structure) : fetchedSermon.structure;
          if (structureObj) {
            // Only process intro, main, concl
            ["introduction", "main", "conclusion"].forEach((section) => {
              if (Array.isArray(structureObj[section])) {
                const target = section === "introduction" ? intro : section === "main" ? main : concl;
                const tag = columnTitles[section];
                structureObj[section].forEach((thoughtId) => {
                  const item = allThoughtItems[thoughtId];
                  if (item) {
                    item.requiredTags = [tag];
                    target.push(item);
                    usedIds.add(thoughtId);
                  }
                });
              }
            });
            // Do not process ambiguous here
          }
        }

        // Step 2: Process all remaining items by tags
        Object.values(allThoughtItems).forEach((item) => {
          if (!usedIds.has(item.id)) {
            if (item.requiredTags?.length === 1) {
              const tagLower = item.requiredTags[0].toLowerCase();
              if (tagLower === "вступление") intro.push(item);
              else if (tagLower === "основная часть") main.push(item);
              else if (tagLower === "заключение") concl.push(item);
              else ambiguous.push(item);
            } else {
              ambiguous.push(item);
            }
          }
        });
  
        setContainers({ introduction: intro, main, conclusion: concl, ambiguous });
        setIsAmbiguousVisible(ambiguous.length > 0);

        const structure = {
          introduction: intro.map((item) => item.id),
          main: main.map((item) => item.id),
          conclusion: concl.map((item) => item.id),
          ambiguous: ambiguous.map((item) => item.id),
        }
        if (isStructureChanged(fetchedSermon.structure || {}, structure)) {
          await updateStructure(sermonId, structure);
        }

        // Fetch outline data
        try {
          const outlineData = await getSermonOutline(sermonId);
          console.log(`Outline data: ${JSON.stringify(outlineData)}`);
          if (outlineData) {
            setOutlinePoints({
              introduction: outlineData.introduction || [],
              main: outlineData.main || [],
              conclusion: outlineData.conclusion || [],
            });
          }
        } catch (error) {
          console.error("Error fetching sermon outline:", error);
        }
      } catch (error) {
        console.error("Error initializing sermon:", error);
      } finally {
        setLoading(false);
      }
    }
  
    initializeSermon();
  }, [sermonId]);
  

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
        setSermon({
          ...sermon,
          thoughts: [...sermon.thoughts, addedThought]
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
        setSermon({ ...sermon, thoughts: updatedThoughts });

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
    setActiveId(id);
    // Capture the original container at the start of the drag
    const original = Object.keys(containers).find((key) =>
      containers[key].some((item) => item.id === id)
    );
    setOriginalContainer(original || null);
    
    // Log drag start
    const item = containers[original || ""]?.find(item => item.id === id);
    console.log(`[DnD] Drag started - Item ID: ${id}`);
    console.log(`[DnD] Starting container: ${original}`);
    console.log(`[DnD] Item content: ${item?.content?.substring(0, 30)}${item?.content && item.content.length > 30 ? '...' : ''}`);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    // Early return if no over target or same container
    if (!over) return;
    
    const activeId = active.id;
    const overId = over.id;
    
    // Find which container the active item is in
    const activeContainer = Object.keys(containers).find(
      (key) => containers[key].some((item) => item.id === activeId)
    );
    
    // Find which container the target is in
    const overContainer = over.data?.current?.container || 
                         Object.keys(containers).find(
                           (key) => containers[key].some((item) => item.id === overId)
                         );
    
    // Skip if we couldn't determine the containers
    if (!activeContainer || !overContainer) return;
    
    // If dragging a highlighted item, automatically confirm the change
    if (activeId in highlightedItems) {
      // Remove from highlighted items to confirm the change
      setHighlightedItems(prev => {
        const newHighlighted = { ...prev };
        delete newHighlighted[activeId as string];
        
        // If no more highlighted items, exit diff mode
        if (Object.keys(newHighlighted).length === 0) {
          setIsDiffModeActive(false);
          setPreSortState(null);
        }
        
        return newHighlighted;
      });
    }
    
    // Skip if same container and not over another item
    if (activeContainer === overContainer && overId === 'dummy-drop-zone') {
      return;
    }
    
    if (
      !activeContainer ||
      !overContainer ||
      activeContainer === overContainer
    ) {
      return;
    }
    
    // Find the index of the target item in the destination container
    let targetIndex = -1;
    
    // Check if we're over a specific item in the container
    if (overId !== overContainer && overId !== 'dummy-drop-zone') {
      // We're over a specific item, find its index
      targetIndex = containers[overContainer].findIndex(item => item.id === overId);
    }
    
    setContainers((prev) => {
      const sourceItems = [...prev[activeContainer]];
      const destItems = [...prev[overContainer]];
      const activeIndex = sourceItems.findIndex((item) => item.id === activeId);
      
      if (activeIndex === -1) return prev;
      
      const [movedItem] = sourceItems.splice(activeIndex, 1);
      const requiredTags =
        overContainer === "ambiguous" ? [] : [columnTitles[overContainer]];
      
      const updatedItem = { ...movedItem, requiredTags };
      
      // Insert at the appropriate position
      if (targetIndex !== -1) {
        // Insert BEFORE the target item
        destItems.splice(targetIndex, 0, updatedItem);
      } else {
        // If we're over the container itself or no valid target was found
        destItems.push(updatedItem);
      }
      
      const newState = {
        ...prev,
        [activeContainer]: sourceItems,
        [overContainer]: destItems,
      };
      
      // Update the ref immediately so we have the latest containers
      containersRef.current = newState;
      return newState;
    });
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
    
    // Early return if no valid drop target
    if (!over || !sermon) {
      setActiveId(null);
      setOriginalContainer(null);
      return;
    }
    
    // If the dragged item was a highlighted item, confirm the change
    if (active.id in highlightedItems) {
      // Remove from highlighted items to confirm the change
      setHighlightedItems(prev => {
        const newHighlighted = { ...prev };
        delete newHighlighted[active.id as string];
        
        // If no more highlighted items, exit diff mode
        if (Object.keys(newHighlighted).length === 0) {
          setIsDiffModeActive(false);
          setPreSortState(null);
        }
        
        return newHighlighted;
      });
    }
    
    const activeContainer = originalContainer; // Use the original container
    let overContainer = over.data.current?.container;
    
    if (over.id === "dummy-drop-zone") {
      overContainer = "ambiguous";
    } else if (!overContainer) {
      overContainer = String(over.id);
    }
    
    // Find the index of the target item in the destination container
    let targetItemIndex = -1;
    let droppedOnItem = false;
    
    if (over.id !== overContainer) {
      // We're dropping onto a specific item, not just the container
      droppedOnItem = true;
      targetItemIndex = containersRef.current[overContainer].findIndex(item => item.id === over.id);
    }
    
    if (
      !activeContainer ||
      !overContainer ||
      !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
    ) {
      setActiveId(null);
      setOriginalContainer(null);
      return;
    }
    
    // Prepare a local copy of containers from the ref
    let updatedContainers = { ...containersRef.current };
    
    if (activeContainer === overContainer) {
      const items = [...updatedContainers[activeContainer]];
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        updatedContainers[activeContainer] = arrayMove(items, oldIndex, newIndex);
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;
      }
    } else {
      // For cross-container movement
      const newPositionIndex = updatedContainers[overContainer].findIndex((item) => item.id === active.id);
      
      // Final positioning fix: If the drop target was a specific item but our item ended up elsewhere,
      // reposition it to the correct place
      if (droppedOnItem && targetItemIndex !== -1 && newPositionIndex !== targetItemIndex && 
          newPositionIndex !== -1) {
        // Remove from current position
        const items = [...updatedContainers[overContainer]];
        const [itemToMove] = items.splice(newPositionIndex, 1);
        
        // Insert BEFORE the target item
        items.splice(targetItemIndex, 0, itemToMove);
        
        updatedContainers[overContainer] = items;
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;
      }
      
      const movedItem = updatedContainers[overContainer].find((item) => item.id === active.id);
      
      if (movedItem) {
        const updatedItem: Thought = {
          ...sermon.thoughts.find((thought: Thought) => thought.id === movedItem.id)!,
          tags: [
            ...(movedItem.requiredTags || []),
            ...(movedItem.customTagNames || []).map((tag) => tag.name),
          ],
        };
        
        try {
          const updatedThought = await updateThought(sermon.id, updatedItem);
          const newThoughts = sermon.thoughts.map((thought: Thought) =>
            thought.id === updatedItem.id ? updatedThought : thought
          );
          setSermon({ ...sermon, thoughts: newThoughts });
        } catch (error) {
          console.error("Error updating thought:", error);
        }
      }
    }
    
    // Build newStructure using the up-to-date containers from the ref
    const newStructure = {
      introduction: containersRef.current.introduction.map((item) => item.id),
      main: containersRef.current.main.map((item) => item.id),
      conclusion: containersRef.current.conclusion.map((item) => item.id),
      ambiguous: containersRef.current.ambiguous.map((item) => item.id),
    };
    
    const changesDetected = isStructureChanged(sermon.structure || {}, newStructure);
    if (changesDetected) {
      await updateStructure(sermon.id, newStructure);
      setSermon((prev) => (prev ? { ...prev, structure: newStructure} : prev));
    }
    
    setActiveId(null);
    setOriginalContainer(null);
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
      console.log(`handleAiSort: Starting AI sort for ${columnId} with ${containers[columnId].length} items`);
      
      // We'll now sort all items, not just unassigned ones
      const outlinePointsForColumn = outlinePoints[columnId as keyof typeof outlinePoints] || [];
      
      // Limit to reasonable number for AI
      const MAX_THOUGHTS_FOR_SORTING = 25;
      const itemsToSort = containers[columnId].slice(0, MAX_THOUGHTS_FOR_SORTING);
      
      console.log(`handleAiSort: Processing ${itemsToSort.length} items in column ${columnId}`);
      
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
        console.error('Invalid AI response:', sortedItems);
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
      
      // Only enter diff mode if any changes were made
      const hasChanges = Object.keys(newHighlightedItems).length > 0;
      
      if (hasChanges) {
        // Update state with new highlighted items and enable diff mode
        setHighlightedItems(newHighlightedItems);
        setIsDiffModeActive(true);
        
        // Update containers with the new sorted items
        setContainers(prev => ({
          ...prev,
          [columnId]: sortedItems
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
      console.error('Error sorting items:', error);
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
      console.error("Cannot remove item: Invalid arguments or not in ambiguous container");
      toast.error(t('errors.removingError') || "Error removing item.");
      return;
    }

    // Find thought first to use its text in confirmation
    const thoughtToDelete = sermon.thoughts.find(t => t.id === itemId);
    if (!thoughtToDelete) {
      console.error(`[Structure] Could not find thought with ID ${itemId} to delete.`);
      toast.error(t('errors.deletingError') || "Failed to find thought to delete.");
      return;
    }

    const confirmMessage = t('sermon.deleteThoughtConfirm', { 
      defaultValue: `Are you sure you want to permanently delete this thought: "${thoughtToDelete.text}"?`,
      text: thoughtToDelete.text
    });
    if (!window.confirm(confirmMessage)) {
      console.log(`[Structure] Deletion cancelled for thought ${itemId}`);
      return;
    }

    // <<< Set deleting state BEFORE async call >>>
    setDeletingItemId(itemId);

    try {
      console.log(`[Structure] Attempting to delete thought ${itemId} from sermon ${sermonId}`);
      await deleteThought(sermonId, thoughtToDelete); 
      console.log(`[Structure] Successfully deleted thought ${itemId} from backend.`);
      
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
          console.log(`[Structure] Structure changed after deletion. Updating DB.`);
          try {
              await updateStructure(sermonId, newStructure);
              console.log("[Structure] Database structure updated successfully after deletion.");
              // Ensure the final sermon state reflects the latest structure
              setSermon(prevSermon => prevSermon ? { ...prevSermon, structure: newStructure } : prevSermon);
          } catch (structureError) {
              console.error("[Structure] Error updating database structure after deletion:", structureError);
              toast.error(t('errors.savingError') || "Error saving structure changes after deleting item.");
              // Note: Thought is deleted, but structure might be out of sync. UI reflects deleted state.
          }
      } else {
         console.log(`[Structure] Structure did not change after deletion. DB structure update skipped.`);
      }

      toast.success(t('structure.thoughtDeletedSuccess') || "Thought deleted successfully.");

    } catch (deleteError) {
      console.error(`[Structure] Error deleting thought ${itemId}:`, deleteError);
      toast.error(t('errors.deletingError') || "Failed to delete thought.");
      // Do not update UI state if backend deletion fails
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
        console.log("Debounced structure save completed");
      } catch (error) {
        console.error("Error in debounced structure save:", error);
        toast.error(t('errors.failedToSaveStructure'));
      }
    }, 500),
    []
  );

  const debouncedSaveThought = useCallback(
    debounce(async (sermonId: string, thought: Thought) => {
      try {
        const updatedThought = await updateThought(sermonId, thought);
        console.log("Debounced thought save completed:", updatedThought.id);
        // Update sermon state with updated thought
        setSermon((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            thoughts: prev.thoughts.map((t) => (t.id === updatedThought.id ? updatedThought : t)),
          };
        });
      } catch (error) {
        console.error("Error in debounced thought save:", error);
        toast.error(t('errors.failedToSaveThought'));
      }
    }, 500),
    []
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
    // Update sermon state with new outline
    setSermon(prevSermon => {
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {isClient ? t('structure.loadingSermon') : 'Loading...'}
      </div>
    );
  }

  if (!sermonId || !sermon) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t('structure.notFound')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className={`${focusedColumn ? 'max-w-7xl mx-auto' : 'w-full'}`}>
        <div className="mb-4">
          <h1 className="text-4xl font-extrabold text-center mb-2 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            {t('structure.title')} {sermon.title}
          </h1>
          {!focusedColumn && (
            <div className="text-center">
              <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800">
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
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Only show ambiguous section if not in focus mode or if it has content */}
          {(!focusedColumn || containers.ambiguous.length > 0) && (
            <div className="mt-8">
              <div
                className={`bg-white rounded-md shadow border ${
                  containers.ambiguous.length > 0 ? "border-red-500" : "border-gray-200"
                }`}
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => setIsAmbiguousVisible(!isAmbiguousVisible)}
                >
                  <h2 className="text-xl font-semibold">
                    {columnTitles["ambiguous"]} <span className="ml-2 text-sm bg-gray-200 text-gray-800 px-2 py-0.5 rounded-full">{containers.ambiguous.length}</span>
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
