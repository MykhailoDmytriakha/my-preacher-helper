"use client";

import React, { useState, useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { updateSermonOutline, getSermonOutline, generateOutlinePointsForSection } from "@/services/outline.service";
import SortableItem from "./SortableItem";
import { Item, OutlinePoint, Outline } from "@/models/models";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { QuestionMarkCircleIcon, PlusIcon, PencilIcon, CheckIcon, XMarkIcon, TrashIcon, Bars3Icon, ArrowUturnLeftIcon, SparklesIcon } from '@heroicons/react/24/outline';
import ExportButtons from "@components/ExportButtons";
import { toast } from 'sonner';

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
  getExportContent?: (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => Promise<string>; // Function to get export content
  sermonId?: string; // Add sermonId prop for export functionality
  onAddThought?: (sectionId: string) => void; // New callback for adding a thought to this section
  onOutlineUpdate?: (updatedOutline: Outline) => void; // Add callback for outline updates propagating back to parent
  thoughtsPerOutlinePoint?: Record<string, number>; // Add this prop for non-focus mode display
  // New props for AI sort with interactive confirmation
  isDiffModeActive?: boolean;
  highlightedItems?: Record<string, { type: 'assigned' | 'moved' }>;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  onKeepAll?: (columnId: string) => void;
  onRevertAll?: (columnId: string) => void;
  activeId?: string | null; // Add activeId prop for proper drag state detection
}

// Define SectionType based on Column ID mapping
type SectionType = 'introduction' | 'mainPart' | 'conclusion';

// Helper to map column ID to SectionType used in Outline model
const mapColumnIdToSectionType = (columnId: string): SectionType | null => {
  switch (columnId) {
    case 'introduction': return 'introduction';
    case 'main': return 'mainPart';
    case 'conclusion': return 'conclusion';
    default: return null; // Handle cases like 'ambiguous' or others
  }
};

// Component for rendering outline point placeholder with thoughts
const OutlinePointPlaceholder: React.FC<{
  point: OutlinePoint;
  items: Item[];
  containerId: string;
  onEdit?: (item: Item) => void;
  isHighlighted: (itemId: string) => boolean;
  getHighlightType: (itemId: string) => 'assigned' | 'moved' | undefined;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  headerColor?: string;
  t: (key: string, options?: any) => string;
  activeId?: string | null;
}> = ({ 
  point, 
  items, 
  containerId, 
  onEdit, 
  isHighlighted, 
  getHighlightType, 
  onKeepItem, 
  onRevertItem, 
  headerColor,
  t,
  activeId
}) => {
  const { setNodeRef, isOver } = useDroppable({ 
    id: `outline-point-${point.id}`, 
    data: { container: containerId, outlinePointId: point.id } 
  });

  const pointItems = items.filter(item => item.outlinePointId === point.id);
  const hasItems = pointItems.length > 0;

  // Color scheme based on section
  const getPlaceholderColors = () => {
    if (headerColor) {
      return {
        border: `border-2 border-opacity-30`,
        bg: 'bg-gray-50 dark:bg-gray-800',
        header: 'bg-gray-100 dark:bg-gray-700',
        headerText: 'text-gray-700 dark:text-gray-200'
      };
    }

    switch (containerId) {
      case 'introduction':
        return {
          border: 'border-2 border-blue-200 dark:border-blue-700',
          bg: 'bg-blue-50 dark:bg-blue-900/20',
          header: 'bg-blue-100 dark:bg-blue-800/30',
          headerText: 'text-blue-700 dark:text-blue-200'
        };
      case 'main':
        return {
          border: 'border-2 border-purple-200 dark:border-purple-700',
          bg: 'bg-purple-50 dark:bg-purple-900/20',
          header: 'bg-purple-100 dark:bg-purple-800/30',
          headerText: 'text-purple-700 dark:text-purple-200'
        };
      case 'conclusion':
        return {
          border: 'border-2 border-green-200 dark:border-green-700',
          bg: 'bg-green-50 dark:bg-green-900/20',
          header: 'bg-green-100 dark:bg-green-800/30',
          headerText: 'text-green-700 dark:text-green-200'
        };
      default:
        return {
          border: 'border-2 border-gray-200 dark:border-gray-700',
          bg: 'bg-gray-50 dark:bg-gray-800',
          header: 'bg-gray-100 dark:bg-gray-700',
          headerText: 'text-gray-700 dark:text-gray-200'
        };
    }
  };

  const colors = getPlaceholderColors();

  return (
    <div 
      className={`${colors.border} ${colors.bg} rounded-lg mb-4 transition-all duration-200 ${
        isOver ? 'ring-2 ring-blue-400 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'
      }`}
      style={headerColor ? { borderColor: headerColor } : {}}
    >
      {/* Outline point header */}
      <div 
        className={`px-4 py-2 rounded-t-lg border-b border-opacity-20 dark:border-opacity-30 ${headerColor ? 'bg-gray-100 dark:bg-gray-700' : colors.header}`}
        style={headerColor ? { backgroundColor: `${headerColor}20` } : {}}
      >
        <div className="flex items-center justify-between">
          <h4 className={`font-medium text-sm ${headerColor ? 'text-gray-800 dark:text-gray-200' : colors.headerText}`}>
            {point.text}
          </h4>
          <span className={`text-xs ${headerColor ? 'text-gray-600 dark:text-gray-400' : colors.headerText} opacity-70`}>
            {pointItems.length} {pointItems.length === 1 ? t('structure.thought') : t('structure.thoughts')}
          </span>
        </div>
      </div>

      {/* Drop zone for thoughts */}
      <div 
        ref={setNodeRef}
        className={`min-h-[80px] p-4 transition-all ${
          isOver ? 'bg-blue-100 ring-2 ring-blue-300' : ''
        }`}
      >
        {!hasItems ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded">
            {t('structure.dropThoughtsHere')}
          </div>
        ) : (
          <div className="space-y-4">
            {pointItems.map((item) => (
              <SortableItem 
                key={item.id} 
                item={item} 
                containerId={containerId} 
                onEdit={onEdit}
                isHighlighted={isHighlighted(item.id)}
                highlightType={getHighlightType(item.id)}
                onKeep={onKeepItem}
                onRevert={onRevertItem}
                activeId={activeId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Component for rendering unassigned thoughts drop target
const UnassignedThoughtsDropTarget: React.FC<{
  items: Item[];
  containerId: string;
  onEdit?: (item: Item) => void;
  isHighlighted: (itemId: string) => boolean;
  getHighlightType: (itemId: string) => 'assigned' | 'moved' | undefined;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  t: (key: string, options?: any) => string;
  activeId?: string | null;
}> = ({ 
  items, 
  containerId, 
  onEdit, 
  isHighlighted, 
  getHighlightType, 
  onKeepItem, 
  onRevertItem, 
  t,
  activeId 
}) => {
  const { setNodeRef, isOver } = useDroppable({ 
    id: `unassigned-${containerId}`, 
    data: { container: containerId, outlinePointId: null } // null means unassigned
  });

  return (
    <div 
      ref={setNodeRef}
      className={`min-h-[80px] p-4 transition-all rounded-lg ${
        isOver ? 'bg-blue-100 ring-2 ring-blue-300' : 'bg-gray-50 dark:bg-gray-800'
      }`}
    >
      {items.length === 0 ? (
        <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded">
          {t('structure.dropToUnassign', { defaultValue: 'Drop thoughts here to unassign them from outline points' })}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <SortableItem 
              key={item.id} 
              item={item} 
              containerId={containerId} 
              onEdit={onEdit}
              isHighlighted={isHighlighted(item.id)}
              highlightType={getHighlightType(item.id)}
              onKeep={onKeepItem}
              onRevert={onRevertItem}
              activeId={activeId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function Column({ 
  id, 
  title, 
  items, 
  headerColor, 
  onEdit, 
  outlinePoints: initialOutlinePoints = [], // Rename prop for clarity
  showFocusButton = false,
  isFocusMode = false,
  onToggleFocusMode,
  onAiSort,
  isLoading = false,
  className = "",
  getExportContent,
  sermonId,
  onAddThought,
  onOutlineUpdate, // Destructure the new callback
  thoughtsPerOutlinePoint = {}, // Destructure the new prop with a default value
  // New props for AI sort with interactive confirmation
  isDiffModeActive = false,
  highlightedItems = {},
  onKeepItem,
  onRevertItem,
  onKeepAll,
  onRevertAll,
  activeId
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  const { t } = useTranslation();
  const [outlinePoints, setOutlinePoints] = useState<OutlinePoint[]>(initialOutlinePoints);
  
  // Basic state for outline points UI
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [addingNewPoint, setAddingNewPoint] = useState<boolean>(false);
  const [newPointText, setNewPointText] = useState<string>('');
  const [showTooltip, setShowTooltip] = useState<boolean>(false);
  const [isGeneratingOutlinePoints, setIsGeneratingOutlinePoints] = useState<boolean>(false);
  
  // Refs for focus management
  const editInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  
  // Calculate counts for assigned and unassigned items
  const assignedItems = items.filter(item => item.outlinePointId).length;
  const unassignedItems = items.length - assignedItems;
  
  // Calculate if this column has any highlighted items
  const hasHighlightedItems = items.some(item => item.id in highlightedItems);
  
  // --- State for Outline Point Editing (only relevant in focus mode) ---
  const [localOutlinePoints, setLocalOutlinePoints] = useState<OutlinePoint[]>(initialOutlinePoints);
  const [savingOutline, setSavingOutline] = useState<boolean>(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update local state if the prop changes (e.g., after initial load or external update)
  useEffect(() => {
    setLocalOutlinePoints(initialOutlinePoints);
  }, [initialOutlinePoints]);

  // Focus input when starting to add/edit
  useEffect(() => {
    if (addingNewPoint && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingNewPoint]);

  useEffect(() => {
    if (editingPointId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingPointId]);

  // Debounced save function - упрощенная версия по аналогии с SermonOutline.tsx
  const triggerSaveOutline = (updatedPoints: OutlinePoint[]) => {
    if (!sermonId || !isFocusMode) return; // Only save in focus mode with sermonId

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setSavingOutline(true); // Indicate saving starts

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // Determine the key to use in the outline (mainPart -> main)
        const sectionType = mapColumnIdToSectionType(id);
        if (!sectionType) {
          console.error("Cannot save outline: Invalid section ID", id);
          return;
        }

        // First fetch the current outline to avoid overwriting other sections
        const currentOutline = await getSermonOutline(sermonId);
        
        // Create a merged outline that preserves other sections
        const outlineToSave: Outline = {
          introduction: sectionType === 'introduction' ? updatedPoints : (currentOutline?.introduction || []),
          main: sectionType === 'mainPart' ? updatedPoints : (currentOutline?.main || []),
          conclusion: sectionType === 'conclusion' ? updatedPoints : (currentOutline?.conclusion || [])
        };

        // Call the API to update the outline with the complete data
        await updateSermonOutline(sermonId, outlineToSave);

        // Propagate the change UP using the callback
        onOutlineUpdate?.(outlineToSave);

        toast.success(t('structure.outlineSavedSuccess', { defaultValue: 'Outline saved' }));
      } catch (error) {
        console.error("Error saving sermon outline:", error);
        toast.error(t('errors.saveOutlineError', { defaultValue: 'Failed to save outline' }));
      } finally {
        setSavingOutline(false); // Indicate saving finished
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
      }
    }, 200); // Используем более короткую задержку для дебаунса
  };

  const handleAddPoint = () => {
    if (!newPointText.trim()) {
      setAddingNewPoint(false); // Close if empty
      return;
    }
    const newPoint: OutlinePoint = {
      id: `new-${Date.now().toString()}`, // Temporary ID
      text: newPointText.trim(),
    };
    const updatedPoints = [...localOutlinePoints, newPoint];
    setLocalOutlinePoints(updatedPoints);
    setNewPointText("");
    setAddingNewPoint(false);
    triggerSaveOutline(updatedPoints);
  };
  
  const handleStartEdit = (point: OutlinePoint) => {
    setEditingPointId(point.id);
    setEditingText(point.text);
    setAddingNewPoint(false); // Ensure add mode is off
  };

  const handleCancelEdit = () => {
    setEditingPointId(null);
    setEditingText("");
  };

  const handleSaveEdit = () => {
    if (!editingPointId || !editingText.trim()) {
      handleCancelEdit(); // Cancel if text is empty
      return;
    }
    const updatedPoints = localOutlinePoints.map(p => 
      p.id === editingPointId ? { ...p, text: editingText.trim() } : p
    );
    setLocalOutlinePoints(updatedPoints);
    handleCancelEdit(); // Reset editing state
    triggerSaveOutline(updatedPoints);
  };

  const handleDeletePoint = (pointId: string) => {
    // Find the point to get its text for the confirmation message
    const pointToDelete = localOutlinePoints.find(p => p.id === pointId);
    const pointText = pointToDelete ? pointToDelete.text : ''; // Get text or empty string

    // Construct the confirmation message using translation and interpolation
    const confirmMessage = t('structure.deletePointConfirm', {
      defaultValue: `Are you sure you want to delete this outline point: "${pointText}"?`,
      text: pointText // Pass text for interpolation if the key supports it
    });

    if (window.confirm(confirmMessage)) {
      const updatedPoints = localOutlinePoints.filter(p => p.id !== pointId);
      setLocalOutlinePoints(updatedPoints);
      if (editingPointId === pointId) handleCancelEdit(); // Cancel edit if deleting the item being edited
      triggerSaveOutline(updatedPoints);
    }
  };
  
  // Оптимизированная версия handleDragEnd для @hello-pangea/dnd
  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    // Dropped outside the list or same position
    if (!destination || (destination.index === source.index)) {
      return;
    }

    // Create a shallow copy of the outline points array
    const updatedPoints = Array.from(localOutlinePoints);
    const [removed] = updatedPoints.splice(source.index, 1);
    updatedPoints.splice(destination.index, 0, removed);
    
    // Update state
    setLocalOutlinePoints(updatedPoints);
    
    // Save changes
    triggerSaveOutline(updatedPoints);
  };

  // Always use vertical list strategy regardless of focus mode
  const sortingStrategy = verticalListSortingStrategy;
  
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

  // Add a new function to handle generating outline points
  const handleGenerateOutlinePoints = async () => {
    if (!sermonId || !isFocusMode) return;
    
    // Map id to the section name expected by API
    const sectionName = id === 'main' ? 'main' : id;
    
    try {
      setIsGeneratingOutlinePoints(true);
      
      const newPoints = await generateOutlinePointsForSection(sermonId, sectionName as 'introduction' | 'main' | 'conclusion');
      
      if (newPoints.length === 0) {
        toast.error(t('structure.generateOutlinePointsError', { defaultValue: 'Failed to generate outline points' }));
        return;
      }
      
      // Add new points to existing ones (if there are any)
      const updatedPoints = [...localOutlinePoints, ...newPoints];
      
      // Update state and save
      setLocalOutlinePoints(updatedPoints);
      triggerSaveOutline(updatedPoints);
      
      toast.success(t('structure.outlinePointsGenerated', { defaultValue: 'Outline points generated successfully', count: newPoints.length }));
    } catch (error) {
      console.error('Error generating outline points:', error);
      toast.error(t('structure.generateOutlinePointsError', { defaultValue: 'Failed to generate outline points' }));
    } finally {
      setIsGeneratingOutlinePoints(false);
    }
  };

  // Helper functions for highlighting
  const isItemHighlighted = (itemId: string) => itemId in highlightedItems;
  const getItemHighlightType = (itemId: string) => highlightedItems[itemId]?.type;

  // Filter unassigned items (not linked to any outline point)
  const unassignedItemsForDisplay = items.filter(item => !item.outlinePointId);

  // Render in focus mode (vertical layout with sidebar)
  if (isFocusMode) {
    return (
      <div className={`flex h-full gap-6 justify-center w-full ${className}`}>
        {/* Left sidebar - fixed, non-scrollable, with more top spacing when scrolling */}
        <div className="w-72 flex-shrink-0 sticky top-16 self-start max-h-[calc(100vh-4rem)]">
          <div 
            className={`h-full rounded-lg shadow-lg flex flex-col ${headerBgColor}`}
            style={headerColor ? { backgroundColor: headerColor } : {}}
          >
            {/* Column title */}
            <div className="p-5 border-b border-white">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">
                  {title}
                </h2>
                {onAddThought && (
                  <button
                    onClick={() => onAddThought(id)}
                    className="ml-2 p-1.5 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
                    title={t('structure.addThoughtToSection', { section: title })}
                  >
                    <PlusIcon className="h-5 w-5 text-white" />
                  </button>
                )}
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="p-5 border-b border-white">
              <div className="space-y-3">
                {showFocusButton && (
                  <button
                    onClick={() => onToggleFocusMode?.(id)}
                    className="relative w-full px-4 py-2.5 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors shadow-sm flex items-center justify-center overflow-hidden isolation-auto"
                  >
                    <div className="absolute inset-0 bg-white"></div>
                    <div className="relative flex items-center justify-center text-gray-800 z-10">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      {t('structure.normalMode')}
                    </div>
                  </button>
                )}
                {onAiSort && (
                  <button
                    onClick={onAiSort}
                    disabled={isLoading}
                    className={`w-full px-4 py-2.5 text-sm font-medium rounded-md transition-colors shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed border ${
                      isLoading ? 'bg-white text-gray-800 border-gray-300' : 
                      id === 'introduction' ? 'bg-blue-500 text-white hover:bg-blue-400 border-blue-400 shadow-md' : 
                      id === 'main' ? 'bg-purple-500 text-white hover:bg-purple-400 border-purple-400 shadow-md' : 
                      id === 'conclusion' ? 'bg-green-500 text-white hover:bg-green-400 border-green-400 shadow-md' : 
                      'bg-gray-500 text-white hover:bg-gray-400 border-gray-400 shadow-md'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4 mr-2 text-gray-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {t('structure.sorting')}
                      </>
                    ) : (
                      <>
                        <span className="flex items-center justify-center">
                          <span className="text-base font-medium">{t('structure.sortButton')}</span>
                          <span className="text-yellow-300 ml-1.5 animate-pulse text-lg">✨</span>
                        </span>
                        <div className="relative flex items-center group">
                          <QuestionMarkCircleIcon className="w-4 h-4 ml-2 text-white opacity-80 hover:opacity-100" />
                          <div className="absolute bottom-full left-1/3 -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded shadow-lg w-48 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-normal">
                            {t('structure.sortInfo', {
                              defaultValue: 'Sorting only processes unassigned thoughts, up to 25 at a time.'
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </button>
                )}
                
                {/* Global accept/reject buttons for AI sort - only show when in diff mode and there are highlighted items */}
                {isDiffModeActive && hasHighlightedItems && (
                  <div className="space-y-2 mt-3 pt-3 border-t border-white border-opacity-30">
                    <h3 className="text-sm font-medium text-white mb-2">
                      {t('structure.aiSuggestions', { defaultValue: 'AI Suggestions' })}
                    </h3>
                    
                    {/* Accept all button */}
                    <button
                      onClick={() => onKeepAll?.(id)}
                      className="w-full px-4 py-2 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-500 transition-colors shadow-sm flex items-center justify-center"
                    >
                      <CheckIcon className="h-4 w-4 mr-2" />
                      {t('structure.acceptAllChanges', { defaultValue: 'Accept all remaining' })}
                    </button>
                    
                    {/* Reject all button */}
                    <button
                      onClick={() => onRevertAll?.(id)}
                      className="w-full px-4 py-2 text-sm font-medium rounded-md bg-orange-600 text-white hover:bg-orange-500 transition-colors shadow-sm flex items-center justify-center"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4 mr-2" />
                      {t('structure.rejectAllChanges', { defaultValue: 'Reject all suggestions' })}
                    </button>
                  </div>
                )}
                
                {getExportContent && sermonId && (
                  <div className="mt-4 flex justify-center">
                    <ExportButtons 
                      getExportContent={getExportContent}
                      sermonId={sermonId}
                      className="inline-flex"
                      orientation="horizontal"
                    />
                  </div>
                )}
              </div>
            </div>
            
            {/* Outline points - Now includes editing capabilities */}
            {isFocusMode && (
              <div className="p-5 flex-grow overflow-y-auto flex flex-col">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-lg font-semibold text-white">{t('structure.outlinePoints')}</h3>
                  
                  {/* Generate outline points button */}
                  {sermonId && (
                    <button
                      onClick={handleGenerateOutlinePoints}
                      disabled={isGeneratingOutlinePoints || localOutlinePoints.length > 0}
                      className={`flex items-center text-xs font-medium px-2 py-1 bg-white bg-opacity-20 rounded transition-colors ${localOutlinePoints.length > 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-opacity-30'} text-white`}
                      title={localOutlinePoints.length > 0 
                        ? t('structure.outlinePointsExist', { defaultValue: 'Outline points already exist' }) 
                        : t('structure.generateOutlinePoints', { defaultValue: 'Generate outline points' })}
                    >
                      {isGeneratingOutlinePoints ? (
                        <svg className="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <SparklesIcon className="h-3 w-3 mr-1" />
                      )}
                      {isGeneratingOutlinePoints ? t('common.generating', { defaultValue: 'Generating...' }) : t('structure.generate', { defaultValue: 'Generate' })}
                    </button>
                  )}
                </div>
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId={`outline-${id}`}>
                    {(provided) => (
                      <ul 
                        {...provided.droppableProps} 
                        ref={provided.innerRef}
                        className="space-y-2 flex-grow"
                      >
                        {localOutlinePoints.map((point, index) => (
                          <Draggable key={point.id} draggableId={point.id} index={index}>
                            {(providedDraggable, snapshot) => (
                              <li
                                ref={providedDraggable.innerRef}
                                {...providedDraggable.draggableProps}
                                className={`flex items-center group p-2 rounded ${snapshot.isDragging ? 'bg-white/30 shadow-md' : 'hover:bg-white/15'}`}
                                style={providedDraggable.draggableProps.style}
                              >
                                {/* Drag handle */}
                                <div {...providedDraggable.dragHandleProps} className="cursor-grab mr-2 text-white">
                                  <Bars3Icon className="h-5 w-5" />
                                </div>
                                
                                {/* Edit form or display */}
                                {editingPointId === point.id ? (
                                  <div ref={editInputRef} className="flex-grow flex items-center space-x-1">
                                    <input 
                                      type="text"
                                      value={editingText}
                                      onChange={(e) => setEditingText(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit(); }}
                                      className="flex-grow p-1 text-sm bg-white/90 text-gray-800 rounded border border-white/30 focus:outline-none focus:border-white"
                                      placeholder={t('structure.editPointPlaceholder')}
                                      autoFocus
                                    />
                                    <button aria-label={t('common.save')} onClick={handleSaveEdit} className="p-1 text-green-400 hover:text-green-300">
                                      <CheckIcon className="h-5 w-5" />
                                    </button>
                                    <button aria-label={t('common.cancel')} onClick={handleCancelEdit} className="p-1 text-red-400 hover:text-red-300">
                                      <XMarkIcon className="h-5 w-5" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-sm text-white flex-grow mr-2" onDoubleClick={() => handleStartEdit(point)}>
                                      {point.text}
                                      {thoughtsPerOutlinePoint[point.id] > 0 && (
                                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-white text-gray-700 rounded-full">
                                          {thoughtsPerOutlinePoint[point.id]}
                                        </span>
                                      )}
                                    </span>
                                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button aria-label={t('common.edit')} onClick={() => handleStartEdit(point)} className="p-1 text-white/70 hover:text-white">
                                        <PencilIcon className="h-4 w-4" />
                                      </button>
                                      <button aria-label={t('common.delete')} onClick={() => handleDeletePoint(point.id)} className="p-1 text-white/70 hover:text-white">
                                        <TrashIcon className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </li>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        
                        {addingNewPoint ? (
                          <div ref={addInputRef} className="mt-2 flex items-center space-x-1">
                            <input
                              type="text"
                              value={newPointText}
                              onChange={(e) => setNewPointText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleAddPoint(); if (e.key === 'Escape') setAddingNewPoint(false); }}
                              placeholder={t('structure.addPointPlaceholder')}
                              className="flex-grow p-2 text-sm bg-white/90 text-gray-800 rounded border border-white/30 focus:outline-none focus:border-white"
                              autoFocus
                            />
                            <button aria-label={t('common.save')} onClick={handleAddPoint} className="p-1 text-green-400 hover:text-green-300">
                              <CheckIcon className="h-5 w-5" />
                            </button>
                            <button aria-label={t('common.cancel')} onClick={() => setAddingNewPoint(false)} className="p-1 text-red-400 hover:text-red-300">
                              <XMarkIcon className="h-5 w-5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingNewPoint(true); setEditingPointId(null); }}
                            className="mt-2 flex items-center justify-center w-full p-2 bg-white/10 rounded text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                          >
                            <PlusIcon className="h-4 w-4 mr-1" />
                            <span>{t('structure.addPointButton')}</span>
                          </button>
                        )}
                      </ul>
                    )}
                  </Droppable>
                </DragDropContext>
              </div>
            )}
          </div>
        </div>
        
        {/* Right side content area (scrollable) */}
        <SortableContext items={items} strategy={sortingStrategy}>
          <div
            ref={setNodeRef}
            className={`flex-grow w-full md:min-w-[700px] lg:min-w-[900px] xl:min-w-[1100px] min-h-[600px] overflow-y-auto p-6 bg-white dark:bg-gray-800 rounded-lg border-2 shadow-lg transition-all ${borderColor} dark:border-gray-700 ${isOver ? "ring-2 ring-blue-400" : ""}`}
            style={headerColor ? { borderColor: headerColor } : {}}
          >
            {items.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400 border-dashed border-2 border-blue-300 dark:border-blue-600 rounded-lg">
                {t('structure.noEntries')}
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <SortableItem 
                    key={item.id} 
                    item={item} 
                    containerId={id} 
                    onEdit={onEdit}
                    isHighlighted={item.id in highlightedItems}
                    highlightType={highlightedItems[item.id]?.type}
                    onKeep={onKeepItem}
                    onRevert={onRevertItem}
                    activeId={activeId}
                  />
                ))}
              </div>
            )}
            {/* Extra dummy element to always provide a drop target */}
            <div id="dummy-drop-zone" className="h-16" />
          </div>
        </SortableContext>
      </div>
    );
  }
  
  // Normal mode UI (non-focused)
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="relative overflow-hidden mb-2 rounded-t-md">
        <div 
          className={`p-3 ${headerBgColor} flex justify-between items-center`}
          style={headerColor ? { backgroundColor: headerColor } : {}}
        >
          <h2 className="text-lg font-bold text-white flex items-center">
            {title}
            <div 
              className="ml-2 flex overflow-hidden rounded-full text-xs relative select-none cursor-default hover:ring-2 hover:ring-white"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              title={t('structure.assignedUnassignedTooltip', {
                assigned: assignedItems,
                unassigned: unassignedItems
              })}
            >
              <span className="bg-green-500 bg-opacity-40 px-2 py-0.5 text-white">
                {assignedItems}
              </span>
              <span className="bg-gray-500 px-2 py-0.5 text-white">
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
          </h2>
          <div className="flex items-center space-x-2">
            {onAddThought && (
              <button
                onClick={() => onAddThought(id)}
                className="p-1 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
                title={t('structure.addThoughtToSection', { section: title })}
              >
                <PlusIcon className="h-4 w-4 text-white" />
              </button>
            )}
            {showFocusButton && onToggleFocusMode && (
              <button
                onClick={() => onToggleFocusMode(id)}
                className="p-1 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
                title={t('structure.focusMode')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Global accept/reject buttons for AI sort - only show when in diff mode and there are highlighted items */}
        {isDiffModeActive && hasHighlightedItems && (
          <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 flex justify-between items-center">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('structure.aiSuggestions', { defaultValue: 'AI Suggestions' })}
            </span>
            <div className="flex space-x-2">
              {/* Accept all button */}
              <button
                onClick={() => onKeepAll?.(id)}
                className="px-2 py-1 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-500 transition-colors shadow-sm flex items-center"
              >
                <CheckIcon className="h-3 w-3 mr-1" />
                {t('structure.acceptAll', { defaultValue: 'Accept all' })}
              </button>
              
              {/* Reject all button */}
              <button
                onClick={() => onRevertAll?.(id)}
                className="px-2 py-1 text-xs font-medium rounded bg-orange-600 text-white hover:bg-orange-500 transition-colors shadow-sm flex items-center"
              >
                <ArrowUturnLeftIcon className="h-3 w-3 mr-1" />
                {t('structure.rejectAll', { defaultValue: 'Reject all' })}
              </button>
            </div>
          </div>
        )}
        
        {/* Outline points display */}
        {localOutlinePoints && localOutlinePoints.length > 0 && (
          <div className={`${headerBgColor} bg-opacity-80 p-2 text-sm font-normal text-white border-t border-white`}
               style={headerColor ? { backgroundColor: headerColor, opacity: 0.8 } : {}}>
            <ul className="list-disc pl-4 space-y-1">
              {localOutlinePoints.map((point: OutlinePoint) => (
                <li key={point.id} className="flex items-center">
                  <span>{point.text}</span>
                  {thoughtsPerOutlinePoint[point.id] > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-white text-gray-700 rounded-full">
                      {thoughtsPerOutlinePoint[point.id]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      
      <SortableContext items={items} strategy={sortingStrategy}>
        <div
          ref={setNodeRef}
          className={`min-h-[300px] p-4 bg-white dark:bg-gray-800 rounded-b-md border-2 shadow-lg transition-all ${borderColor} dark:border-gray-700 ${isOver ? "ring-2 ring-blue-400" : ""}`}
          style={headerColor ? { borderColor: headerColor } : {}}
        >
          {/* Show outline points with grouped thoughts */}
          {localOutlinePoints && localOutlinePoints.length > 0 ? (
            <div className="space-y-6">
              {/* Render placeholders for each outline point with their thoughts */}
              {localOutlinePoints.map((point) => (
                <OutlinePointPlaceholder
                  key={point.id}
                  point={point}
                  items={items}
                  containerId={id}
                  onEdit={onEdit}
                  isHighlighted={isItemHighlighted}
                  getHighlightType={getItemHighlightType}
                  onKeepItem={onKeepItem}
                  onRevertItem={onRevertItem}
                  headerColor={headerColor}
                  t={t}
                  activeId={activeId}
                />
              ))}
              
              {/* Show unassigned thoughts section if there are any */}
              {unassignedItemsForDisplay.length > 0 && (
                <div className="mt-8">
                                  <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-4">
                    {t('structure.unassignedThoughts', { defaultValue: 'Unassigned Thoughts' })} ({unassignedItemsForDisplay.length})
                  </h4>
                    <UnassignedThoughtsDropTarget
                      items={unassignedItemsForDisplay}
                      containerId={id}
                      onEdit={onEdit}
                      isHighlighted={isItemHighlighted}
                      getHighlightType={getItemHighlightType}
                      onKeepItem={onKeepItem}
                      onRevertItem={onRevertItem}
                      t={t}
                      activeId={activeId}
                    />
                  </div>
                </div>
              )}
              
              {/* Always show drop target for unassigned thoughts, even if empty */}
              {unassignedItemsForDisplay.length === 0 && localOutlinePoints.length > 0 && (
                <div className="mt-8">
                                  <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-4">
                    {t('structure.unassignedThoughts', { defaultValue: 'Unassigned Thoughts' })} (0)
                  </h4>
                    <UnassignedThoughtsDropTarget
                      items={[]}
                      containerId={id}
                      onEdit={onEdit}
                      isHighlighted={isItemHighlighted}
                      getHighlightType={getItemHighlightType}
                      onKeepItem={onKeepItem}
                      onRevertItem={onRevertItem}
                      t={t}
                      activeId={activeId}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Fallback: show all items in simple list if no outline points exist */
            items.length === 0 ? (
            <div className="p-4 text-center text-gray-500 border-dashed border-2 border-blue-300">
              {t('structure.noEntries')}
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <SortableItem 
                  key={item.id} 
                  item={item} 
                  containerId={id} 
                  onEdit={onEdit}
                  isHighlighted={item.id in highlightedItems}
                  highlightType={highlightedItems[item.id]?.type}
                  onKeep={onKeepItem}
                  onRevert={onRevertItem}
                  activeId={activeId}
                />
              ))}
            </div>
            )
          )}
          {/* Extra dummy element to always provide a drop target */}
          <div id="dummy-drop-zone" className="h-8" />
        </div>
      </SortableContext>
    </div>
  );
}
