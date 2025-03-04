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
  onAiSort?: () => void; // Callback for AI sorting
  isLoading?: boolean; // Whether the AI sorting is in progress
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
  onAiSort,
  isLoading = false,
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
            <span>
              {title} <span className="ml-2 text-sm bg-white/20 px-2 py-0.5 rounded-full">{items.length}</span>
            </span>
            {showFocusButton && (
              <div className="flex space-x-2">
                {isFocusMode && (
                  <button
                    onClick={onAiSort}
                    disabled={isLoading}
                    className={`px-3 py-1 text-xs bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded hover:from-violet-700 hover:to-indigo-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1`}
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {t('structure.sorting')}
                      </>
                    ) : (
                      <>{t('structure.sortButton')}</>
                    )}
                  </button>
                )}
                <button
                  onClick={() => onToggleFocusMode?.(id)}
                  className="px-3 py-1 text-xs bg-white text-gray-800 rounded hover:bg-gray-100 transition-colors"
                >
                  {isFocusMode ? t('structure.normalMode') : t('structure.focusMode')}
                </button>
              </div>
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
