"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getContrastColor } from "@utils/color";
import { EditIcon, TrashIcon } from '@components/Icons';
import { Item } from "@/models/models";
import CardContent from "./CardContent";
import { CheckIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

interface SortableItemProps {
  item: Item;
  containerId: string;
  onEdit?: (item: Item) => void;
  showDeleteIcon?: boolean;
  onDelete?: (itemId: string, containerId: string) => void;
  isDeleting?: boolean;
  isHighlighted?: boolean;
  highlightType?: 'assigned' | 'moved';
  onKeep?: (itemId: string, containerId: string) => void;
  onRevert?: (itemId: string, containerId: string) => void;
}

export default function SortableItem({ 
  item, 
  containerId, 
  onEdit, 
  showDeleteIcon = false, 
  onDelete, 
  isDeleting = false,
  isHighlighted = false,
  highlightType = 'moved',
  onKeep,
  onRevert
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: item.id,
      data: { container: containerId },
      disabled: isDeleting,
    });
  
  const { t } = useTranslation();

  const getHighlightStyles = () => {
    if (!isHighlighted) return {};
    
    return highlightType === 'assigned' 
      ? { borderColor: 'rgb(250, 204, 21)', backgroundColor: 'rgb(254, 249, 195)' }
      : { borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgb(219, 234, 254)' };
  };

  const getHighlightIcon = () => {
    if (!isHighlighted) return null;
    
    return highlightType === 'assigned' 
      ? <span className="ml-1 text-yellow-500">✨</span>
      : <span className="ml-1 text-blue-500">➡️</span>;
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 250ms ease-in-out",
    opacity: isDragging || isDeleting ? 0.5 : 1,
    ...getHighlightStyles()
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
      className={`relative group flex items-start space-x-2 mb-4 p-4 bg-white rounded-md ${
        isHighlighted ? `border-2 shadow-lg ${
          highlightType === 'assigned' ? 'border-yellow-400 shadow-yellow-200' : 'border-blue-400 shadow-blue-200'
        }` : 'border border-gray-200 shadow-md'
      } hover:shadow-xl ${isDeleting ? 'pointer-events-none' : ''}`}
    >
      <div className="flex-grow">
        <CardContent item={item} />
        {isHighlighted && (
          <div className={`mt-2 py-1 px-2 text-sm font-medium rounded-md inline-flex items-center bg-white ${
            highlightType === 'assigned' 
              ? 'text-yellow-800 border border-red-300'
              : 'text-blue-800 border border-red-300'
          }`}>
            {highlightType === 'assigned' 
              ? t('structure.aiAssigned', { defaultValue: 'AI assigned to outline point' })
              : t('structure.aiMoved', { defaultValue: 'AI moved this item' })}
            {getHighlightIcon()}
          </div>
        )}
      </div>
      
      <div className={`flex flex-col space-y-1 ${
        isHighlighted 
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100'
      } transition-opacity ${isDragging || isDeleting ? 'invisible' : ''}`}>
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
            title={t('structure.editThought', { defaultValue: 'Edit Thought' })}
            disabled={isDeleting}
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
            title={t('structure.removeFromStructure', { defaultValue: 'Remove from Structure' })}
            disabled={isDeleting}
          >
            <TrashIcon className="h-4 w-4 text-red-500 hover:text-red-700" />
          </button>
        )}
        
        {isHighlighted && onKeep && (
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
              onKeep(item.id, containerId);
            }}
            className="focus:outline-none border-2 border-green-200 rounded-full p-1 bg-white hover:bg-green-50 hover:shadow-md"
            title={t('structure.keepChanges', { defaultValue: 'Keep this change' })}
          >
            <CheckIcon className="h-5 w-5 text-green-500 hover:text-green-700" />
          </button>
        )}
        
        {isHighlighted && onRevert && (
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
              onRevert(item.id, containerId);
            }}
            className="focus:outline-none border-2 border-orange-200 rounded-full p-1 bg-white hover:bg-orange-50 hover:shadow-md"
            title={t('structure.revertChanges', { defaultValue: 'Revert to original' })}
          >
            <ArrowUturnLeftIcon className="h-5 w-5 text-orange-500 hover:text-orange-700" />
          </button>
        )}
      </div>
    </div>
  );
}
