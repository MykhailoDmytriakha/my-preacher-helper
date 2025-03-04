"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getContrastColor } from "@utils/color";
import { EditIcon } from '@components/Icons';
import { Item } from "@/models/models";



interface SortableItemProps {
  item: Item;
  containerId: string;
  onEdit?: (item: Item) => void;
}

export default function SortableItem({ item, containerId, onEdit }: SortableItemProps) {
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
      className="relative group mb-4 p-4 bg-white rounded-md border border-gray-200 shadow-md hover:shadow-xl"
    >
      {/* Display outline point if available */}
      {item.outlinePoint && (
        <div className="mb-2">
          <span className="text-sm inline-block rounded-md px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800">
            {item.outlinePoint.section ? `${item.outlinePoint.section}: ${item.outlinePoint.text}` : item.outlinePoint.text}
          </span>
        </div>
      )}
      
      <div className="pr-20 whitespace-pre-wrap">
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
      {onEdit && (
        <button
          onPointerDown={(e) => { 
            e.stopPropagation(); 
            e.preventDefault(); 
            if(e.nativeEvent.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation(); 
          }}
          onMouseDown={(e) => { 
            e.stopPropagation(); 
            e.preventDefault(); 
            if(e.nativeEvent.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation(); 
          }}
          onClick={(e) => { 
            e.stopPropagation(); 
            e.preventDefault();
            onEdit(item);
          }}
          className="absolute top-2 right-2 focus:outline-none border-2 border-gray-200 rounded-full p-1 bg-white hover:shadow-md transition-opacity opacity-0 group-hover:opacity-100"
          title="Edit Thought"
        >
          <EditIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
        </button>
      )}
    </div>
  );
}
