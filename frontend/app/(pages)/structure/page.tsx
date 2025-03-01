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
import { getTags } from "@/services/tag.service";
import { getSermonById } from "@/services/sermon.service";
import { updateThought } from "@/services/thought.service";
import { updateStructure } from "@/services/structure.service";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { getSermonOutline } from "@/services/outline.service";

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
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeContainer = active.data.current?.container;
    let overContainer = over.data.current?.container;

    if (over.id === "dummy-drop-zone") {
      overContainer = "ambiguous";
    } else if (!overContainer) {
      overContainer = String(over.id);
    }

    if (
      !activeContainer ||
      !overContainer ||
      activeContainer === overContainer ||
      !["introduction", "main", "conclusion", "ambiguous"].includes(overContainer)
    )
      return;

    setContainers((prev) => {
      const sourceItems = [...prev[activeContainer]];
      const destItems = [...prev[overContainer]];
      const activeIndex = sourceItems.findIndex((item) => item.id === active.id);

      if (activeIndex === -1) return prev;

      const [movedItem] = sourceItems.splice(activeIndex, 1);
      const requiredTags =
        overContainer === "ambiguous" ? [] : [columnTitles[overContainer]];

      destItems.push({ ...movedItem, requiredTags });

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
    if (!over || !sermon) {
      setActiveId(null);
      setOriginalContainer(null);
      return;
    }

    const activeContainer = originalContainer; // Use the original container
    let overContainer = over.data.current?.container;

    if (over.id === "dummy-drop-zone") {
      overContainer = "ambiguous";
    } else if (!overContainer) {
      overContainer = String(over.id);
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
      const movedItem = updatedContainers[overContainer].find((item) => item.id === active.id);
      if (movedItem) {
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
        } catch (error) {
          console.error("Error updating thought:", error);
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
    const changesDetected = isStructureChanged(sermon.structure || {}, newStructure);
    if (changesDetected) {
      console.log("changes detected, updating structure");
      await updateStructure(sermon.id, newStructure);
      setSermon((prev) => (prev ? { ...prev, structure: newStructure} : prev));
    }
    setActiveId(null);
    setOriginalContainer(null);
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
      <DndContext
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
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
              <SortableContext items={containers.ambiguous} strategy={rectSortingStrategy}>
                <div className="min-h-[100px] p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-8">
          <Column
            id="introduction"
            title={columnTitles["introduction"]}
            items={containers.introduction}
            headerColor={requiredTagColors.introduction}
            onEdit={handleEdit}
            outlinePoints={outlinePoints.introduction}
          />
          <Column
            id="main"
            title={columnTitles["main"]}
            items={containers.main}
            headerColor={requiredTagColors.main}
            onEdit={handleEdit}
            outlinePoints={outlinePoints.main}
          />
          <Column
            id="conclusion"
            title={columnTitles["conclusion"]}
            items={containers.conclusion}
            headerColor={requiredTagColors.conclusion}
            onEdit={handleEdit}
            outlinePoints={outlinePoints.conclusion}
          />
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
  );
}
