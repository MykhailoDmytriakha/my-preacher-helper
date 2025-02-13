"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type Item = {
  id: string;
  content: string;
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
      className="mb-4 p-4 bg-white rounded-md border border-gray-200 shadow-md hover:shadow-xl"
    >
      {item.content}
    </div>
  );
}
