"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EditIcon, TrashIcon } from '@components/Icons';
import { ArrowTopRightOnSquareIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
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
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  disabled?: boolean; // Whether the item is disabled for drag and drop
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
  onRevert,
  activeId,
  onMoveToAmbiguous,
  disabled = false
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: item.id,
      data: { container: containerId },
      disabled: isDeleting || disabled,
    });
  
  const { t } = useTranslation();

  // Determine if this item is actively being dragged
  const isActiveItem = activeId === item.id;

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

  // Use a more aggressive approach: completely disable transform and hide the item when it's being dragged
  const style = {
    transform: isActiveItem ? "none" : CSS.Transform.toString(transform),
    transition: isActiveItem ? "none" : (transition || "transform 250ms ease-in-out"),
    opacity: isActiveItem ? 0 : (isDragging || isDeleting ? 0.5 : 1),
    ...getHighlightStyles()
  };

  // Icon color classes based on section color palette (project theme)
  const sectionIconColorClasses = (() => {
    if (containerId === 'introduction') {
      return `${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`;
    }
    if (containerId === 'main') {
      return `${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`;
    }
    if (containerId === 'conclusion') {
      return `${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`;
    }
    return 'text-gray-600 dark:text-gray-300';
  })();

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
      className={`relative group flex items-start space-x-2 mb-6 p-5 bg-white dark:bg-gray-800 rounded-md ${
        isHighlighted ? `border-2 shadow-lg ${
          highlightType === 'assigned' ? 'border-yellow-400 shadow-yellow-200' : 'border-blue-400 shadow-blue-200'
        }` : 'border border-gray-200 dark:border-gray-700 shadow-md'
      } hover:shadow-xl ${isDeleting ? 'pointer-events-none' : ''} ${disabled ? 'opacity-75' : ''}`}
    >
      <div className="flex-grow">
        {disabled && (
          <div className="flex items-center mb-2 text-gray-500 dark:text-gray-400">
            <LockClosedIcon className="h-4 w-4 mr-1" />
            <span className="text-xs font-medium">{t('structure.reviewed', { defaultValue: 'Reviewed' })}</span>
          </div>
        )}
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
        {/* Move to ambiguous (unassigned) button - hide in ambiguous container */}
        {onMoveToAmbiguous && containerId !== 'ambiguous' && (
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
              onMoveToAmbiguous(item.id, containerId);
            }}
            className="focus:outline-none rounded-full p-1.5 border border-transparent bg-white dark:bg-gray-700 shadow-sm hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
            title={t('structure.moveToUnderConsideration', { defaultValue: 'Move to Under Consideration' })}
            disabled={isDeleting}
          >
            <ArrowTopRightOnSquareIcon className={`h-5 w-5 ${sectionIconColorClasses}`} />
          </button>
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
            className="focus:outline-none rounded-full p-1.5 border border-transparent bg-white dark:bg-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm hover:shadow-md"
            title={t('structure.editThought', { defaultValue: 'Edit Thought' })}
            disabled={isDeleting}
          >
            <EditIcon className={`h-5 w-5 ${sectionIconColorClasses} hover:opacity-90`} />
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
            className="focus:outline-none rounded-full p-1.5 border border-transparent bg-white dark:bg-gray-700 hover:border-gray-200 dark:hover:border-gray-600 shadow-sm hover:shadow-md"
            title={t('structure.removeFromStructure', { defaultValue: 'Remove from Structure' })}
            disabled={isDeleting}
          >
            <TrashIcon className="h-5 w-5 text-red-500 hover:text-red-600" />
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
            className="focus:outline-none border-2 border-green-200 dark:border-green-700 rounded-full p-1 bg-white dark:bg-gray-700 hover:bg-green-50 dark:hover:bg-green-900/30 hover:shadow-md"
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
            className="focus:outline-none border-2 border-orange-200 dark:border-orange-700 rounded-full p-1 bg-white dark:bg-gray-700 hover:bg-orange-50 dark:hover:bg-orange-900/30 hover:shadow-md"
            title={t('structure.revertChanges', { defaultValue: 'Revert to original' })}
          >
            <ArrowUturnLeftIcon className="h-5 w-5 text-orange-500 hover:text-orange-700" />
          </button>
        )}
      </div>
    </div>
  );
}
