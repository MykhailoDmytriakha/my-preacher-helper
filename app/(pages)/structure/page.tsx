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
import { getSermonById, updateSermon } from "@services/sermon.service";
import { getTags } from "@services/setting.service";
import Column from "@components/Column";
import SortableItem, { Item } from "@components/SortableItem";
import { Sermon } from "@/models/models";
import EditThoughtModal from "@components/EditThoughtModal";

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
  const [requiredTagColors, setRequiredTagColors] = useState<{introduction?: string, main?: string, conclusion?: string}>({});
  // New states for editing a thought
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);

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

            // Set the header colors for main columns from required tags
            setRequiredTagColors({
              introduction: allTags["Вступление"]?.color,
              main: allTags["Основная часть"]?.color,
              conclusion: allTags["Заключение"]?.color,
            });

            // Set allowed tags for editing modal
            setAllowedTags(Object.values(allTags));

            let intro: Item[] = [];
            let main: Item[] = [];
            let concl: Item[] = [];
            let ambiguous: Item[] = [];
            // Group thoughts based on tags.
            fetchedSermon.thoughts.forEach((thought: any, index: number) => {
              // Ensure every thought has a stable identifier, fallback to a generated id if needed
              const stableId = thought.id || thought._id || `generated-${index}`;
              const customTagNames = thought.tags.filter((tag: string) =>
                !["Вступление", "Основная часть", "Заключение"].includes(tag)
              );
              // Enrich custom tags with color info.
              const enrichedCustomTags = customTagNames.map((tagName: string) => {
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
                    id: stableId,
                    content: thought.text,
                    customTagNames: enrichedCustomTags,
                  });
                } else if (relevantTags[0] === "Основная часть") {
                  main.push({
                    id: stableId,
                    content: thought.text,
                    customTagNames: enrichedCustomTags,
                  });
                } else if (relevantTags[0] === "Заключение") {
                  concl.push({
                    id: stableId,
                    content: thought.text,
                    customTagNames: enrichedCustomTags,
                  });
                }
              } else {
                ambiguous.push({
                  id: stableId,
                  content: thought.text,
                  customTagNames: enrichedCustomTags,
                });
              }
            });

            // If persisted structure exists, reorder the arrays accordingly
            if (fetchedSermon.structure) {
              try {
                const persistedOrder = JSON.parse(fetchedSermon.structure);
                const reorder = (arr: Item[], order: string[]): Item[] => {
                  const ordered = order.map(id => arr.find(item => item.id === id)).filter(item => item) as Item[];
                  const unordered = arr.filter(item => !order.includes(item.id));
                  return [...ordered, ...unordered];
                };

                if (persistedOrder.introduction) {
                  intro = reorder(intro, persistedOrder.introduction);
                }
                if (persistedOrder.main) {
                  main = reorder(main, persistedOrder.main);
                }
                if (persistedOrder.conclusion) {
                  concl = reorder(concl, persistedOrder.conclusion);
                }
                if (persistedOrder.ambiguous) {
                  ambiguous = reorder(ambiguous, persistedOrder.ambiguous);
                }
              } catch (error) {
                console.error('Error parsing persisted structure:', error);
              }
            }

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

  // New functions for editing
  const handleEdit = (item: Item) => {
    console.log('Edit clicked on item:', item.id);
    setEditingItem(item);
  };

  const handleSaveEdit = (updatedText: string, updatedTags: string[]) => {
    if (editingItem) {
      const updatedItem = {
        ...editingItem,
        content: updatedText,
        customTagNames: updatedTags.map(tagName => {
          const tagInfo = allowedTags.find(t => t.name === tagName);
          return { name: tagName, color: tagInfo ? tagInfo.color : '#4c51bf' };
        })
      };
      const newContainers = { ...containers };
      Object.keys(newContainers).forEach(key => {
        newContainers[key] = newContainers[key].map(item => item.id === updatedItem.id ? updatedItem : item);
      });
      setContainers(newContainers);

      if (sermon) {
        const newThoughts = sermon.thoughts.map((thought: any) => {
          const thoughtId = thought.id || thought._id;
          if (thoughtId === updatedItem.id) {
            return { ...thought, text: updatedText, tags: updatedTags };
          }
          return thought;
        });
        setSermon({ ...sermon, thoughts: newThoughts });
      }
      setEditingItem(null);
    }
  };

  const handleCloseEdit = () => {
    setEditingItem(null);
  };

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
    if ((event.over as any)?.element) {
      const element = (event.over as any).element;
      const dataContainer = element.getAttribute("data-container");
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

    if (sermon) {
      const newStructure = {
        introduction: updatedContainers.introduction.map(item => item.id),
        main: updatedContainers.main.map(item => item.id),
        conclusion: updatedContainers.conclusion.map(item => item.id),
        ambiguous: updatedContainers.ambiguous.map(item => item.id),
      };

      updateSermon({ ...sermon, structure: JSON.stringify(newStructure) })
        .then((updated: Sermon | null) => {
          if (updated) {
            setSermon(updated);
          }
        })
        .catch((err: any) => console.error('Error updating sermon structure:', err));
    }
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
                      <SortableItem key={item.id} item={item} containerId="ambiguous" onEdit={handleEdit} />
                    ))
                  )}
                </div>
              </SortableContext>
            )}
          </div>
        </div>
        {/* Main Columns */}
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
      {/* Render EditThoughtModal if an item is being edited */}
      {editingItem && (
        <EditThoughtModal
          initialText={editingItem.content}
          initialTags={editingItem.customTagNames ? editingItem.customTagNames.map(tag => tag.name) : []}
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
