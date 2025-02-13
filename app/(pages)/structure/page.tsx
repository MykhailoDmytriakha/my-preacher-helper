"use client";

import React, { useState, useEffect, Suspense } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSermonById } from "@services/sermon.service";
import Column from "@components/Column";
import SortableItem, { Item } from "@components/SortableItem";

// Mapping for column titles.
const columnTitles: Record<string, string> = {
  introduction: "Вступление",
  main: "Основная часть",
  conclusion: "Заключение",
  ambiguous: "Требует категоризации",
};

// Move the main component logic to a separate component
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

  // Fetch sermon data using sermonId and group thoughts by tags.
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
              } else {
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
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      setActiveId(null);
      return;
    }
    if (active.id === over.id) {
      setActiveId(null);
      return;
    }
    const activeContainer = event.active.data.current?.container;
    const overContainer =
      event.over?.data.current?.container ||
      (["introduction", "main", "conclusion", "ambiguous"].includes(String(over.id))
        ? String(over.id)
        : null);
    if (!activeContainer || !overContainer) {
      setActiveId(null);
      return;
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
        {/* Ambiguous Section */}
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
                <div className="min-h-[100px] p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
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

// Main export wraps the content in Suspense
export default function StructurePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StructurePageContent />
    </Suspense>
  );
}
