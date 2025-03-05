"use client";

import React, { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import SortableItem from "./SortableItem";
import { Item, OutlinePoint } from "@/models/models";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import ExportButtons from "@components/ExportButtons";

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
  getExportContent?: () => Promise<string>; // Function to get export content
  sermonId?: string; // Add sermonId prop for export functionality
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
  className = "",
  getExportContent,
  sermonId
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Always use vertical list strategy regardless of focus mode
  const sortingStrategy = verticalListSortingStrategy;
  
  // Count assigned vs unassigned items
  const assignedItems = items.filter(item => item.outlinePointId).length;
  const unassignedItems = items.length - assignedItems;
  
  // Background color for header based on id or custom color
  const headerBgColor = !headerColor
    ? {
        introduction: "bg-blue-600",
        main: "bg-purple-600",
        conclusion: "bg-green-600",
        ambiguous: "bg-gray-600",
      }[id]
    : "";
  
  // Border color based on id or custom color
  const borderColor = !headerColor
    ? {
        introduction: "border-blue-200",
        main: "border-purple-200", 
        conclusion: "border-green-200",
        ambiguous: "border-gray-200",
      }[id]
    : "";

  // Render in focus mode (vertical layout with sidebar)
  if (isFocusMode) {
    return (
      <div className={`flex h-full gap-6 ${className}`}>
        {/* Left sidebar - fixed, non-scrollable, with more top spacing when scrolling */}
        <div className="w-72 flex-shrink-0 sticky top-16 self-start max-h-[calc(100vh-4rem)]">
          <div 
            className={`h-full rounded-lg shadow-lg flex flex-col ${headerBgColor}`}
            style={headerColor ? { backgroundColor: headerColor } : {}}
          >
            {/* Column title */}
            <div className="p-5 border-b border-white/20">
              <h2 className="text-2xl font-bold text-white">
                {title}
              </h2>
              
              <div className="flex items-center mt-2">
                <div 
                  className="flex overflow-hidden rounded-full text-xs font-medium relative select-none cursor-default hover:ring-2 hover:ring-white/30"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  title={t('structure.assignedUnassignedTooltip', {
                    assigned: assignedItems,
                    unassigned: unassignedItems
                  })}
                >
                  <span className="bg-green-500/70 px-2.5 py-1 text-white">
                    {assignedItems}
                  </span>
                  <span className="bg-white/30 px-2.5 py-1 text-white">
                    {unassignedItems}
                  </span>
                  {showTooltip && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded shadow-lg w-48 z-10 whitespace-normal">
                      {t('structure.assignedUnassignedTooltip', {
                        assigned: assignedItems,
                        unassigned: unassignedItems
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="p-5 border-b border-white/20">
              {showFocusButton && (
                <div className="space-y-3">
                  <button
                    onClick={() => onToggleFocusMode?.(id)}
                    className="w-full px-4 py-2.5 text-sm font-medium bg-white/90 text-gray-800 rounded-md hover:bg-white transition-colors shadow-sm flex items-center justify-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    {t('structure.normalMode')}
                  </button>
                  
                  <button
                    onClick={onAiSort}
                    disabled={isLoading}
                    className={`w-full px-4 py-2.5 text-sm font-medium bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-md hover:from-violet-700 hover:to-indigo-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border-2 border-indigo-300 hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50 focus:outline-none`}
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {t('structure.sorting')}
                      </>
                    ) : (
                      <>
                        <span className="flex-grow">{t('structure.sortButton')}</span>
                        <div className="relative flex items-center group">
                          <QuestionMarkCircleIcon className="w-4 h-4 text-white/70" />
                          <div className="absolute bottom-full left-1/3 -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded shadow-lg w-48 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-normal">
                            {t('structure.sortInfo', {
                              defaultValue: 'Sorting only processes unassigned thoughts, up to 25 at a time.'
                            })}
                          </div>
                        </div>                      
                      </>
                    )}
                  </button>
                  
                  {/* Add export buttons in focus mode */}
                  {getExportContent && sermonId && (
                    <div className="mt-3">
                      <div className="text-white/80 text-sm mb-1.5 font-medium">
                        {t('export.exportTo')}:
                      </div>
                      <ExportButtons 
                        sermonId={sermonId} 
                        getExportContent={getExportContent} 
                        orientation="horizontal"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Outline points */}
            {outlinePoints && outlinePoints.length > 0 && (
              <div className="p-5 flex-grow overflow-y-auto">
                <ul className="space-y-3 text-white/90">
                  {outlinePoints.map((point) => {
                    // Extract the number prefix if it exists (e.g., "1. Text" or "1) Text")
                    const match = point.text.match(/^(\d+)[.)\s]+\s*(.*)$/);
                    
                    if (match) {
                      // If we have a numbered point, preserve the numbering
                      const [_, number, text] = match;
                      return (
                        <li key={point.id} className="flex items-start">
                          <span className="text-sm font-medium mr-1.5">{number}.</span>
                          <span className="text-sm">{text}</span>
                        </li>
                      );
                    } else {
                      // For non-numbered points, keep the bullet style
                      return (
                        <li key={point.id} className="flex items-start">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/70 mt-1.5 mr-2 flex-shrink-0"></span>
                          <span className="text-sm">{point.text}</span>
                        </li>
                      );
                    }
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
        
        {/* Right side content area (scrollable) */}
        <SortableContext items={items} strategy={sortingStrategy}>
          <div
            ref={setNodeRef}
            className={`flex-grow min-h-[600px] overflow-y-auto p-6 bg-white rounded-lg border-2 shadow-lg transition-all ${borderColor} ${isOver ? "ring-2 ring-blue-400" : ""}`}
            style={headerColor ? { borderColor: headerColor } : {}}
          >
            {items.length === 0 ? (
              <div className="p-8 text-center text-gray-500 border-dashed border-2 border-blue-300 rounded-lg">
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
            <div id="dummy-drop-zone" className="h-12" />
          </div>
        </SortableContext>
      </div>
    );
  }
  
  // Render in normal mode (unchanged original layout)
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="mb-2">
        <h2
          className={`text-xl font-semibold text-white p-3 rounded-t-md shadow ${headerBgColor}`}
          style={headerColor ? { backgroundColor: headerColor } : {}}
        >
          <div className="flex justify-between items-center">
            <span className="flex items-center">
              {title} 
              <div 
                className="ml-2 flex overflow-hidden rounded-full text-xs relative select-none cursor-default hover:ring-2 hover:ring-white/30"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                title={t('structure.assignedUnassignedTooltip', {
                  assigned: assignedItems,
                  unassigned: unassignedItems
                })}
              >
                <span className="bg-green-500/40 px-2 py-0.5 text-white">
                  {assignedItems}
                </span>
                <span className="bg-white/20 px-2 py-0.5 text-white">
                  {unassignedItems}
                </span>
                {showTooltip && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded shadow-lg w-48 z-10 whitespace-normal">
                    {t('structure.assignedUnassignedTooltip', {
                      assigned: assignedItems,
                      unassigned: unassignedItems
                    })}
                  </div>
                )}
              </div>
            </span>
            {showFocusButton && (
              <div className="flex space-x-2">
                <button
                  onClick={() => onToggleFocusMode?.(id)}
                  className="px-3 py-1 text-xs bg-white text-gray-800 rounded hover:bg-gray-100 transition-colors"
                >
                  {t('structure.focusMode')}
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
          className={`min-h-[300px] p-4 bg-white rounded-b-md border-2 shadow-lg transition-all ${borderColor} ${isOver ? "ring-2 ring-blue-400" : ""}`}
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
