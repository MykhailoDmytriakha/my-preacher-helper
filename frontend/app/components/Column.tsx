"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy } from "@dnd-kit/sortable";
import SortableItem from "./SortableItem";
import { Item, OutlinePoint } from "@/models/models";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface ColumnProps {
  id: string;
  title: string;
  items: Item[];
  headerColor?: string; // optional color for header and border
  onEdit?: (item: Item) => void;
  outlinePoints?: OutlinePoint[]; // New prop for outline points
  showFocusButton?: boolean; // Whether to show the focus button
  isFocusMode?: boolean; // Whether this column is in focus mode
  onToggleFocusMode?: (columnId: string) => void; // Callback for toggling focus mode
  className?: string; // Custom class name for the column container
}

export default function Column({ 
  id, 
  title, 
  items, 
  headerColor, 
  onEdit, 
  outlinePoints = [],
  showFocusButton = false,
  isFocusMode = false,
  onToggleFocusMode,
  className = ""
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  const { t } = useTranslation();
  
  // Always use vertical list strategy regardless of focus mode
  const sortingStrategy = verticalListSortingStrategy;
  
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="mb-2">
        <h2
          className={`text-xl font-semibold text-white p-3 rounded-t-md shadow ${
            !headerColor
              ? {
                  introduction: "bg-blue-600",
                  main: "bg-purple-600",
                  conclusion: "bg-green-600",
                  ambiguous: "bg-gray-600",
                }[id]
              : ""
          }`}
          style={headerColor ? { backgroundColor: headerColor } : {}}
        >
          <div className="flex justify-between items-center">
            <span>{title}</span>
            {showFocusButton && (
              <button
                onClick={() => onToggleFocusMode?.(id)}
                className="ml-2 px-3 py-1 text-xs bg-white text-gray-800 rounded hover:bg-gray-100 transition-colors"
              >
                {isFocusMode ? t('structure.normalMode') : t('structure.focusMode')}
              </button>
            )}
          </div>
          
          {/* Outline points display */}
          {outlinePoints && outlinePoints.length > 0 && (
            <div className="mt-2 text-sm font-normal text-white/90 border-t border-white/20 pt-2">
              <ul className="list-disc pl-4 space-y-1">
                {outlinePoints.map((point) => (
                  <li key={point.id}>{point.text}</li>
                ))}
              </ul>
            </div>
          )}
        </h2>
      </div>
      <SortableContext items={items} strategy={sortingStrategy}>
        <div
          ref={setNodeRef}
          className={`min-h-[300px] p-4 bg-white rounded-b-md border-2 shadow-lg transition-all ${
            !headerColor
              ? {
                  introduction: "border-blue-200",
                  main: "border-purple-200", 
                  conclusion: "border-green-200",
                  ambiguous: "border-gray-200",
                }[id]
              : ""
          } ${isOver ? "ring-2 ring-blue-400" : ""}`}
          style={headerColor ? { borderColor: headerColor } : {}}
        >
          {items.length === 0 ? (
            <div className="p-4 text-center text-gray-500 border-dashed border-2 border-blue-300">
              {t('structure.noEntries')}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <SortableItem key={item.id} item={item} containerId={id} onEdit={onEdit} />
              ))}
            </div>
          )}
          {/* Extra dummy element to always provide a drop target */}
          <div id="dummy-drop-zone" className="h-8" />
        </div>
      </SortableContext>
    </div>
  );
}
