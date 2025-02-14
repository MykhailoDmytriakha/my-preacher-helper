"use client";

import React, { useState, useEffect, Suspense } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  DragEndEvent,
  DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSermonById } from "@services/sermon.service";
import { getTags } from "@services/setting.service";
import Column from "@components/Column";
import SortableItem, { Item } from "@components/SortableItem";

// Mapping for column titles.
const columnTitles: Record<string, string> = {
  introduction: "Вступление",
  main: "Основная часть",
  conclusion: "Заключение",
  ambiguous: "На рассмотрении",
};

// Новый компонент для пустой droppable зоны ambiguous.
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
  const sermonId = searchParams.get("sermonId");
  const [sermon, setSermon] = useState<any>(null);
  // Combined state for all containers (columns plus ambiguous)
  const [containers, setContainers] = useState<Record<string, Item[]>>({
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // State for toggling the ambiguous section.
  const [isAmbiguousVisible, setIsAmbiguousVisible] = useState(true);

  // Fetch sermon data and group thoughts by tags.
  useEffect(() => {
    async function fetchSermon() {
      if (sermonId) {
        try {
          const fetchedSermon = await getSermonById(sermonId);
          if (fetchedSermon) {
            setSermon(fetchedSermon);
            const tagsData = await getTags(fetchedSermon.userId);
            const allTags: Record<string, { name: string; color: string }> = {};
            (tagsData.requiredTags || []).forEach((tag: any) => {
              allTags[tag.name] = tag;
            });
            (tagsData.customTags || []).forEach((tag: any) => {
              allTags[tag.name] = tag;
            });

            const intro: Item[] = [];
            const main: Item[] = [];
            const concl: Item[] = [];
            const ambiguous: Item[] = [];
            // Group thoughts based on tags.
            fetchedSermon.thoughts.forEach((thought: any, index: number) => {
              const customTagNames: string[] = thought.tags.filter(
                (tag: string) =>
                  !["Вступление", "Основная часть", "Заключение"].includes(tag)
              );
              // Enrich custom tags with color info.
              const enrichedCustomTags = customTagNames.map((tagName) => {
                return allTags[tagName]
                  ? { name: tagName, color: allTags[tagName].color }
                  : { name: tagName, color: "#4c51bf" };
              });
              const relevantTags = thought.tags.filter((tag: string) =>
                ["Вступление", "Основная часть", "Заключение"].includes(tag)
              );
              if (relevantTags.length === 1) {
                if (relevantTags[0] === "Вступление") {
                  intro.push({
                    id: `intro-${index}-${Date.now()}`,
                    content: thought.text,
                    customTagNames: enrichedCustomTags,
                  });
                } else if (relevantTags[0] === "Основная часть") {
                  main.push({
                    id: `main-${index}-${Date.now()}`,
                    content: thought.text,
                    customTagNames: enrichedCustomTags,
                  });
                } else if (relevantTags[0] === "Заключение") {
                  concl.push({
                    id: `conclusion-${index}-${Date.now()}`,
                    content: thought.text,
                    customTagNames: enrichedCustomTags,
                  });
                }
              } else {
                ambiguous.push({
                  id: `ambiguous-${index}-${Date.now()}`,
                  content: thought.text,
                  customTagNames: enrichedCustomTags,
                });
              }
            });
            setContainers({
              introduction: intro,
              main: main,
              conclusion: concl,
              ambiguous: ambiguous,
            });
          }
        } catch (error) {
          console.error("Error fetching sermon:", error);
        }
      }
      setLoading(false);
    }
    fetchSermon();
  }, [sermonId]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      setActiveId(null);
      setActiveId(null);
      return;
    }
    if (active.id === over.id) {
      setActiveId(null);
      return;
    }

    const activeContainer = event.active.data.current?.container;
    let overContainer = event.over?.data.current?.container;

    // Дополнительное логирование: выводим boundingClientRect элемента over.
    if (event.over?.element) {
      const dataContainer = event.over.element.getAttribute("data-container");
      if (!overContainer && dataContainer === "ambiguous") {
        overContainer = "ambiguous";
      } else if (!overContainer) {
        const overId = String(over.id);
        if (overId === "dummy-drop-zone") {
          overContainer = "ambiguous";
        } else if (["introduction", "main", "conclusion", "ambiguous"].includes(overId)) {
          overContainer = overId;
        }
      }
    }

    if (!activeContainer || !overContainer) {
      setActiveId(null);
      return;
    }

    let updatedContainers = { ...containers };

    if (activeContainer === overContainer) {
      const items = updatedContainers[activeContainer];
      const oldIndex = items.findIndex((item) => item.id === active.id);
      let newIndex = items.findIndex((item) => item.id === over.id);
      updatedContainers[activeContainer] = arrayMove(items, oldIndex, newIndex);
    } else {
      const allowedTransitions = ["introduction", "main", "conclusion", "ambiguous"];
      if (!allowedTransitions.includes(overContainer)) {
        console.error("Invalid target container:", overContainer);
        return;
      }

      const sourceItems = [...updatedContainers[activeContainer]];
      const destItems = [...updatedContainers[overContainer]];

      const activeIndex = sourceItems.findIndex((item) => item.id === active.id);

      const [movedItem] = sourceItems.splice(activeIndex, 1);
      let overIndex = destItems.findIndex((item) => item.id === over.id);
      if (overIndex === -1) {
        overIndex = destItems.length;
      }
      destItems.splice(overIndex, 0, movedItem);

      updatedContainers[activeContainer] = sourceItems;
      updatedContainers[overContainer] = destItems;
    }

    setContainers(updatedContainers);
    setActiveId(null);
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
        onDragEnd={handleDragEnd}
      >
        {/* Ambiguous Section */}
        <div className="mt-8">
          <div className={`bg-white rounded-md shadow border ${
            containers.ambiguous.length > 0 ? "border-red-500" : "border-gray-200"
          }`}>
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
              <SortableContext items={containers.ambiguous} strategy={verticalListSortingStrategy}>
                <div className="min-h-[100px] p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {containers.ambiguous.length === 0 ? (
                    <DummyDropZone container="ambiguous" />
                  ) : (
                    containers.ambiguous.map((item) => (
                      <SortableItem key={item.id} item={item} containerId="ambiguous" />
                    ))
                  )}
                </div>
              </SortableContext>
            )}
          </div>
        </div>
        {/* Main Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-8">
          <Column id="introduction" title={columnTitles["introduction"]} items={containers.introduction} />
          <Column id="main" title={columnTitles["main"]} items={containers.main} />
          <Column id="conclusion" title={columnTitles["conclusion"]} items={containers.conclusion} />
        </div>
        <DragOverlay>
          {activeId &&
            (() => {
              const containerKey = Object.keys(containers).find((key) =>
                containers[key].some((item) => item.id === activeId)
              );
              if (!containerKey) return null;
              const activeItem = containers[containerKey].find((item) => item.id === activeId);
              if (!activeItem) return null;
              return (
                <div className="p-4 bg-gray-300 rounded-md border border-gray-200 shadow-md">
                  {activeItem.content}
                </div>
              );
            })()}
        </DragOverlay>
      </DndContext>
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
