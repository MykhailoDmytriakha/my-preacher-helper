"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import SortableItem, { Item } from "./SortableItem";

interface ColumnProps {
  id: string;
  title: string;
  items: Item[];
}

export default function Column({ id, title, items }: ColumnProps) {
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
