import { useState, useMemo, useEffect, useCallback } from 'react';

import { normalizeStructureTag } from '@utils/tagUtils';
import { getPreachOrderedThoughts } from '@utils/thoughtOrdering';

import type { Thought, Sermon } from '@/models/models';

export type SortOrder = 'date' | 'structure';
export type ViewFilter = 'all' | 'missingTags';
export type StructureFilter = string; // Can be 'all' or a specific structure tag

interface UseThoughtFilteringProps {
  initialThoughts: Thought[];
  sermonStructure: Sermon['structure']; // Pass sermon structure for sorting
  sermonOutline?: Sermon['outline']; // Optional: outline to refine structure order
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
  sermonOutline,
}: UseThoughtFilteringProps): UseThoughtFilteringReturn {
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [structureFilter, setStructureFilter] = useState<StructureFilter>('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('date');
  
  // Check if any structure tags are present (use direct prop)
  const hasStructureTags = useMemo(() => {
    return initialThoughts?.some(thought => 
      thought.tags.some(tag => normalizeStructureTag(tag) !== null)
    ) ?? false;
  }, [initialThoughts]);

  // Filter thoughts based on selected filters (use direct prop)
  const filteredThoughts = useMemo(() => {
    let thoughtsToProcess = [...initialThoughts]; // Use direct prop

    // Apply view filter
    if (viewFilter === 'missingTags') {
      thoughtsToProcess = thoughtsToProcess.filter(thought => 
        !thought.tags.some(tag => normalizeStructureTag(tag) !== null)
      );
    }

    // Apply structure filter
    if (structureFilter !== 'all') {
      thoughtsToProcess = thoughtsToProcess.filter(thought =>
        thought.tags.some(tag => normalizeStructureTag(tag) !== null && normalizeStructureTag(tag) === normalizeStructureTag(structureFilter))
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
      const pseudoSermon = {
        thoughts: initialThoughts,
        structure: sermonStructure,
        outline: sermonOutline,
      } as Sermon;

      const orderedThoughts = getPreachOrderedThoughts(pseudoSermon, { includeOrphans: true });
      const orderIndex = new Map(orderedThoughts.map((thought, index) => [thought.id, index]));

      thoughtsToProcess.sort((a, b) => {
        const indexA = orderIndex.get(a.id) ?? Number.POSITIVE_INFINITY;
        const indexB = orderIndex.get(b.id) ?? Number.POSITIVE_INFINITY;
        if (indexA !== indexB) return indexA - indexB;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
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
    sermonOutline, // Depend on prop used in sorting logic
  ]);

  // Calculate activeCount separately (use direct prop)
  const activeCount = useMemo(() => {
    let countThoughts = [...initialThoughts]; // Use direct prop
    
    // Re-apply filters that affect the count
    if (viewFilter === 'missingTags') {
      countThoughts = countThoughts.filter(thought => 
        !thought.tags.some(tag => normalizeStructureTag(tag) !== null)
      );
    }
    if (structureFilter !== 'all') {
      countThoughts = countThoughts.filter(thought =>
        thought.tags.some(tag => normalizeStructureTag(tag) !== null && normalizeStructureTag(tag) === normalizeStructureTag(structureFilter))
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

  // No debug logging in production

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
