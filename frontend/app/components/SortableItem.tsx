"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getContrastColor } from "@utils/color";
import { EditIcon, TrashIcon } from '@components/Icons';
import { Item } from "@/models/models";
import CardContent from "./CardContent";



interface SortableItemProps {
  item: Item;
  containerId: string;
  onEdit?: (item: Item) => void;
  showDeleteIcon?: boolean;
  onDelete?: (itemId: string, containerId: string) => void;
}

export default function SortableItem({ item, containerId, onEdit, showDeleteIcon = false, onDelete }: SortableItemProps) {
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
      className="relative group flex items-start space-x-2 mb-4 p-4 bg-white rounded-md border border-gray-200 shadow-md hover:shadow-xl"
    >
      <div className="flex-grow">
        <CardContent item={item} />
      </div>
      
      <div className="flex flex-col space-y-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            className="focus:outline-none border-2 border-gray-200 rounded-full p-1 bg-white hover:shadow-md"
            title="Edit Thought"
          >
            <EditIcon className="h-6 w-6 text-gray-500 hover:text-gray-700" />
          </button>
        )}

        {showDeleteIcon && onDelete && (
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
              onDelete(item.id, containerId); 
            }}
            className="focus:outline-none border-2 border-gray-200 rounded-full p-1 bg-white hover:shadow-md"
            title="Remove from Structure"
          >
            <TrashIcon className="h-4 w-4 text-red-500 hover:text-red-700" />
          </button>
        )}
      </div>
    </div>
  );
}
