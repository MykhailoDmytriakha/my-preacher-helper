"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getContrastColor } from "@utils/color";
export type TagInfo = {
  name: string;
  color: string;
};

export type Item = {
  id: string;
  content: string;
  customTagNames?: TagInfo[];
};

interface SortableItemProps {
  item: Item;
  containerId: string;
}

export default function SortableItem({ item, containerId }: SortableItemProps) {
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
      className="relative mb-4 p-4 bg-white rounded-md border border-gray-200 shadow-md hover:shadow-xl"
    >
      <div className="pr-20">
        {item.content}
      </div>
      
      {item.customTagNames && item.customTagNames.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end mt-2">
          {item.customTagNames.map((tag) => (
            <span 
              key={tag.name}
              style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
              className="text-xs text-white px-2 py-1 rounded-full"
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
