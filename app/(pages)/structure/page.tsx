"use client";

import React, { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSermonById } from "@services/sermon.service";

// Define the type for an item in the structure board.
type Item = {
  id: string;
  content: string;
};

// Mapping for column titles.
const columnTitles: Record<string, string> = {
  introduction: "Вступление",
  main: "Основная часть",
  conclusion: "Заключение",
  ambiguous: "Требует категоризации (Множественные теги)",
};

// SortableItem component using dnd‑kit hooks.
function SortableItem({
  item,
  containerId,
}: {
  item: Item;
  containerId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: item.id,
      data: { container: containerId },
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 250ms ease-in-out",
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        willChange: "transform",
        backfaceVisibility: "hidden",
      }}
      {...attributes}
      {...listeners}
      className="mb-4 p-4 bg-white rounded-md border border-gray-200 shadow-md hover:shadow-xl"
    >
      {item.content}
    </div>
  );
}

// Column component renders a droppable area with sortable items.
function Column({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: Item[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  return (
    <div className="flex flex-col">
      <div className="mb-2">
        <h2 className="text-xl font-semibold text-white p-3 rounded-t-md bg-blue-600 shadow">
          {title}
        </h2>
      </div>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`min-h-[300px] p-4 bg-white rounded-b-md border border-gray-200 shadow-lg transition-colors ${
            isOver ? "bg-blue-50" : ""
          }`}
        >
          {items.length === 0 ? (
            <div className="p-4 text-center text-gray-500 border-dashed border-2 border-blue-300">
              Drop here
            </div>
          ) : (
            items.map((item) => (
              <SortableItem key={item.id} item={item} containerId={id} />
            ))
          )}
          {/* Extra dummy element to always provide a drop target */}
          <div id="dummy-drop-zone" className="h-8" />
        </div>
      </SortableContext>
    </div>
  );
}

export default function StructureBoard() {
  const searchParams = useSearchParams();
  const sermonId = searchParams.get("sermonId");
  const [sermon, setSermon] = useState<any>(null);
  // Combined state for all containers (columns + ambiguous row)
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

  // Fetch sermon data using sermonId and group thoughts.
  useEffect(() => {
    async function fetchSermon() {
      if (sermonId) {
        try {
          const fetchedSermon = await getSermonById(sermonId);
          if (fetchedSermon) {
            setSermon(fetchedSermon);
            const intro: Item[] = [];
            const main: Item[] = [];
            const concl: Item[] = [];
            const ambiguous: Item[] = [];
            // Group thoughts based on tags.
            fetchedSermon.thoughts.forEach((thought: any, index: number) => {
              const relevantTags = thought.tags.filter((tag: string) =>
                ["Вступление", "Основная часть", "Заключение"].includes(tag)
              );
              if (relevantTags.length === 1) {
                if (relevantTags[0] === "Вступление") {
                  intro.push({
                    id: `intro-${index}-${Date.now()}`,
                    content: thought.text,
                  });
                } else if (relevantTags[0] === "Основная часть") {
                  main.push({
                    id: `main-${index}-${Date.now()}`,
                    content: thought.text,
                  });
                } else if (relevantTags[0] === "Заключение") {
                  concl.push({
                    id: `conclusion-${index}-${Date.now()}`,
                    content: thought.text,
                  });
                }
              } else if (relevantTags.length > 1) {
                ambiguous.push({
                  id: `ambiguous-${index}-${Date.now()}`,
                  content: thought.text,
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
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      return setActiveId(null);
    }

    if (active.id === over.id) {
      return setActiveId(null);
    }

    const activeContainer = event.active.data.current?.container;
    const overContainer =
      event.over?.data.current?.container ||
      (["introduction", "main", "conclusion", "ambiguous"].includes(over.id)
        ? over.id
        : null);

    if (!activeContainer || !overContainer) {
      return setActiveId(null);
    }

    if (activeContainer === overContainer) {
      const items = containers[activeContainer];
      const oldIndex = items.findIndex((item) => item.id === active.id);
      let newIndex = items.findIndex((item) => item.id === over.id);
      if (newIndex === -1) {
        newIndex = items.length;
      }
      setContainers({
        ...containers,
        [activeContainer]: arrayMove(items, oldIndex, newIndex),
      });
    } else {
      const sourceItems = [...containers[activeContainer]];
      const destItems = [...containers[overContainer]];
      const activeIndex = sourceItems.findIndex((item) => item.id === active.id);
      const [movedItem] = sourceItems.splice(activeIndex, 1);
      let overIndex = destItems.findIndex((item) => item.id === over.id);
      if (overIndex === -1) {
        overIndex = destItems.length;
      }
      destItems.splice(overIndex, 0, movedItem);
      setContainers({
        ...containers,
        [activeContainer]: sourceItems,
        [overContainer]: destItems,
      });
    }

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
          Структура проповеди: {sermon.title}
        </h1>
        <div className="text-center">
          <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800">
            ← Назад к проповеди
          </Link>
        </div>
      </div>
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Ambiguous section wrapped as a card */}
        <div className="mt-8">
          <div className="bg-white rounded-md shadow border border-gray-200">
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
                <div
                  className="min-h-[100px] p-4 grid grid-cols-1 md:grid-cols-3 gap-4"
                  data-droppable-id="ambiguous"
                >
                  {containers.ambiguous.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 border-dashed border-2 border-blue-300 col-span-full">
                      Нет записей с несколькими тегами
                    </div>
                  ) : (
                    containers.ambiguous.map((item) => (
                      <SortableItem key={item.id} item={item} containerId="ambiguous" />
                    ))
                  )}
                  <div id="dummy-drop-zone" className="h-8" />
                </div>
              </SortableContext>
            )}
          </div>
        </div>
        {/* Three main columns */}
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
