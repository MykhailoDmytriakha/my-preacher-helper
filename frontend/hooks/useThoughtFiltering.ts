import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Thought, Sermon, SermonOutline, SermonPoint } from '@/models/models';
import { STRUCTURE_TAGS } from '@lib/constants'; // Use new @lib alias
import { normalizeStructureTag } from '@utils/tagUtils';

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
      // Precompute lookup maps to follow the actual reading order
      const sectionOrder: Record<string, number> = { introduction: 0, main: 1, conclusion: 2 };

      // Map thoughtId -> section and index within provided sermonStructure arrays
      const structuredIndexById: Record<string, { section: keyof typeof sectionOrder; index: number }> = {};
      if (sermonStructure) {
        (['introduction', 'main', 'conclusion'] as const).forEach((sec) => {
          const arr = sermonStructure[sec] || [];
          arr.forEach((id, idx) => {
            structuredIndexById[id] = { section: sec, index: idx };
          });
        });
      }

      // Map outlinePointId -> section + index in its section
      const outlineIndexByPoint: Record<string, { section: keyof typeof sectionOrder; index: number }> = {};
      if (sermonOutline) {
        (['introduction', 'main', 'conclusion'] as const).forEach((sec) => {
          const pts = (sermonOutline as SermonOutline)?.[sec] || [];
          (pts as SermonPoint[]).forEach((p, idx) => {
            outlineIndexByPoint[p.id] = { section: sec, index: idx };
          });
        });
      }

      const getSectionRank = (t: Thought): number => {
        // Prefer explicit sermonStructure membership
        const sIdx = structuredIndexById[t.id]?.section;
        if (sIdx) return sectionOrder[sIdx];
        // Next prefer outline point section
        if (t.outlinePointId && outlineIndexByPoint[t.outlinePointId]) {
          return sectionOrder[outlineIndexByPoint[t.outlinePointId].section];
        }
        // Fallback to tag canonical
        const tag = t.tags.find(tag => normalizeStructureTag(tag) !== null);
        const canonical = tag ? normalizeStructureTag(tag) : null;
        if (canonical === 'intro') return sectionOrder['introduction'];
        if (canonical === 'main') return sectionOrder['main'];
        if (canonical === 'conclusion') return sectionOrder['conclusion'];
        // Unknown/ambiguous goes last
        return 99;
      };

      const getOutlineRank = (t: Thought): number => {
        if (t.outlinePointId && outlineIndexByPoint[t.outlinePointId]) {
          return outlineIndexByPoint[t.outlinePointId].index;
        }
        // Not attached to outline → after all outline points
        return 9999;
      };

      const getWithinSectionRank = (t: Thought): number => {
        // Exact index from sermonStructure if present
        if (structuredIndexById[t.id]) return structuredIndexById[t.id].index;
        // Position field can be present from ThoughtsBySection page; use it next
        if (typeof t.position === 'number') return t.position;
        // Fallback to date (newest first like other lists)
        return -new Date(t.date).getTime();
      };

      thoughtsToProcess.sort((a, b) => {
        const sa = getSectionRank(a);
        const sb = getSectionRank(b);
        if (sa !== sb) return sa - sb;

        const oa = getOutlineRank(a);
        const ob = getOutlineRank(b);
        if (oa !== ob) return oa - ob;

        const wa = getWithinSectionRank(a);
        const wb = getWithinSectionRank(b);
        if (wa !== wb) return wa - wb;

        // Stable fallback
        return a.id.localeCompare(b.id);
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
