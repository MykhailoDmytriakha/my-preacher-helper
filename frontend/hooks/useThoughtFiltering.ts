import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Thought, Sermon } from '@/models/models';
import { ALL_STRUCTURE_TAGS, getStructureTagCanonicalIndex, STRUCTURE_TAGS } from '@lib/constants'; // Use new @lib alias

export type SortOrder = 'date' | 'structure';
export type ViewFilter = 'all' | 'missingTags';
export type StructureFilter = string; // Can be 'all' or a specific structure tag

interface UseThoughtFilteringProps {
  initialThoughts: Thought[];
  sermonStructure: Sermon['structure']; // Pass sermon structure for sorting
}

interface UseThoughtFilteringReturn {
  filteredThoughts: Thought[];
  activeCount: number;
  viewFilter: ViewFilter;
  setViewFilter: React.Dispatch<React.SetStateAction<ViewFilter>>;
  structureFilter: StructureFilter;
  setStructureFilter: React.Dispatch<React.SetStateAction<StructureFilter>>;
  tagFilters: string[];
  toggleTagFilter: (tag: string) => void;
  resetFilters: () => void;
  sortOrder: SortOrder;
  setSortOrder: React.Dispatch<React.SetStateAction<SortOrder>>;
  hasStructureTags: boolean; // Indicate if any thought has a structure tag
}

export function useThoughtFiltering({
  initialThoughts,
  sermonStructure,
}: UseThoughtFilteringProps): UseThoughtFilteringReturn {
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [structureFilter, setStructureFilter] = useState<StructureFilter>('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('date');
  
  // Check if any structure tags are present (use direct prop)
  const hasStructureTags = useMemo(() => {
    return initialThoughts?.some(thought => 
      thought.tags.some(tag => ALL_STRUCTURE_TAGS.includes(tag))
    ) ?? false;
  }, [initialThoughts]); // Depend on prop

  // Filter thoughts based on selected filters (use direct prop)
  const filteredThoughts = useMemo(() => {
    let thoughtsToProcess = [...initialThoughts]; // Use direct prop

    // Apply view filter
    if (viewFilter === 'missingTags') {
      thoughtsToProcess = thoughtsToProcess.filter(thought => 
        !thought.tags.some(tag => ALL_STRUCTURE_TAGS.includes(tag))
      );
    }

    // Apply structure filter
    if (structureFilter !== 'all') {
      thoughtsToProcess = thoughtsToProcess.filter(thought =>
        thought.tags.includes(structureFilter)
      );
    }

    // Apply tag filters
    if (tagFilters.length > 0) {
      thoughtsToProcess = thoughtsToProcess.filter(thought =>
        tagFilters.every(filterTag => thought.tags.includes(filterTag))
      );
    }

    // Apply sorting (use direct prop)
    if (sortOrder === 'structure' && hasStructureTags) {
        thoughtsToProcess.sort((a, b) => {
          // Use sermon.structure if available for precise ordering
          if (sermonStructure) {
              const structuredIds = [
                  ...(sermonStructure.introduction || []),
                  ...(sermonStructure.main || []),
                  ...(sermonStructure.conclusion || [])
              ];
              const aIndex = structuredIds.indexOf(a.id);
              const bIndex = structuredIds.indexOf(b.id);
              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
              if (aIndex !== -1) return -1; // a is structured, b is not
              if (bIndex !== -1) return 1;  // b is structured, a is not
          }
  
          // Fallback to tag-based sorting if structure doesn't include these thoughts
          const aStructureTag = a.tags.find(tag => ALL_STRUCTURE_TAGS.includes(tag));
          const bStructureTag = b.tags.find(tag => ALL_STRUCTURE_TAGS.includes(tag));
  
          if (aStructureTag && bStructureTag) {
              const aCanonicalIndex = getStructureTagCanonicalIndex(aStructureTag);
              const bCanonicalIndex = getStructureTagCanonicalIndex(bStructureTag);
              if (aCanonicalIndex !== bCanonicalIndex) return aCanonicalIndex - bCanonicalIndex;
          }
          
          // Prioritize thoughts with any structure tag over those without
          if (aStructureTag && !bStructureTag) return -1;
          if (!aStructureTag && bStructureTag) return 1;
          
          // Fallback to date sort if structure tags are the same or absent
          return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
    } else { // Default sort by date
      thoughtsToProcess.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    
    return thoughtsToProcess;
  }, [
    initialThoughts, // Depend on prop
    viewFilter,
    structureFilter,
    tagFilters,
    sortOrder,
    hasStructureTags, 
    sermonStructure, 
  ]);

  // Calculate activeCount separately (use direct prop)
  const activeCount = useMemo(() => {
    let countThoughts = [...initialThoughts]; // Use direct prop
    
    // Re-apply filters that affect the count
    if (viewFilter === 'missingTags') {
      countThoughts = countThoughts.filter(thought => 
        !thought.tags.some(tag => ALL_STRUCTURE_TAGS.includes(tag))
      );
    }
    if (structureFilter !== 'all') {
      countThoughts = countThoughts.filter(thought =>
        thought.tags.includes(structureFilter)
      );
    }
    if (tagFilters.length > 0) {
      countThoughts = countThoughts.filter(thought =>
        tagFilters.every(filterTag => thought.tags.includes(filterTag))
      );
    }
    
    return countThoughts.length;
  }, [initialThoughts, viewFilter, structureFilter, tagFilters]); // Depend on prop

  // Reset structure filter and sort order if no structure tags are present
  useEffect(() => {
    if (!hasStructureTags) {
      if (structureFilter !== 'all') {
        setStructureFilter('all');
      }
      if (sortOrder === 'structure') {
        setSortOrder('date');
      }
    }
  }, [hasStructureTags, structureFilter, sortOrder]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilters(prevFilters =>
      prevFilters.includes(tag)
        ? prevFilters.filter(t => t !== tag)
        : [...prevFilters, tag]
    );
  }, []);

  const resetFilters = useCallback(() => {
    setViewFilter('all');
    setStructureFilter('all');
    setTagFilters([]);
    setSortOrder('date');
  }, []);

  return {
    filteredThoughts,
    activeCount,
    viewFilter,
    setViewFilter,
    structureFilter,
    setStructureFilter,
    tagFilters,
    toggleTagFilter,
    resetFilters,
    sortOrder,
    setSortOrder,
    hasStructureTags,
  };
} 