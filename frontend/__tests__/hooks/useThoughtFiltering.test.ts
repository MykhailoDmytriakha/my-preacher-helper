import { renderHook, act } from '@testing-library/react';

import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';

import type { Thought, Sermon } from '@/models/models';

// Mock Data
const mockThoughts: Thought[] = [
  { id: '1', text: 'Intro thought 1', tags: [STRUCTURE_TAGS.INTRODUCTION], date: '2023-10-26T10:00:00Z', outlinePointId: 'p1' },
  { id: '2', text: 'Main thought 1', tags: [STRUCTURE_TAGS.MAIN_BODY, 'custom1'], date: '2023-10-26T11:00:00Z', outlinePointId: 'p2' },
  { id: '3', text: 'Conclusion thought 1', tags: [STRUCTURE_TAGS.CONCLUSION], date: '2023-10-26T12:00:00Z', outlinePointId: 'p3' },
  { id: '4', text: 'Main thought 2 (Uk)', tags: ['Основна частина', 'custom2'], date: '2023-10-26T09:00:00Z', outlinePointId: 'p4' },
  { id: '5', text: 'Thought with no structure tag', tags: ['custom1'], date: '2023-10-26T08:00:00Z', outlinePointId: 'p5' },
  { id: '6', text: 'Thought with missing required tag', tags: ['custom2'], date: '2023-10-26T13:00:00Z' }, // Removed status and userId
];

const mockStructure: Sermon['structure'] = {
  introduction: ['1'],
  main: ['2', '4'],
  conclusion: ['3'],
  ambiguous: [],
};

const mockStructureEmpty: Sermon['structure'] = {
  introduction: [],
  main: [],
  conclusion: [],
  ambiguous: [],
}

// Helper to render the hook
const setupHook = (initialThoughts = mockThoughts, sermonStructure = mockStructure) => {
  return renderHook(() => useThoughtFiltering({ initialThoughts, sermonStructure }));
};

describe('useThoughtFiltering Hook', () => {

  it('should initialize with default filters and date sort order', () => {
    const { result } = setupHook();
    expect(result.current.viewFilter).toBe('all');
    expect(result.current.structureFilter).toBe('all');
    expect(result.current.tagFilters).toEqual([]);
    expect(result.current.sortOrder).toBe('date');
    expect(result.current.hasStructureTags).toBe(true);
    // Check default date sort (newest first)
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['6', '3', '2', '1', '4', '5']);
    expect(result.current.activeCount).toBe(6);
  });

  it('should filter by viewFilter="missingTags"', () => {
    const { result } = setupHook();
    
    act(() => {
      result.current.setViewFilter('missingTags');
    });

    expect(result.current.viewFilter).toBe('missingTags');
    // Only thoughts 5 and 6 should remain
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['6', '5']);
    expect(result.current.activeCount).toBe(2);
  });

  it('should filter by structureFilter', () => {
    const { result } = setupHook();
    
    act(() => {
      result.current.setStructureFilter(STRUCTURE_TAGS.MAIN_BODY);
    });

    expect(result.current.structureFilter).toBe(STRUCTURE_TAGS.MAIN_BODY);
    // Both thought 2 (RU main) and 4 (UK main) remain due to normalization
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['2','4']);
    expect(result.current.activeCount).toBe(2);
  });

  it('should filter by tagFilters (single tag)', () => {
    const { result } = setupHook();
    
    act(() => {
      result.current.toggleTagFilter('custom1');
    });

    expect(result.current.tagFilters).toEqual(['custom1']);
    // Thoughts 2 and 5 have 'custom1' tag
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['2', '5']);
    expect(result.current.activeCount).toBe(2);
  });
  
  it('should filter by tagFilters (multiple tags - AND logic)', () => {
      const thoughtsWithMultipleTags: Thought[] = [
          ...mockThoughts,
          { id: '7', text: 'Multi tag', tags: ['custom1', 'custom2', STRUCTURE_TAGS.MAIN_BODY], date: '2023-10-27T10:00:00Z' }, 
      ];
      const { result } = setupHook(thoughtsWithMultipleTags);
      
      act(() => {
        result.current.toggleTagFilter('custom1');
        result.current.toggleTagFilter('custom2');
      });
  
      expect(result.current.tagFilters).toEqual(['custom1', 'custom2']);
      // Filtered by custom1 & custom2: only 7
      // Default date sort: 7, 6, 3, 2, 1, 4, 5
      expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['7']);
      expect(result.current.activeCount).toBe(1);
    });

  it('should remove tag from filter when toggled again', () => {
    const { result } = setupHook();
    
    act(() => {
      result.current.toggleTagFilter('custom1');
    });
    expect(result.current.tagFilters).toEqual(['custom1']);
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['2', '5']);

    act(() => {
      result.current.toggleTagFilter('custom1'); // Toggle off
    });
    expect(result.current.tagFilters).toEqual([]);
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['6', '3', '2', '1', '4', '5']); // Back to default
  });

  it('should reset all filters', () => {
    const { result } = setupHook();
    
    // Apply some filters
    act(() => {
      result.current.setViewFilter('missingTags');
      result.current.setStructureFilter(STRUCTURE_TAGS.MAIN_BODY);
      result.current.toggleTagFilter('custom1');
      result.current.setSortOrder('structure');
    });

    // Verify filters are applied
    expect(result.current.viewFilter).not.toBe('all');
    expect(result.current.structureFilter).not.toBe('all');
    expect(result.current.tagFilters).not.toEqual([]);
    expect(result.current.sortOrder).toBe('structure');

    // Reset
    act(() => {
      result.current.resetFilters();
    });

    // Verify filters are reset to default
    expect(result.current.viewFilter).toBe('all');
    expect(result.current.structureFilter).toBe('all');
    expect(result.current.tagFilters).toEqual([]);
    expect(result.current.sortOrder).toBe('date'); // Should reset sort order too
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['6', '3', '2', '1', '4', '5']);
  });

  it('should sort by structure when sortOrder is "structure" and structure exists', () => {
    const { result } = setupHook();
    
    act(() => {
      result.current.setSortOrder('structure');
    });

    expect(result.current.sortOrder).toBe('structure');
    // Order based on mockStructure: 1 (intro), 2 (main), 4 (main), 3 (concl)
    // Then non-structured thoughts by date: 6, 5
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['1', '2', '4', '3', '6', '5']); 
  });

   it('should fall back to tag-based structure sort when structure is missing or incomplete', () => {
    // Use structure that only includes thought '1'
    const incompleteStructure: Sermon['structure'] = { introduction: ['1'], main: [], conclusion: [], ambiguous: [] };
    const { result } = setupHook(mockThoughts, incompleteStructure);

    act(() => {
        result.current.setSortOrder('structure');
    });

    expect(result.current.sortOrder).toBe('structure');
    // Thought 1 first due to structure
    // Then by tag order: 2, 4 (main), 3 (conclusion)
    // Then non-structure tags by date: 6, 5
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['1', '2', '4', '3', '6', '5']);
  });

  it('should sort by date when sortOrder is "structure" but no thoughts have structure tags', () => {
    const structureStrings = ['Вступление','Основная часть','Заключение','Вступ','Основна частина','Висновок','Introduction','Main Part','Conclusion'];
    const thoughtsWithoutStructureTags = mockThoughts.filter(t =>
      !(t.tags || []).some(tag => structureStrings.includes(tag))
    );
    // Should only contain thoughts 5 and 6
    expect(thoughtsWithoutStructureTags.map(t => t.id)).toEqual(['5', '6']);

    const { result } = setupHook(thoughtsWithoutStructureTags, mockStructureEmpty);
    
    expect(result.current.hasStructureTags).toBe(false);

    act(() => {
      result.current.setSortOrder('structure');
    });

    expect(result.current.sortOrder).toBe('date'); // Should revert to date sort
    // Date sort for 5 and 6: 6 (newest), 5
    expect(result.current.filteredThoughts.map(t => t.id)).toEqual(['6', '5']);
  });
  
  it('should correctly update activeCount when initialThoughts prop changes', () => {
      // Initial render with full thoughts
      const { result: initialResult } = setupHook(mockThoughts, mockStructure);
      expect(initialResult.current.activeCount).toBe(6);
  
      // Simulate prop update by rendering the hook again with new props
      const fewerThoughts = mockThoughts.slice(0, 3);
      const { result: updatedResult } = setupHook(fewerThoughts, mockStructure); // Use fewerThoughts
  
      // Assert based on the result of the second render
      expect(updatedResult.current.activeCount).toBe(3); 
    });

    it('should correctly update activeCount when filters change', () => {
        // Separate test for filter changes affecting count
        const { result } = setupHook();
        expect(result.current.activeCount).toBe(6);

        act(() => {
            result.current.setStructureFilter(STRUCTURE_TAGS.CONCLUSION);
        });
        expect(result.current.activeCount).toBe(1);

        act(() => {
            result.current.resetFilters();
        });
        expect(result.current.activeCount).toBe(6);
    });

}); 