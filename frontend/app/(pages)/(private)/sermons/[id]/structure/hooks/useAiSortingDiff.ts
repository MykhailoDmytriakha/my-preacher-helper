import { useState, useCallback } from "react";
import { Item, SermonPoint, Thought, Sermon, ThoughtsBySection } from "@/models/models";
import { sortItemsWithAI } from "@/services/sortAI.service";
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { dedupeIds } from "../utils/structure";

interface UseAiSortingDiffProps {
  containers: Record<string, Item[]>;
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  outlinePoints: { introduction: SermonPoint[]; main: SermonPoint[]; conclusion: SermonPoint[] };
  sermon: Sermon | null;
  sermonId: string | null;
  debouncedSaveThought: (sermonId: string, thought: Thought) => void;
  debouncedSaveStructure: (sermonId: string, structure: ThoughtsBySection) => void;
}

export const useAiSortingDiff = ({
  containers,
  setContainers,
  outlinePoints,
  sermon,
  sermonId,
  debouncedSaveThought,
  debouncedSaveStructure,
}: UseAiSortingDiffProps) => {
  const { t } = useTranslation();
  
  // AI Sort with Interactive Confirmation state
  const [preSortState, setPreSortState] = useState<Record<string, Item[]> | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, { type: 'assigned' | 'moved' }>>({});
  const [isDiffModeActive, setIsDiffModeActive] = useState<boolean>(false);
  const [isSorting, setIsSorting] = useState(false);

  const handleAiSort = useCallback(async (columnId: string) => {
    if (isSorting || !sermon || !sermonId) return;
    
    const currentColumnItems: Item[] = containers[columnId] || [];
    if (currentColumnItems.length === 0) {
      toast.info(t('structure.noItemsToSort', {
        defaultValue: 'No items to sort in this column.'
      }));
      return;
    }
    
    // Check maximum thoughts limit (keep in sync with API: 25)
    if (currentColumnItems.length > 25) {
      toast.warning(t('structure.tooManyThoughts', {
        defaultValue: 'Too many thoughts to sort. Please reduce to 25 or fewer.'
      }));
      return;
    }
    
    setIsSorting(true);
    setPreSortState({ [columnId]: [...currentColumnItems] });
    
    try {
      // Get outline points for this column
      const outlinePointsForColumn = outlinePoints[columnId as keyof typeof outlinePoints] || [];
      
      // Call the AI sorting service
      const sortedItems = await sortItemsWithAI(
        columnId,
        currentColumnItems,
        sermonId,
        outlinePointsForColumn
      );
      
      if (!sortedItems || !Array.isArray(sortedItems)) {
        toast.error(t('errors.aiSortFailedFormat'));
        setIsSorting(false);
        setPreSortState(null);
        return;
      }
      
      // Track items that were changed by AI
      const newHighlightedItems: Record<string, { type: 'assigned' | 'moved' }> = {};
      
      // Find what changes were made by AI
      for (const item of sortedItems) {
        const originalItem = currentColumnItems.find(i => i.id === item.id);
        
        if (!originalItem) continue; // Should not happen but safety first
        
        // Check if outline point was assigned (only for previously unassigned thoughts)
        if (item.outlinePointId && !originalItem.outlinePointId) {
          newHighlightedItems[item.id] = { type: 'assigned' };
        } 
        // Check if position changed
        else if (
          currentColumnItems.findIndex(i => i.id === item.id) !== 
          sortedItems.findIndex(i => i.id === item.id)
        ) {
          newHighlightedItems[item.id] = { type: 'moved' };
        }
      }
      
      // Combine sorted items with remaining items
      const finalSortedItems = [...sortedItems, ...currentColumnItems.filter(item => 
        !sortedItems.some(sortedItem => sortedItem.id === item.id)
      )];
      
      // Only enter diff mode if any changes were made
      const hasChanges = Object.keys(newHighlightedItems).length > 0;
      
      if (hasChanges) {
        // Update state with new highlighted items and enable diff mode
        setHighlightedItems(newHighlightedItems);
        setIsDiffModeActive(true);
        
        // Update containers with the new sorted items
        setContainers(prev => ({
          ...prev,
          [columnId]: finalSortedItems
        }));
        
        // Notify the user of changes
        toast.success(t('structure.aiSortSuggestionsReady', { 
          defaultValue: 'AI sorting completed. Review and confirm the changes.'
        }));
      } else {
        // No changes were made, but still update containers to reflect AI sorting
        setContainers(prev => ({
          ...prev,
          [columnId]: finalSortedItems
        }));
        
        // Simply inform the user
        toast.info(t('structure.aiSortNoChanges', {
          defaultValue: 'AI sort did not suggest any changes.'
        }));
        
        // Clean up
        setPreSortState(null);
      }
    } catch {
      toast.error(t('errors.failedToSortItems'));
      // Reset state on error
      setPreSortState(null);
    } finally {
      setIsSorting(false);
    }
  }, [
    sermon, 
    sermonId, 
    isSorting, 
    containers, 
    outlinePoints, 
    setContainers, 
    t
  ]);

  // Handler for accepting a single item change
  const handleKeepItem = useCallback((itemId: string, columnId: string) => {
    // Find the current item
    const sectionItems = containers[columnId];
    if (!Array.isArray(sectionItems)) return;
    
    const item = sectionItems.find(i => i.id === itemId);
    if (!item) return;

    // Remove from highlighted items
    setHighlightedItems(prev => {
      const newHighlighted = { ...prev };
      delete newHighlighted[itemId];
      
      // If no more highlighted items, exit diff mode
      if (Object.keys(newHighlighted).length === 0) {
        setIsDiffModeActive(false);
        setPreSortState(null);
      }
      
      return newHighlighted;
    });

    // Persist outline point change if it differs (including clearing to null)
    if (sermon) {
      const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
      if (thought) {
        const prevOutline = (thought.outlinePointId ?? null);
        const nextOutline = (item.outlinePointId ?? null);
        if (prevOutline !== nextOutline) {
          const updatedThought: Thought = {
            ...thought,
            outlinePointId: nextOutline
          };
          debouncedSaveThought(sermonId!, updatedThought);
        }
      }
    }

    // Save the current structure
    const newStructure: ThoughtsBySection = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
  }, [
    containers, 
    sermon, 
    sermonId, 
    debouncedSaveThought, 
    debouncedSaveStructure
  ]);

  // Handler for reverting a single item change
  const handleRevertItem = useCallback((itemId: string, columnId: string) => {
    if (!preSortState || !preSortState[columnId]) return;
    
    // Find the original item state
    const originalItem = preSortState[columnId].find(i => i.id === itemId);
    if (!originalItem) return;
    
    // Find current position in the container
    const currentIndex = containers[columnId].findIndex(i => i.id === itemId);
    if (currentIndex === -1) return;
    
    // Find original position
    const originalIndex = preSortState[columnId].findIndex(i => i.id === itemId);
    
    // Update containers to revert this item
    setContainers(prev => {
      // Create a copy of the current items
      const updatedItems = [...prev[columnId]];
      
      // Remove item from current position
      updatedItems.splice(currentIndex, 1);
      
      // Find proper insertion position (considering other items may have moved)
      let insertPosition = originalIndex;
      if (insertPosition > updatedItems.length) {
        insertPosition = updatedItems.length;
      }
      
      // Insert item at the proper position
      updatedItems.splice(insertPosition, 0, originalItem);
      
      return {
        ...prev,
        [columnId]: updatedItems
      };
    });
    
    // Remove from highlighted items
    setHighlightedItems(prev => {
      const newHighlighted = { ...prev };
      delete newHighlighted[itemId];
      
      // If no more highlighted items, exit diff mode
      if (Object.keys(newHighlighted).length === 0) {
        setIsDiffModeActive(false);
        setPreSortState(null);
      }
      
      return newHighlighted;
    });
    
    // If there was an outline point change, revert it in the database
    if (sermon) {
      const currentItem = containers[columnId][currentIndex];
      if (currentItem.outlinePointId !== originalItem.outlinePointId) {
        const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
        if (thought) {
          // Create reverted thought
          const updatedThought: Thought = {
            ...thought,
            outlinePointId: originalItem.outlinePointId
          };
          
          // Save the thought
          debouncedSaveThought(sermonId!, updatedThought);
        }
      }
    }
    
    // Save the updated structure
    const newStructure: ThoughtsBySection = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
  }, [
    preSortState, 
    containers, 
    setContainers, 
    sermon, 
    sermonId, 
    debouncedSaveThought, 
    debouncedSaveStructure
  ]);

  // Handler for accepting all remaining changes
  const handleKeepAll = useCallback(() => {
    if (!highlightedItems || Object.keys(highlightedItems).length === 0) return;
    
    // Create a list of all thoughts that need to be updated
    const thoughtUpdates: Array<{id: string, outlinePointId?: string}> = [];
    
    // Check for outline point assignments
    for (const itemId of Object.keys(highlightedItems)) {
      // Find the item in the containers
      for (const items of Object.values(containers)) {
        if (!Array.isArray(items)) continue;
        
        const item = items.find(i => i.id === itemId);
        if (item && item.outlinePointId && sermon) {
          const thought = sermon.thoughts.find((t: Thought) => t.id === itemId);
          if (thought && thought.outlinePointId !== item.outlinePointId) {
            // Add to updates list
            thoughtUpdates.push({
              id: itemId,
              outlinePointId: item.outlinePointId
            });
          }
        }
      }
    }
    
    // Process thought updates
    if (thoughtUpdates.length > 0 && sermon) {
      for (const update of thoughtUpdates) {
        const thought = sermon.thoughts.find((t: Thought) => t.id === update.id);
        if (thought) {
          const updatedThought: Thought = {
            ...thought,
            outlinePointId: update.outlinePointId
          };
          
          // Save the thought with debouncing
          debouncedSaveThought(sermonId!, updatedThought);
        }
      }
    }
    
    // Save the current structure
    const newStructure: ThoughtsBySection = {
      introduction: containers.introduction.map((item) => item.id),
      main: containers.main.map((item) => item.id),
      conclusion: containers.conclusion.map((item) => item.id),
      ambiguous: containers.ambiguous.map((item) => item.id),
    };
    
    // Update structure in database
    debouncedSaveStructure(sermonId!, newStructure);
    
    // Clear highlighted items and exit diff mode
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);
    
    // Show confirmation toast
    toast.success(t('structure.aiSortChangesAccepted', {
      defaultValue: 'All AI suggestions accepted.'
    }));
  }, [
    highlightedItems, 
    containers, 
    sermon, 
    sermonId, 
    debouncedSaveThought, 
    debouncedSaveStructure, 
    t
  ]);

  // Handler for reverting all changes
  const handleRevertAll = useCallback((columnId: string) => {
    if (!preSortState || !preSortState[columnId]) return;
    
    // Revert the column to its pre-sort state
    setContainers(prev => ({
      ...prev,
      [columnId]: [...preSortState[columnId]]
    }));
    
    // Clear highlighted items and exit diff mode
    setHighlightedItems({});
    setIsDiffModeActive(false);
    setPreSortState(null);
    
    // Show confirmation toast
    toast.info(t('structure.aiSortChangesReverted', {
      defaultValue: 'All AI suggestions reverted.'
    }));
  }, [preSortState, setContainers, t]);

  return {
    // State
    preSortState,
    highlightedItems,
    isDiffModeActive,
    isSorting,
    
    // Actions
    handleAiSort,
    handleKeepItem,
    handleRevertItem,
    handleKeepAll,
    handleRevertAll,
    
    // Setters for external use (e.g., when dragging highlighted items)
    setHighlightedItems,
    setIsDiffModeActive,
    setPreSortState,
  };
};
