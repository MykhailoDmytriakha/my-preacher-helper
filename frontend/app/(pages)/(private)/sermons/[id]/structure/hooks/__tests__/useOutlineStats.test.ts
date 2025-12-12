import { renderHook } from '@testing-library/react';

import { Item, Sermon, SermonPoint } from '@/models/models';

import { useOutlineStats } from '../useOutlineStats';

describe('useOutlineStats', () => {
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    thoughts: [
      { id: 'thought-1', text: 'Test thought 1', tags: ['introduction'], date: new Date().toISOString() },
      { id: 'thought-2', text: 'Test thought 2', tags: ['main'], date: new Date().toISOString() },
      { id: 'thought-3', text: 'Test thought 3', tags: ['conclusion'], date: new Date().toISOString() },
      { id: 'thought-4', text: 'Test thought 4', tags: ['introduction'], date: new Date().toISOString() },
      { id: 'thought-5', text: 'Test thought 5', tags: ['main'], date: new Date().toISOString() },
    ],
    outline: {
      introduction: [
        { id: 'intro-1', text: 'Introduction point 1' },
        { id: 'intro-2', text: 'Introduction point 2' }
      ] as SermonPoint[],
      main: [
        { id: 'main-1', text: 'Main point 1' },
        { id: 'main-2', text: 'Main point 2' },
        { id: 'main-3', text: 'Main point 3' }
      ] as SermonPoint[],
      conclusion: [
        { id: 'conclusion-1', text: 'Conclusion point 1' }
      ] as SermonPoint[]
    }
  } as Sermon;

  const mockContainers: Record<string, Item[]> = {
    introduction: [
      { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
      { id: 'thought-4', content: 'Test thought 4', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-2' }
    ],
    main: [
      { id: 'thought-2', content: 'Test thought 2', requiredTags: ['main'], customTagNames: [], outlinePointId: 'main-1' },
      { id: 'thought-5', content: 'Test thought 5', requiredTags: ['main'], customTagNames: [], outlinePointId: 'main-2' }
    ],
    conclusion: [
      { id: 'thought-3', content: 'Test thought 3', requiredTags: ['conclusion'], customTagNames: [], outlinePointId: 'conclusion-1' }
    ],
    ambiguous: []
  };

  const defaultProps = {
    sermon: mockSermon,
    containers: mockContainers
  };

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useOutlineStats(defaultProps));

      expect(result.current.thoughtsPerSermonPoint).toBeDefined();
      expect(typeof result.current.thoughtsPerSermonPoint).toBe('object');
    });
  });

  describe('thoughtsPerSermonPoint calculation', () => {
    it('should calculate correct counts for introduction section', () => {
      const { result } = renderHook(() => useOutlineStats(defaultProps));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(1);
    });

    it('should calculate correct counts for main section', () => {
      const { result } = renderHook(() => useOutlineStats(defaultProps));

      expect(result.current.thoughtsPerSermonPoint['main-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['main-2']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['main-3']).toBe(0); // No thoughts assigned
    });

    it('should calculate correct counts for conclusion section', () => {
      const { result } = renderHook(() => useOutlineStats(defaultProps));

      expect(result.current.thoughtsPerSermonPoint['conclusion-1']).toBe(1);
    });

    it('should handle outline points with no thoughts', () => {
      const { result } = renderHook(() => useOutlineStats(defaultProps));

      // main-3 has no thoughts assigned
      expect(result.current.thoughtsPerSermonPoint['main-3']).toBe(0);
    });

    it('should handle multiple thoughts per outline point', () => {
      const containersWithMultipleThoughts = {
        ...mockContainers,
        introduction: [
          { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
          { id: 'thought-4', content: 'Test thought 4', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' }, // Same outline point
          { id: 'thought-6', content: 'Test thought 6', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-2' }
        ]
      };

      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: containersWithMultipleThoughts
      }));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(2);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle null sermon gracefully', () => {
      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        sermon: null
      }));

      expect(result.current.thoughtsPerSermonPoint).toEqual({});
    });

    it('should handle sermon without outline gracefully', () => {
      const sermonWithoutOutline = { ...mockSermon, outline: undefined };
      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        sermon: sermonWithoutOutline
      }));

      expect(result.current.thoughtsPerSermonPoint).toEqual({});
    });

    it('should handle sermon with empty outline gracefully', () => {
      const sermonWithEmptyOutline = {
        ...mockSermon,
        outline: {
          introduction: [],
          main: [],
          conclusion: []
        }
      };
      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        sermon: sermonWithEmptyOutline
      }));

      expect(result.current.thoughtsPerSermonPoint).toEqual({});
    });

    it('should handle empty containers gracefully', () => {
      const emptyContainers = {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: []
      };
      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: emptyContainers
      }));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['main-1']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['conclusion-1']).toBe(0);
    });

    it('should handle containers with missing sections gracefully', () => {
      const incompleteContainers = {
        introduction: mockContainers.introduction
        // Missing main and conclusion sections
      };
      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: incompleteContainers
      }));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['main-1']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['conclusion-1']).toBe(0);
    });
  });

  describe('thoughts without outline points', () => {
    it('should handle thoughts without outlinePointId', () => {
      const containersWithUnassignedThoughts = {
        ...mockContainers,
        introduction: [
          { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
          { id: 'thought-7', content: 'Test thought 7', requiredTags: ['introduction'], customTagNames: [] } // No outlinePointId
        ]
      };

      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: containersWithUnassignedThoughts
      }));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(0);
    });

    it('should handle thoughts with undefined outlinePointId', () => {
      const containersWithUndefinedSermonPoints = {
        ...mockContainers,
        introduction: [
          { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
          { id: 'thought-8', content: 'Test thought 8', requiredTags: ['introduction'], customTagNames: [], outlinePointId: undefined }
        ]
      };

      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: containersWithUndefinedSermonPoints
      }));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(0);
    });
  });

  describe('performance optimization', () => {
    it('should recalculate when sermon changes', () => {
      const { result, rerender } = renderHook(() => useOutlineStats(defaultProps));

      // Change sermon outline
      const newSermon = {
        ...mockSermon,
        outline: {
          ...mockSermon.outline,
          introduction: [
            { id: 'intro-1', text: 'New introduction point' }
          ]
        }
      };

      rerender({
        sermon: newSermon,
        containers: mockContainers
      });

      const secondResult = result.current.thoughtsPerSermonPoint;

      // Should have the expected values
      expect(secondResult['intro-1']).toBe(1);
    });

    it('should recalculate when containers change', () => {
      const { result, rerender } = renderHook(() => useOutlineStats(defaultProps));

      // Change containers
      const newContainers = {
        ...mockContainers,
        introduction: [
          { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' }
        ]
      };

      rerender({
        sermon: mockSermon,
        containers: newContainers
      });

      const secondResult = result.current.thoughtsPerSermonPoint;

      // Should have the expected values
      expect(secondResult['intro-1']).toBe(1);
    });
  });

  describe('complex scenarios', () => {
    it('should handle large numbers of outline points efficiently', () => {
      const largeOutline = {
        introduction: Array.from({ length: 100 }, (_, i) => ({
          id: `intro-${i}`,
          text: `Introduction point ${i}`
        })) as SermonPoint[],
        main: Array.from({ length: 50 }, (_, i) => ({
          id: `main-${i}`,
          text: `Main point ${i}`
        })) as SermonPoint[],
        conclusion: Array.from({ length: 25 }, (_, i) => ({
          id: `conclusion-${i}`,
          text: `Conclusion point ${i}`
        })) as SermonPoint[]
      };

      const largeSermon = { ...mockSermon, outline: largeOutline };
      const { result } = renderHook(() => useOutlineStats({
        sermon: largeSermon,
        containers: mockContainers
      }));

      // Should handle large numbers without performance issues
      expect(Object.keys(result.current.thoughtsPerSermonPoint)).toHaveLength(175);
      expect(result.current.thoughtsPerSermonPoint['intro-0']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['main-0']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['conclusion-0']).toBe(0);
    });

    it('should handle thoughts with multiple outline point assignments', () => {
      // This is an edge case that shouldn't happen in normal usage
      // but we should handle it gracefully
      const containersWithMultipleAssignments = {
        ...mockContainers,
        introduction: [
          { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
          { id: 'thought-9', content: 'Test thought 9', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
          { id: 'thought-10', content: 'Test thought 10', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' }
        ]
      };

      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: containersWithMultipleAssignments
      }));

      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(3);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(0);
    });
  });

  describe('data consistency', () => {
    it('should maintain consistency between sermon outline and container data', () => {
      const { result } = renderHook(() => useOutlineStats(defaultProps));

      // Verify that all outline points from sermon are represented
      expect(result.current.thoughtsPerSermonPoint).toHaveProperty('intro-1');
      expect(result.current.thoughtsPerSermonPoint).toHaveProperty('intro-2');
      expect(result.current.thoughtsPerSermonPoint).toHaveProperty('main-1');
      expect(result.current.thoughtsPerSermonPoint).toHaveProperty('main-2');
      expect(result.current.thoughtsPerSermonPoint).toHaveProperty('main-3');
      expect(result.current.thoughtsPerSermonPoint).toHaveProperty('conclusion-1');

      // Verify that counts match actual assignments
      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['main-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['main-2']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['main-3']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['conclusion-1']).toBe(1);
    });

    it('should handle missing outline points gracefully', () => {
      const containersWithMissingSermonPoints = {
        ...mockContainers,
        introduction: [
          { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'intro-1' },
          { id: 'thought-11', content: 'Test thought 11', requiredTags: ['introduction'], customTagNames: [], outlinePointId: 'non-existent-point' }
        ]
      };

      const { result } = renderHook(() => useOutlineStats({
        ...defaultProps,
        containers: containersWithMissingSermonPoints
      }));

      // Should only count valid outline points
      expect(result.current.thoughtsPerSermonPoint['intro-1']).toBe(1);
      expect(result.current.thoughtsPerSermonPoint['intro-2']).toBe(0);
      expect(result.current.thoughtsPerSermonPoint['non-existent-point']).toBeUndefined();
    });
  });
});
