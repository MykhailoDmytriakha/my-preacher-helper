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
import Column from "@components/Column";
import SortableItem, { Item } from "@components/SortableItem";
import { Sermon, Thought } from "@/models/models";
import EditThoughtModal from "@components/EditThoughtModal";
import { getTags } from "@/services/tag.service";
import { getSermonById } from "@/services/sermon.service";
import { updateThought } from "@/services/thought.service";
import { updateStructure } from "@/services/structure.service";

const columnTitles: Record<string, string> = {
  introduction: "Вступление",
  main: "Основная часть",
  conclusion: "Заключение",
  ambiguous: "На рассмотрении",
};

function DummyDropZone({ container }: { container: string }) {
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
      Нет записей
    </div>
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
        console.log("fetchedSermon", fetchedSermon);
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
  
        // Create a lookup for all thought items
        const allThoughtItems: Record<string, Item> = {};
        fetchedSermon.thoughts.forEach((thought: any) => {
          const stableId = thought.id;
          const normalizedTags = thought.tags.map((tag: string) => tag.trim().toLowerCase());
          const customTagNames = normalizedTags.filter(
            (tag: string) => !["вступление", "основная часть", "заключение"].includes(tag)
          );
          const enrichedCustomTags = customTagNames.map((tagName: string) => {
            const tagInfo = allTags[tagName];
            if (!tagInfo) {
              console.warn(`Tag "${tagName}" not found in allTags, using default color`);
            }
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
  
        // Prepare arrays for each column
        let intro: Item[] = [];
        let main: Item[] = [];
        let concl: Item[] = [];
        let ambiguous: Item[] = [];
        const usedIds = new Set<string>();
  
        // If a structure exists, update the thought placements accordingly.
        if (fetchedSermon.structure) {
          let structureObj;
          try {
            structureObj =
              typeof fetchedSermon.structure === "string"
                ? JSON.parse(fetchedSermon.structure)
                : fetchedSermon.structure;
          } catch (err) {
            console.error("Error parsing sermon structure:", err);
          }
          if (structureObj) {
            if (Array.isArray(structureObj.introduction)) {
              structureObj.introduction.forEach((thoughtId: string) => {
                const item = allThoughtItems[thoughtId];
                if (item) {
                  // Override requiredTags based on structure
                  item.requiredTags = [columnTitles.introduction];
                  intro.push(item);
                  usedIds.add(thoughtId);
                }
              });
            }
            if (Array.isArray(structureObj.main)) {
              structureObj.main.forEach((thoughtId: string) => {
                const item = allThoughtItems[thoughtId];
                if (item) {
                  item.requiredTags = [columnTitles.main];
                  main.push(item);
                  usedIds.add(thoughtId);
                }
              });
            }
            if (Array.isArray(structureObj.conclusion)) {
              structureObj.conclusion.forEach((thoughtId: string) => {
                const item = allThoughtItems[thoughtId];
                if (item) {
                  item.requiredTags = [columnTitles.conclusion];
                  concl.push(item);
                  usedIds.add(thoughtId);
                }
              });
            }
            if (Array.isArray(structureObj.ambiguous)) {
              structureObj.ambiguous.forEach((thoughtId: string) => {
                const item = allThoughtItems[thoughtId];
                if (item) {
                  ambiguous.push(item);
                  usedIds.add(thoughtId);
                }
              });
            }
          }
        } else {
          // Fallback: assign thoughts based on their relevant tags
          Object.values(allThoughtItems).forEach((item) => {
            if (item.requiredTags.length === 1) {
              const tagLower = item.requiredTags[0].toLowerCase();
              if (tagLower === columnTitles.introduction.toLowerCase()) {
                intro.push(item);
                usedIds.add(item.id);
              } else if (tagLower === columnTitles.main.toLowerCase()) {
                main.push(item);
                usedIds.add(item.id);
              } else if (tagLower === columnTitles.conclusion.toLowerCase()) {
                concl.push(item);
                usedIds.add(item.id);
              } else {
                ambiguous.push(item);
                usedIds.add(item.id);
              }
            } else {
              ambiguous.push(item);
              usedIds.add(item.id);
            }
          });
        }

        console.log("intro", intro);
        console.log("main", main);
        console.log("conclusion", concl);
        console.log("ambiguous", ambiguous);
  
        // Add any thoughts not included in the structure to ambiguous.
        Object.keys(allThoughtItems).forEach((id) => {
          if (!usedIds.has(id)) {
            ambiguous.push(allThoughtItems[id]);
          }
        });
  
        setContainers({ introduction: intro, main, conclusion: concl, ambiguous });
        setIsAmbiguousVisible(ambiguous.length > 0);
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

  const handleDragEnd = async (event: DragEndEvent) => {
    console.log("handleDragEnd");
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
      console.log("drag over same container");
      const items = [...updatedContainers[activeContainer]];
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        updatedContainers[activeContainer] = arrayMove(items, oldIndex, newIndex);
        setContainers(updatedContainers);
        containersRef.current = updatedContainers;
      }
    } else {
      console.log("drag over different container");
      // For a different container, the state was already updated in handleDragOver.
      // Optionally, update the thought on the server.
      const movedItem = updatedContainers[overContainer].find((item) => item.id === active.id);
      if (movedItem) {
        const updatedItem: Thought = {
          ...sermon.thoughts.find((thought) => thought.id === movedItem.id)!,
          tags: [
            ...movedItem.requiredTags,
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
    console.log("previous structure", sermon.structure);
    console.log("newStructure", newStructure);
    await updateStructure(sermon.id, newStructure);
    setSermon((prev) => (prev ? { ...prev, structure: JSON.stringify(newStructure) } : prev));
    setActiveId(null);
    setOriginalContainer(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Загрузка данных проповеди...
      </div>
    );
  }

  if (!sermonId || !sermon) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Проповедь не найдена или не указан sermonId.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mb-4">
        <h1 className="text-4xl font-extrabold text-center mb-2 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
          Структура: {sermon.title}
        </h1>
        <div className="text-center">
          <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800">
            ← Назад к проповеди
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
          />
          <Column
            id="main"
            title={columnTitles["main"]}
            items={containers.main}
            headerColor={requiredTagColors.main}
            onEdit={handleEdit}
          />
          <Column
            id="conclusion"
            title={columnTitles["conclusion"]}
            items={containers.conclusion}
            headerColor={requiredTagColors.conclusion}
            onEdit={handleEdit}
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

export default function StructurePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StructurePageContent />
    </Suspense>
  );
}
