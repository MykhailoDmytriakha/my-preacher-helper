"use client";

import React, { useState, useEffect, Suspense, useRef } from "react";
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
import { Item, Sermon, Structure, OutlinePoint, Thought } from "@/models/models";
import EditThoughtModal from "@/components/EditThoughtModal";
import ExportButtons from "@/components/ExportButtons";
import { getTags } from "@/services/tag.service";
import { getSermonById } from "@/services/sermon.service";
import { updateThought } from "@/services/thought.service";
import { updateStructure } from "@/services/structure.service";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { getSermonOutline } from "@/services/outline.service";
import { sortItemsWithAI } from "@/services/sortAI.service";
import { toast } from 'sonner';

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
        const allTags: Record<string, { name: string; color: string }> = {};
        tagsData.requiredTags.forEach((tag: any) => {
          const normalizedName = tag.name.trim().toLowerCase();
          allTags[normalizedName] = { name: tag.name, color: tag.color };
        });
        tagsData.customTags.forEach((tag: any) => {
          const normalizedName = tag.name.trim().toLowerCase();
          allTags[normalizedName] = { name: tag.name, color: tag.color };
        });
        setRequiredTagColors({
          introduction: allTags["вступление"]?.color,
          main: allTags["основная часть"]?.color,
          conclusion: allTags["заключение"]?.color,
        });
  
        setAllowedTags(
          Object.values(allTags).filter(
            (tag) =>
              !["вступление", "основная часть", "заключение"].includes(tag.name.toLowerCase())
          )
        );
  
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
  
          const item: Item = {
            id: stableId,
            content: thought.text,
            customTagNames: enrichedCustomTags,
            requiredTags: relevantTags.map((tag: string) => allTags[tag]?.name || tag),
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

  const handleSaveEdit = async (updatedText: string, updatedTags: string[]) => {
    if (!editingItem || !sermon) return;

    const updatedItem: Thought = {
      ...sermon.thoughts.find((thought) => thought.id === editingItem.id)!,
      text: updatedText,
      tags: [...(editingItem.requiredTags || []), ...updatedTags],
    };

    try {
      const updatedThought = await updateThought(sermon.id, updatedItem);
      const updatedThoughts = sermon.thoughts.map((thought) =>
        thought.id === updatedItem.id ? updatedThought : thought
      );
      setSermon({ ...sermon, thoughts: updatedThoughts });

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
    if (!over || active.id === over.id) return;

    const activeContainer = active.data.current?.container;
    let overContainer = over.data.current?.container;

    console.log(`[DnD] DETAIL - Active ID: ${active.id}, Type: ${typeof active.id}`);
    console.log(`[DnD] DETAIL - Over ID: ${over.id}, Type: ${typeof over.id}`);
    console.log(`[DnD] DETAIL - Over data:`, over.data.current);
    console.log(`[DnD] DETAIL - Active container: ${activeContainer}`);
    console.log(`[DnD] DETAIL - Initial over container: ${overContainer}`);

    if (over.id === "dummy-drop-zone") {
      overContainer = "ambiguous";
      console.log(`[DnD] DETAIL - Over dummy-drop-zone, setting overContainer to ambiguous`);
    } else if (!overContainer) {
      overContainer = String(over.id);
      console.log(`[DnD] DETAIL - No overContainer, setting to over.id: ${over.id}`);
    }

    if (
      !activeContainer ||
      !overContainer ||
      activeContainer === overContainer ||
      !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
    ) {
      console.log(`[DnD] DETAIL - Early return conditions: !activeContainer=${!activeContainer}, !overContainer=${!overContainer}, activeContainer===overContainer=${activeContainer === overContainer}, invalid container=${!["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)}`);
      return;
    }

    console.log(`[DnD] Dragging over - Item ID: ${active.id}`);
    console.log(`[DnD] Source container: ${activeContainer}`);
    console.log(`[DnD] Target container: ${overContainer}`);
    console.log(`[DnD] Target item ID in container: ${over.id}`);
    console.log(`[DnD] DETAIL - Is over.id equal to overContainer? ${over.id === overContainer}`);
    
    // Find the index of the target item in the destination container
    let targetIndex = -1;
    
    // IMPROVED: First, check if we're over a specific item in the container
    if (over.id !== overContainer) {
      // We're over a specific item, find its index
      targetIndex = containers[overContainer].findIndex(item => item.id === over.id);
      console.log(`[DnD] DETAIL - Dragging over a specific item in ${overContainer}, found at index ${targetIndex}`);
      
      // LOG the insertion position intent
      console.log(`[DnD] INTENT - Will insert BEFORE the item at index ${targetIndex}`);
    } else {
      // We're over the container itself
      console.log(`[DnD] DETAIL - Dragging over the container ${overContainer} itself, not a specific item`);
    }

    // Log container state BEFORE the change
    console.log(`[DnD] BEFORE - ${overContainer} container items:`, containers[overContainer].map(item => ({ id: item.id, content: item.content?.substring(0, 15) })));
    
    setContainers((prev) => {
      const sourceItems = [...prev[activeContainer]];
      const destItems = [...prev[overContainer]];
      const activeIndex = sourceItems.findIndex((item) => item.id === active.id);

      if (activeIndex === -1) return prev;

      const [movedItem] = sourceItems.splice(activeIndex, 1);
      const requiredTags =
        overContainer === "ambiguous" ? [] : [columnTitles[overContainer]];

      const updatedItem = { ...movedItem, requiredTags };
      
      // Insert at the appropriate position
      if (targetIndex !== -1) {
        // FIX: Insert BEFORE the target item instead of after it
        // This matches the visual preview behavior better
        console.log(`[DnD] IMPROVED: Inserting at position ${targetIndex} in ${overContainer}`);
        destItems.splice(targetIndex, 0, updatedItem);
        console.log(`[DnD] DETAIL - Item inserted BEFORE index ${targetIndex}, new destItems length: ${destItems.length}`);
      } else {
        // If we're over the container itself or no valid target was found
        console.log(`[DnD] Inserting at the end of ${overContainer} (container-level drop)`);
        destItems.push(updatedItem);
        console.log(`[DnD] DETAIL - Item pushed to end, new destItems length: ${destItems.length}`);
      }
      
      console.log(`[DnD] Item moved during drag - From index ${activeIndex} in ${activeContainer} to position ${
        targetIndex !== -1 ? targetIndex : destItems.length - 1
      } in ${overContainer}`);
      
      const newState = {
        ...prev,
        [activeContainer]: sourceItems,
        [overContainer]: destItems,
      };

      // Log the new destItems array AFTER the change
      console.log(`[DnD] AFTER - ${overContainer} container items:`, destItems.map(item => ({ id: item.id, content: item.content?.substring(0, 15) })));
      
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
        // Handle cases where a section might not exist
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
    
    console.log(`[DnD] Drag ended - Item ID: ${active.id}`);
    console.log(`[DnD] Original container: ${originalContainer}`);
    
    if (!over || !sermon) {
      console.log(`[DnD] No valid drop target - drag cancelled`);
      setActiveId(null);
      setOriginalContainer(null);
      return;
    }

    console.log(`[DnD] DETAIL - Over ID: ${over.id}, Type: ${typeof over.id}`);
    console.log(`[DnD] DETAIL - Over data:`, over.data.current);

    const activeContainer = originalContainer; // Use the original container
    let overContainer = over.data.current?.container;

    console.log(`[DnD] DETAIL - Initial over container: ${overContainer}`);

    if (over.id === "dummy-drop-zone") {
      overContainer = "ambiguous";
      console.log(`[DnD] DETAIL - Over dummy-drop-zone, setting overContainer to ambiguous`);
    } else if (!overContainer) {
      overContainer = String(over.id);
      console.log(`[DnD] DETAIL - No overContainer, setting to over.id: ${over.id}`);
    }

    console.log(`[DnD] Drop target container: ${overContainer}`);
    console.log(`[DnD] Drop target ID: ${over.id}`);
    console.log(`[DnD] DETAIL - Is over.id equal to overContainer? ${over.id === overContainer}`);
    
    // Find the index of the target item in the destination container
    let targetItemIndex = -1;
    let droppedOnItem = false;
    
    if (over.id !== overContainer) {
      // We're dropping onto a specific item, not just the container
      droppedOnItem = true;
      targetItemIndex = containersRef.current[overContainer].findIndex(item => item.id === over.id);
      console.log(`[DnD] DETAIL - Dropped on specific item at index ${targetItemIndex} in ${overContainer}`);
      console.log(`[DnD] Intended drop position: BEFORE item at index ${targetItemIndex} in ${overContainer}`);
    } else {
      console.log(`[DnD] DETAIL - Dropped on container ${overContainer} itself, not a specific item`);
    }
    
    if (
      !activeContainer ||
      !overContainer ||
      !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
    ) {
      console.log(`[DnD] Invalid container - drag operation cancelled`);
      setActiveId(null);
      setOriginalContainer(null);
      return;
    }

    // Prepare a local copy of containers from the ref
    let updatedContainers = { ...containersRef.current };

    // Log container state BEFORE any changes in handleDragEnd
    console.log(`[DnD] DRAGEND BEFORE - ${overContainer} container items:`, updatedContainers[overContainer].map(item => 
      ({ id: item.id, content: item.content?.substring(0, 15) })
    ));

    if (activeContainer === overContainer) {
      const items = [...updatedContainers[activeContainer]];
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      
      console.log(`[DnD] Reordering within same container: ${activeContainer}`);
      console.log(`[DnD] Moving from index ${oldIndex} to index ${newIndex}`);
      
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        updatedContainers[activeContainer] = arrayMove(items, oldIndex, newIndex);
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;
        console.log(`[DnD] Reordering complete - item now at position ${newIndex}`);
      }
    } else {
      // For cross-container movement
      const newPositionIndex = updatedContainers[overContainer].findIndex((item) => item.id === active.id);
      console.log(`[DnD] Actual placement: item is now at index ${newPositionIndex} in ${overContainer}`);
      
      // Log the actual items and their order
      console.log(`[DnD] ACTUAL ITEMS in ${overContainer}:`, updatedContainers[overContainer].map((item, idx) => 
        `${idx}: ${item.id.substring(0, 6)}... - ${item.content?.substring(0, 15)}`
      ));
      
      // FINAL POSITIONING FIX: If the drop target was a specific item but our item ended up elsewhere,
      // reposition it to the correct place
      if (droppedOnItem && targetItemIndex !== -1 && newPositionIndex !== targetItemIndex && 
          newPositionIndex !== -1) {
        console.log(`[DnD] FINAL FIX: Repositioning item from index ${newPositionIndex} to BEFORE target at index ${targetItemIndex}`);
        console.log(`[DnD] DETAIL - Conditions that triggered fix:`);
        console.log(`  - droppedOnItem: ${droppedOnItem}`);
        console.log(`  - targetItemIndex !== -1: ${targetItemIndex !== -1}`);
        console.log(`  - newPositionIndex !== targetItemIndex: ${newPositionIndex !== targetItemIndex}`);
        console.log(`  - newPositionIndex !== -1: ${newPositionIndex !== -1}`);
        
        // Remove from current position
        const items = [...updatedContainers[overContainer]];
        const [itemToMove] = items.splice(newPositionIndex, 1);
        
        // Insert BEFORE the target item
        items.splice(targetItemIndex, 0, itemToMove);
        
        updatedContainers[overContainer] = items;
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;
        console.log(`[DnD] Item repositioned successfully`);
        
        // Log after repositioning
        console.log(`[DnD] AFTER REPOSITIONING - ${overContainer} items:`, updatedContainers[overContainer].map((item, idx) => 
          `${idx}: ${item.id.substring(0, 6)}... - ${item.content?.substring(0, 15)}`
        ));
      } else if (droppedOnItem && targetItemIndex !== -1 && newPositionIndex !== targetItemIndex) {
        console.log(`[DnD] REPOSITIONING SKIPPED - Conditions not met:`);
        console.log(`  - droppedOnItem: ${droppedOnItem}`);
        console.log(`  - targetItemIndex !== -1: ${targetItemIndex !== -1}`);
        console.log(`  - newPositionIndex !== targetItemIndex: ${newPositionIndex !== targetItemIndex}`);
        console.log(`  - newPositionIndex !== -1: ${newPositionIndex !== -1}`);
      }
      
      const movedItem = updatedContainers[overContainer].find((item) => item.id === active.id);
      
      console.log(`[DnD] Moving between containers: ${activeContainer} → ${overContainer}`);
      
      if (movedItem) {
        const itemContent = movedItem.content?.substring(0, 30) + (movedItem.content?.length > 30 ? '...' : '');
        console.log(`[DnD] Item content: ${itemContent}`);
        
        const updatedItem: Thought = {
          ...sermon.thoughts.find((thought) => thought.id === movedItem.id)!,
          tags: [
            ...(movedItem.requiredTags || []),
            ...(movedItem.customTagNames || []).map((tag) => tag.name),
          ],
        };

        try {
          const updatedThought = await updateThought(sermon.id, updatedItem);
          const newThoughts = sermon.thoughts.map((thought) =>
            thought.id === updatedItem.id ? updatedThought : thought
          );
          setSermon({ ...sermon, thoughts: newThoughts });
          console.log(`[DnD] Updated thought tags in database`);
        } catch (error) {
          console.error("[DnD] Error updating thought:", error);
        }
      }
    }

    // Build newStructure using the up-to-date containers from the ref.
    const newStructure = {
      introduction: containersRef.current.introduction.map((item) => item.id),
      main: containersRef.current.main.map((item) => item.id),
      conclusion: containersRef.current.conclusion.map((item) => item.id),
      ambiguous: containersRef.current.ambiguous.map((item) => item.id),
    };
    
    // Log final state of the container
    console.log(`[DnD] FINAL STATE - ${overContainer} container items:`, 
      containersRef.current[overContainer].map((item, idx) => 
        `${idx}: ${item.id.substring(0, 6)}... - ${item.content?.substring(0, 15)}`
      )
    );
    
    console.log(`[DnD] Final structure after drag operation:`);
    console.log(`[DnD] - Introduction: ${newStructure.introduction.length} items`);
    console.log(`[DnD] - Main: ${newStructure.main.length} items`);
    console.log(`[DnD] - Conclusion: ${newStructure.conclusion.length} items`);
    console.log(`[DnD] - Ambiguous: ${newStructure.ambiguous.length} items`);
    
    const changesDetected = isStructureChanged(sermon.structure || {}, newStructure);
    if (changesDetected) {
      console.log("[DnD] Structure changes detected, updating in database");
      await updateStructure(sermon.id, newStructure);
      setSermon((prev) => (prev ? { ...prev, structure: newStructure} : prev));
      console.log("[DnD] Structure updated successfully");
    } else {
      console.log("[DnD] No structure changes detected");
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

  const getExportContentForFocusedColumn = async () => {
    if (!focusedColumn || !containers[focusedColumn]) {
      return '';
    }
    
    const items = containers[focusedColumn];
    const title = columnTitles[focusedColumn];
    let content = `# ${title}\n\n`;
    
    // Add outline points if available
    if (focusedColumn !== 'ambiguous' && 
        (focusedColumn === 'introduction' || focusedColumn === 'main' || focusedColumn === 'conclusion') && 
        outlinePoints[focusedColumn as keyof typeof outlinePoints]?.length > 0) {
      content += `## ${t('structure.outlinePoints')}\n`;
      outlinePoints[focusedColumn as keyof typeof outlinePoints].forEach((point: OutlinePoint) => {
        content += `- ${point.text}\n`;
      });
      content += '\n';
    }
    
    // Add items
    content += `## ${t('structure.content')}\n`;
    if (items.length === 0) {
      content += `${t('structure.noEntries')}\n`;
    } else {
      items.forEach((item, index) => {
        content += `${index + 1}. ${item.content}\n`;
        if (item.customTagNames && item.customTagNames.length > 0) {
          // Extract tag names from the tag objects before joining
          const tagNames = item.customTagNames.map(tag => 
            typeof tag === 'string' ? tag : tag.name
          ).filter(Boolean);
          
          if (tagNames.length > 0) {
            content += `   ${t('structure.tags')}: ${tagNames.join(', ')}\n`;
          }
        }
        content += '\n';
      });
    }
    
    return content;
  };

  const handleAiSort = async (columnId: string) => {
    if (!sermonId || !columnId) return;
    
    try {
      setIsSorting(true);
      const columnItems = containers[columnId];
      
      if (columnItems.length <= 1) {
        // No need to sort 0 or 1 items
        console.log(`handleAiSort: Not enough items (${columnItems.length}) to sort in ${columnId}`);
        setIsSorting(false);
        return;
      }
      
      console.log(`handleAiSort: Starting AI sort for ${columnItems.length} items in ${columnId}`);
      // Pass the outline points for the specific column
      const sortedItems = await sortItemsWithAI(
        columnId, 
        columnItems, 
        sermonId, 
        outlinePoints[columnId as keyof typeof outlinePoints]
      );

      // Verify we received valid sorted items
      if (!sortedItems || !Array.isArray(sortedItems) || sortedItems.length !== columnItems.length) {
        console.error(`handleAiSort: Invalid sorted items returned. Expected ${columnItems.length} items, got ${sortedItems?.length || 0}`);
        toast.error(t('errors.aiSortingError') || "Error sorting items with AI. The AI couldn't properly organize your content.");
        setIsSorting(false);
        return;
      }

      // Log sorted items for debugging
      console.log(`handleAiSort: Sorted items in ${columnId}:`);
      for (const item of sortedItems) {
        console.log(item.content.substring(0, 50) + (item.content.length > 50 ? '...' : ''));
      }
      
      // Update the containers state with the sorted items and save to database in the same operation
      setContainers(prev => {
        const newContainers = {
          ...prev,
          [columnId]: sortedItems
        };
        
        // Update the reference for onDragEnd
        containersRef.current = newContainers;
        
        // Build the new structure for the database update within the callback
        const newStructure = {
          introduction: newContainers.introduction.map((item) => item.id),
          main: newContainers.main.map((item) => item.id),
          conclusion: newContainers.conclusion.map((item) => item.id),
          ambiguous: newContainers.ambiguous.map((item) => item.id),
        };
        
        // Save the updated structure to the database
        // We use a timeout to ensure this doesn't block the state update
        setTimeout(async () => {
          try {
            console.log(`handleAiSort: Saving structure to database for ${columnId}`, newStructure);
            const response = await updateStructure(sermonId, newStructure);
            console.log(`handleAiSort: Database update response:`, response);
            
            // Update the sermon state with the new structure
            setSermon((prev) => (prev ? { ...prev, structure: newStructure } : prev));
            
            console.log(`handleAiSort: Successfully sorted and saved ${columnId} structure`);
          } catch (dbError) {
            console.error("handleAiSort: Error saving structure to database:", dbError);
            toast.error(t('errors.savingError') || "Error saving sorted items. Please try again.");
            setIsSorting(false);
          }
        }, 0);
        
        return newContainers;
      });
      
    } catch (error) {
      console.error("handleAiSort: Error sorting items with AI:", error);
      toast.error(t('errors.aiSortingError') || "Error sorting items with AI. Please try again.");
    } finally {
      setIsSorting(false);
    }
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
          <div className="text-center">
            <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800">
              {t('structure.backToSermon')}
            </Link>
          </div>
        </div>
        
        {/* Export Button in Focus Mode */}
        {focusedColumn && (
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
        )}
        
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
                  <h2 className="text-xl font-semibold">{columnTitles["ambiguous"]}</h2>
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
                          <SortableItem key={item.id} item={item} containerId="ambiguous" onEdit={handleEdit} />
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
              />
            )}
          </div>
          <DragOverlay>
            {activeId &&
              (() => {
                const containerKey = Object.keys(containers).find((key) =>
                  containers[key].some((item) => item.id === activeId)
                );
                const activeItem = containerKey
                  ? containers[containerKey].find((item) => item.id === activeId)
                  : null;
                return activeItem ? (
                  <div className="p-4 bg-gray-300 rounded-md border border-gray-200 shadow-md">
                    {activeItem.content}
                  </div>
                ) : null;
              })()}
          </DragOverlay>
        </DndContext>
        {editingItem && (
          <EditThoughtModal
            initialText={editingItem.content}
            initialTags={editingItem.customTagNames?.map((tag) => tag.name) || []}
            allowedTags={allowedTags}
            onSave={handleSaveEdit}
            onClose={handleCloseEdit}
          />
        )}
      </div>
    </div>
  );
}
