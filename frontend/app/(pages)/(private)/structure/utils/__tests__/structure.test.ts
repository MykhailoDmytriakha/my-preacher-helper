import {
  isStructureChanged,
  dedupeIds,
  ensureUniqueItems,
  removeIdFromOtherSections,
  calculateGroupPosition
} from '../structure';
import { Item, Structure } from '@/models/models';

describe('Structure Utilities', () => {
  describe('isStructureChanged', () => {
    const baseStructure: Structure = {
      introduction: ['thought-1', 'thought-2'],
      main: ['thought-3', 'thought-4'],
      conclusion: ['thought-5'],
      ambiguous: []
    };

    it('should detect no changes when structures are identical', () => {
      const result = isStructureChanged(baseStructure, baseStructure);
      expect(result).toBe(false);
    });

    it('should detect changes when introduction section differs', () => {
      const modifiedStructure: Structure = {
        ...baseStructure,
        introduction: ['thought-1', 'thought-3'] // Different order
      };
      const result = isStructureChanged(baseStructure, modifiedStructure);
      expect(result).toBe(true);
    });

    it('should detect changes when main section differs', () => {
      const modifiedStructure: Structure = {
        ...baseStructure,
        main: ['thought-3'] // Removed thought-4
      };
      const result = isStructureChanged(baseStructure, modifiedStructure);
      expect(result).toBe(true);
    });

    it('should detect changes when conclusion section differs', () => {
      const modifiedStructure: Structure = {
        ...baseStructure,
        conclusion: ['thought-5', 'thought-6'] // Added thought-6
      };
      const result = isStructureChanged(baseStructure, modifiedStructure);
      expect(result).toBe(true);
    });

    it('should detect changes when ambiguous section differs', () => {
      const modifiedStructure: Structure = {
        ...baseStructure,
        ambiguous: ['thought-7'] // Added thought-7
      };
      const result = isStructureChanged(baseStructure, modifiedStructure);
      expect(result).toBe(true);
    });

    it('should handle string input for previous structure', () => {
      const previousStructureString = JSON.stringify(baseStructure);
      const result = isStructureChanged(previousStructureString, baseStructure);
      expect(result).toBe(false);
    });

    it('should handle string input for new structure', () => {
      const newStructureString = JSON.stringify(baseStructure);
      const result = isStructureChanged(baseStructure, newStructureString);
      expect(result).toBe(false);
    });

    it('should handle both string inputs', () => {
      const previousStructureString = JSON.stringify(baseStructure);
      const newStructureString = JSON.stringify(baseStructure);
      const result = isStructureChanged(previousStructureString, newStructureString);
      expect(result).toBe(false);
    });

    it('should handle empty structures', () => {
      const emptyStructure: Structure = {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: []
      };
      const result = isStructureChanged(emptyStructure, emptyStructure);
      expect(result).toBe(false);
    });

    it('should detect changes from empty to populated structure', () => {
      const emptyStructure: Structure = {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: []
      };
      const result = isStructureChanged(emptyStructure, baseStructure);
      expect(result).toBe(true);
    });

    it('should detect changes from populated to empty structure', () => {
      const emptyStructure: Structure = {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: []
      };
      const result = isStructureChanged(baseStructure, emptyStructure);
      expect(result).toBe(true);
    });

    it('should handle partial structure objects', () => {
      const partialStructure = {
        introduction: ['thought-1']
      };
      const result = isStructureChanged(baseStructure, partialStructure as any);
      expect(result).toBe(true);
    });

    it('should handle null and undefined gracefully', () => {
      expect(() => isStructureChanged(null as any, baseStructure)).not.toThrow();
      expect(() => isStructureChanged(baseStructure, undefined as any)).not.toThrow();
      expect(() => isStructureChanged(null as any, null as any)).not.toThrow();
    });
  });

  describe('dedupeIds', () => {
    it('should remove duplicate IDs from array', () => {
      const ids = ['thought-1', 'thought-2', 'thought-1', 'thought-3', 'thought-2'];
      const result = dedupeIds(ids);
      expect(result).toEqual(['thought-1', 'thought-2', 'thought-3']);
    });

    it('should preserve order of first occurrence', () => {
      const ids = ['thought-3', 'thought-1', 'thought-2', 'thought-1', 'thought-3'];
      const result = dedupeIds(ids);
      expect(result).toEqual(['thought-3', 'thought-1', 'thought-2']);
    });

    it('should handle empty array', () => {
      const result = dedupeIds([]);
      expect(result).toEqual([]);
    });

    it('should handle array with single item', () => {
      const result = dedupeIds(['thought-1']);
      expect(result).toEqual(['thought-1']);
    });

    it('should handle array with no duplicates', () => {
      const ids = ['thought-1', 'thought-2', 'thought-3'];
      const result = dedupeIds(ids);
      expect(result).toEqual(ids);
    });

    it('should handle array with all duplicates', () => {
      const ids = ['thought-1', 'thought-1', 'thought-1'];
      const result = dedupeIds(ids);
      expect(result).toEqual(['thought-1']);
    });

    it('should handle mixed types gracefully', () => {
      const ids = ['thought-1', 123, 'thought-2', 'thought-1', null, 'thought-2'];
      const result = dedupeIds(ids as any);
      expect(result).toEqual(['thought-1', 123, 'thought-2', null]);
    });
  });

  describe('ensureUniqueItems', () => {
    const baseItems: Item[] = [
      { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
      { id: 'thought-2', content: 'Test 2', requiredTags: ['main'], customTagNames: [] },
      { id: 'thought-3', content: 'Test 3', requiredTags: ['conclusion'], customTagNames: [] }
    ];

    it('should ensure all items have unique IDs', () => {
      const duplicateItems: Item[] = [
        ...baseItems,
        { id: 'thought-1', content: 'Duplicate 1', requiredTags: ['introduction'], customTagNames: [] },
        { id: 'thought-2', content: 'Duplicate 2', requiredTags: ['main'], customTagNames: [] }
      ];
      const result = ensureUniqueItems(duplicateItems);
      
      // Should have unique IDs
      const ids = result.map(item => item.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
      
      // Should preserve original items
      expect(result).toContainEqual(baseItems[0]);
      expect(result).toContainEqual(baseItems[1]);
      expect(result).toContainEqual(baseItems[2]);
    });

    it('should handle empty array', () => {
      const result = ensureUniqueItems([]);
      expect(result).toEqual([]);
    });

    it('should handle array with single item', () => {
      const result = ensureUniqueItems([baseItems[0]]);
      expect(result).toEqual([baseItems[0]]);
    });

    it('should handle array with no duplicates', () => {
      const result = ensureUniqueItems(baseItems);
      expect(result).toEqual(baseItems);
    });

    it('should handle array with all duplicates', () => {
      const duplicateItems: Item[] = [
        { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
        { id: 'thought-1', content: 'Test 1 Copy', requiredTags: ['introduction'], customTagNames: [] },
        { id: 'thought-1', content: 'Test 1 Another Copy', requiredTags: ['introduction'], customTagNames: [] }
      ];
      const result = ensureUniqueItems(duplicateItems);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thought-1');
    });

    it('should preserve item properties when deduplicating', () => {
      const duplicateItems: Item[] = [
        { id: 'thought-1', content: 'Original', requiredTags: ['introduction'], customTagNames: [] },
        { id: 'thought-1', content: 'Modified', requiredTags: ['main'], customTagNames: ['custom-tag'] }
      ];
      const result = ensureUniqueItems(duplicateItems);
      expect(result).toHaveLength(1);
      // Should preserve the first occurrence
      expect(result[0].content).toBe('Original');
      expect(result[0].requiredTags).toEqual(['introduction']);
    });
  });

  describe('removeIdFromOtherSections', () => {
    const baseContainers: Record<string, Item[]> = {
      introduction: [
        { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
        { id: 'thought-2', content: 'Test 2', requiredTags: ['introduction'], customTagNames: [] }
      ],
      main: [
        { id: 'thought-3', content: 'Test 3', requiredTags: ['main'], customTagNames: [] },
        { id: 'thought-1', content: 'Test 1', requiredTags: ['main'], customTagNames: [] } // Duplicate
      ],
      conclusion: [
        { id: 'thought-4', content: 'Test 4', requiredTags: ['conclusion'], customTagNames: [] }
      ],
      ambiguous: []
    };

    it('should remove item ID from other sections', () => {
      const result = removeIdFromOtherSections(baseContainers, 'introduction', 'thought-1');
      
      // thought-1 should be removed from main section
      expect(result.main).not.toContainEqual(
        expect.objectContaining({ id: 'thought-1' })
      );
      
      // thought-1 should remain in introduction section
      expect(result.introduction).toContainEqual(
        expect.objectContaining({ id: 'thought-1' })
      );
      
      // Other sections should be unchanged
      expect(result.conclusion).toEqual(baseContainers.conclusion);
      expect(result.ambiguous).toEqual(baseContainers.ambiguous);
    });

    it('should handle item not present in other sections', () => {
      const result = removeIdFromOtherSections(baseContainers, 'introduction', 'thought-2');
      
      // thought-2 is only in introduction, so no changes
      expect(result).toEqual(baseContainers);
    });

    it('should handle item present in multiple other sections', () => {
      const containersWithMultipleDuplicates: Record<string, Item[]> = {
        ...baseContainers,
        conclusion: [
          { id: 'thought-1', content: 'Test 1', requiredTags: ['conclusion'], customTagNames: [] } // Another duplicate
        ]
      };
      
      const result = removeIdFromOtherSections(containersWithMultipleDuplicates, 'introduction', 'thought-1');
      
      // thought-1 should be removed from both main and conclusion
      expect(result.main).not.toContainEqual(
        expect.objectContaining({ id: 'thought-1' })
      );
      expect(result.conclusion).not.toContainEqual(
        expect.objectContaining({ id: 'thought-1' })
      );
      
      // thought-1 should remain in introduction
      expect(result.introduction).toContainEqual(
        expect.objectContaining({ id: 'thought-1' })
      );
    });

    it('should handle empty sections', () => {
      const containersWithEmptySections: Record<string, Item[]> = {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: []
      };
      
      const result = removeIdFromOtherSections(containersWithEmptySections, 'introduction', 'thought-1');
      expect(result).toEqual(containersWithEmptySections);
    });

    it('should handle missing sections gracefully', () => {
      const incompleteContainers = {
        introduction: baseContainers.introduction
        // Missing main, conclusion, ambiguous
      };
      
      const result = removeIdFromOtherSections(incompleteContainers, 'introduction', 'thought-1');
      expect(result.introduction).toEqual(baseContainers.introduction);
    });

    it('should not modify original containers', () => {
      const originalContainers = JSON.parse(JSON.stringify(baseContainers));
      removeIdFromOtherSections(baseContainers, 'introduction', 'thought-1');
      expect(baseContainers).toEqual(originalContainers);
    });
  });

  describe('calculateGroupPosition', () => {
    it('should calculate position for item in middle of group', () => {
      const items = [
        { id: 'item-1', content: 'Item 1', position: 1000 },
        { id: 'item-2', content: 'Item 2', position: 2000 },
        { id: 'item-3', content: 'Item 3', position: 3000 }
      ];
      const targetId = 'item-2';
      const result = calculateGroupPosition(items, targetId);
      expect(result).toBe(2000); // Current position is already correct
    });

    it('should calculate position for first item', () => {
      const items = [
        { id: 'item-1', content: 'Item 1', position: 1000 },
        { id: 'item-2', content: 'Item 2', position: 2000 }
      ];
      const targetId = 'item-1';
      const result = calculateGroupPosition(items, targetId);
      expect(result).toBe(1000); // Current position is already correct
    });

    it('should calculate position for last item', () => {
      const items = [
        { id: 'item-1', content: 'Item 1', position: 1000 },
        { id: 'item-2', content: 'Item 2', position: 2000 },
        { id: 'item-3', content: 'Item 3', position: 3000 }
      ];
      const targetId = 'item-3';
      const result = calculateGroupPosition(items, targetId);
      expect(result).toBe(3000); // Current position is already correct
    });

    it('should return -1 for item not found', () => {
      const items = [
        { id: 'item-1', content: 'Item 1', position: 1000 },
        { id: 'item-2', content: 'Item 2', position: 2000 }
      ];
      const targetId = 'item-3';
      const result = calculateGroupPosition(items, targetId);
      expect(result).toBe(-1);
    });

    it('should handle empty array', () => {
      const result = calculateGroupPosition([], 'item-1');
      expect(result).toBe(-1);
    });

    it('should handle single item array', () => {
      const items = [{ id: 'item-1', content: 'Item 1', position: 1000 }];
      const result = calculateGroupPosition(items, 'item-1');
      expect(result).toBe(1000); // Default position when no neighbors
    });

    it('should handle items without id property gracefully', () => {
      const items = [
        { content: 'Item 1' },
        { content: 'Item 2' }
      ] as any;
      
      const result = calculateGroupPosition(items, 'item-1');
      expect(result).toBe(-1);
    });

    it('should handle null and undefined gracefully', () => {
      const items = [
        { id: 'item-1', content: 'Item 1', position: 1000 },
        { id: 'item-2', content: 'Item 2', position: 2000 }
      ];
      
      expect(() => calculateGroupPosition(items, null as any)).not.toThrow();
      expect(() => calculateGroupPosition(items, undefined as any)).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should work together in a complete workflow', () => {
      // 1. Start with containers that have duplicates
      const containersWithDuplicates: Record<string, Item[]> = {
        introduction: [
          { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] }
        ],
        main: [
          { id: 'thought-1', content: 'Test 1', requiredTags: ['main'], customTagNames: [] }, // Duplicate
          { id: 'thought-2', content: 'Test 2', requiredTags: ['main'], customTagNames: [] }
        ],
        conclusion: [],
        ambiguous: []
      };

      // 2. Ensure unique items
      const uniqueContainers = {
        introduction: ensureUniqueItems(containersWithDuplicates.introduction),
        main: ensureUniqueItems(containersWithDuplicates.main),
        conclusion: ensureUniqueItems(containersWithDuplicates.conclusion),
        ambiguous: ensureUniqueItems(containersWithDuplicates.ambiguous)
      };

      // 3. Remove duplicates from other sections
      const cleanedContainers = removeIdFromOtherSections(uniqueContainers, 'introduction', 'thought-1');

      // 4. Check if structure changed
      const originalStructure: Structure = {
        introduction: ['thought-1'],
        main: ['thought-1', 'thought-2'],
        conclusion: [],
        ambiguous: []
      };

      const newStructure: Structure = {
        introduction: ['thought-1'],
        main: ['thought-2'], // thought-1 removed
        conclusion: [],
        ambiguous: []
      };

      const hasChanged = isStructureChanged(originalStructure, newStructure);
      expect(hasChanged).toBe(true);

      // 5. Calculate positions
      const thought1Position = calculateGroupPosition(cleanedContainers.introduction, 'thought-1');
      const thought2Position = calculateGroupPosition(cleanedContainers.main, 'thought-2');

      expect(thought1Position).toBe(1000); // Default position when no neighbors
      expect(thought2Position).toBe(1000); // Default position when no neighbors
    });

    it('should handle complex deduplication scenarios', () => {
      const complexContainers: Record<string, Item[]> = {
        introduction: [
          { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
          { id: 'thought-2', content: 'Test 2', requiredTags: ['introduction'], customTagNames: [] }
        ],
        main: [
          { id: 'thought-1', content: 'Test 1 Copy', requiredTags: ['main'], customTagNames: [] },
          { id: 'thought-3', content: 'Test 3', requiredTags: ['main'], customTagNames: [] },
          { id: 'thought-2', content: 'Test 2 Copy', requiredTags: ['main'], customTagNames: [] }
        ],
        conclusion: [
          { id: 'thought-1', content: 'Test 1 Another Copy', requiredTags: ['conclusion'], customTagNames: [] }
        ],
        ambiguous: []
      };

      // Remove thought-1 from all sections except introduction
      let cleanedContainers = removeIdFromOtherSections(complexContainers, 'introduction', 'thought-1');
      
      // Remove thought-2 from all sections except introduction
      cleanedContainers = removeIdFromOtherSections(cleanedContainers, 'introduction', 'thought-2');

      // Check results
      expect(cleanedContainers.introduction).toHaveLength(2);
      expect(cleanedContainers.main).toHaveLength(1); // Only thought-3 remains
      expect(cleanedContainers.conclusion).toHaveLength(0); // thought-1 removed
      expect(cleanedContainers.ambiguous).toHaveLength(0);

      // Verify thought-3 position
      const thought3Position = calculateGroupPosition(cleanedContainers.main, 'thought-3');
      expect(thought3Position).toBe(1000); // Default position when no neighbors
    });
  });
});
