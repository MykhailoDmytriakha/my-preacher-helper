import { useState, useMemo, useCallback } from 'react';

import { CANONICAL_TO_SECTION, normalizeStructureTag } from '@utils/tagUtils';
import { canonicalizeStructure } from '@utils/thoughtOrdering';

import type { Thought, Sermon } from '@/models/models';

export type SortOrder = 'date' | 'structure';
/** 'unplaced': thoughts not assigned to a section — not placed yet, or kept under consideration. */
export type ViewFilter = 'all' | 'unplaced';
export type StructureFilter = string; // 'all' or a section tag from STRUCTURE_TAGS

interface UseThoughtFilteringProps {
  initialThoughts: Thought[];
  sermonStructure: Sermon['structure']; // Pass sermon structure for sorting
  sermonOutline?: Sermon['outline']; // Optional: outline to refine structure order
  /** Legacy section lists; canonicalizeStructure reads them when `structure` is absent. */
  sermonThoughtsBySection?: Sermon['thoughtsBySection'];
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
}

const UNPLACED_SECTION = 'ambiguous';
/** Preaching order of the sections; thoughts not assigned to a section come last. */
const SECTION_ORDER = ['introduction', 'main', 'conclusion', UNPLACED_SECTION] as const;

export function useThoughtFiltering({
  initialThoughts,
  sermonStructure,
  sermonOutline,
  sermonThoughtsBySection,
}: UseThoughtFilteringProps): UseThoughtFilteringReturn {
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [structureFilter, setStructureFilter] = useState<StructureFilter>('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('date');

  // The section each thought sits in, from its place in the structure: its outline point first, then the
  // structure lists. Section tags are legacy markers and count only as the fallback for old thoughts
  // (thoughtOrdering.resolveThought) — the same rule the structure sort orders by.
  const pseudoSermon = useMemo(() => ({
    thoughts: initialThoughts,
    structure: sermonStructure,
    thoughtsBySection: sermonThoughtsBySection,
    outline: sermonOutline,
  }) as Sermon, [initialThoughts, sermonStructure, sermonThoughtsBySection, sermonOutline]);

  // One partition serves both the section filter and the structure sort, so a thought is never
  // filtered into one section and sorted into another (a legacy tag cannot pull it elsewhere).
  const { sectionById, structureIndex } = useMemo(() => {
    const bySection = canonicalizeStructure(pseudoSermon);
    const sections = new Map<string, string>();
    const order = new Map<string, number>();
    SECTION_ORDER.forEach((section) => {
      (bySection[section] ?? []).forEach((id) => {
        if (sections.has(id)) return;
        sections.set(id, section);
        order.set(id, order.size);
      });
    });
    return { sectionById: sections, structureIndex: order };
  }, [pseudoSermon]);

  const applyFilters = useCallback((thoughts: Thought[]) => {
    const sectionOf = (thought: Thought) => sectionById.get(thought.id) ?? UNPLACED_SECTION;
    let result = thoughts;
    if (viewFilter === 'unplaced') {
      result = result.filter((thought) => sectionOf(thought) === UNPLACED_SECTION);
    }
    if (structureFilter !== 'all') {
      const canonical = normalizeStructureTag(structureFilter);
      const section = canonical ? CANONICAL_TO_SECTION[canonical] : null;
      result = result.filter((thought) => section !== null && sectionOf(thought) === section);
    }
    if (tagFilters.length > 0) {
      result = result.filter((thought) => tagFilters.every((filterTag) => thought.tags.includes(filterTag)));
    }
    return result;
  }, [sectionById, viewFilter, structureFilter, tagFilters]);

  const filteredThoughts = useMemo(() => {
    const thoughtsToProcess = [...applyFilters(initialThoughts)];

    if (sortOrder === 'structure') {
      thoughtsToProcess.sort((a, b) => {
        const indexA = structureIndex.get(a.id) ?? Number.POSITIVE_INFINITY;
        const indexB = structureIndex.get(b.id) ?? Number.POSITIVE_INFINITY;
        if (indexA !== indexB) return indexA - indexB;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
    } else { // Default sort by date
      thoughtsToProcess.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    return thoughtsToProcess;
  }, [applyFilters, initialThoughts, sortOrder, structureIndex]);

  const activeCount = useMemo(() => applyFilters(initialThoughts).length, [applyFilters, initialThoughts]);

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
  };
}
