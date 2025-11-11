import { isStructureChanged, dedupeIds, ensureUniqueItems, removeIdFromOtherSections, calculateGroupPosition } from '../structure';
import { Item, Structure } from '@/models/models';
import { runScenarios } from '@test-utils/scenarioRunner';

describe('Structure Utilities', () => {
  describe('isStructureChanged', () => {
    const baseStructure: Structure = {
      introduction: ['thought-1', 'thought-2'],
      main: ['thought-3', 'thought-4'],
      conclusion: ['thought-5'],
      ambiguous: [],
    };

    it('evaluates structural deltas without spawning dozens of Jest tests', async () => {
      const emptyStructure: Structure = { introduction: [], main: [], conclusion: [], ambiguous: [] };
      const baseJson = JSON.stringify(baseStructure);

      await runScenarios([
        {
          name: 'identical structures remain unchanged',
          run: () => expect(isStructureChanged(baseStructure, baseStructure)).toBe(false),
        },
        {
          name: 'introduction difference',
          run: () =>
            expect(
              isStructureChanged(baseStructure, { ...baseStructure, introduction: ['thought-1', 'thought-3'] }),
            ).toBe(true),
        },
        {
          name: 'main difference',
          run: () =>
            expect(isStructureChanged(baseStructure, { ...baseStructure, main: ['thought-3'] })).toBe(true),
        },
        {
          name: 'conclusion difference',
          run: () =>
            expect(
              isStructureChanged(baseStructure, { ...baseStructure, conclusion: ['thought-5', 'thought-6'] }),
            ).toBe(true),
        },
        {
          name: 'ambiguous difference',
          run: () =>
            expect(isStructureChanged(baseStructure, { ...baseStructure, ambiguous: ['thought-7'] })).toBe(true),
        },
        {
          name: 'stringified previous structure',
          run: () => expect(isStructureChanged(baseJson, baseStructure)).toBe(false),
        },
        {
          name: 'stringified new structure',
          run: () => expect(isStructureChanged(baseStructure, baseJson)).toBe(false),
        },
        {
          name: 'both string inputs',
          run: () => expect(isStructureChanged(baseJson, baseJson)).toBe(false),
        },
        {
          name: 'empty structures stay equal',
          run: () => expect(isStructureChanged(emptyStructure, emptyStructure)).toBe(false),
        },
        {
          name: 'empty to populated signals change',
          run: () => expect(isStructureChanged(emptyStructure, baseStructure)).toBe(true),
        },
        {
          name: 'populated to empty signals change',
          run: () => expect(isStructureChanged(baseStructure, emptyStructure)).toBe(true),
        },
        {
          name: 'partial structures detected',
          run: () => expect(isStructureChanged(baseStructure, { introduction: ['thought-1'] } as any)).toBe(true),
        },
        {
          name: 'null/undefined do not throw',
          run: () => {
            expect(() => isStructureChanged(null as any, baseStructure)).not.toThrow();
            expect(() => isStructureChanged(baseStructure, undefined as any)).not.toThrow();
            expect(() => isStructureChanged(null as any, null as any)).not.toThrow();
          },
        },
      ]);
    });
  });

  describe('dedupeIds', () => {
    it('covers all permutations in one batch', async () => {
      await runScenarios([
        {
          name: 'duplicate removal with preserved order',
          run: () => {
            expect(dedupeIds(['thought-1', 'thought-2', 'thought-1', 'thought-3', 'thought-2'])).toEqual([
              'thought-1',
              'thought-2',
              'thought-3',
            ]);
            expect(dedupeIds(['thought-3', 'thought-1', 'thought-2', 'thought-1', 'thought-3'])).toEqual([
              'thought-3',
              'thought-1',
              'thought-2',
            ]);
          },
        },
        {
          name: 'edge cases remain stable',
          run: () => {
            expect(dedupeIds([])).toEqual([]);
            expect(dedupeIds(['thought-1'])).toEqual(['thought-1']);
            const ids = ['thought-1', 'thought-2', 'thought-3'];
            expect(dedupeIds(ids)).toEqual(ids);
            expect(dedupeIds(['thought-1', 'thought-1', 'thought-1'])).toEqual(['thought-1']);
          },
        },
        {
          name: 'mixed value types',
          run: () => {
            expect(dedupeIds(['thought-1', 123, 'thought-2', 'thought-1', null, 'thought-2'] as any)).toEqual([
              'thought-1',
              123,
              'thought-2',
              null,
            ]);
          },
        },
      ]);
    });
  });

  describe('ensureUniqueItems', () => {
    const baseItems: Item[] = [
      { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
      { id: 'thought-2', content: 'Test 2', requiredTags: ['main'], customTagNames: [] },
      { id: 'thought-3', content: 'Test 3', requiredTags: ['conclusion'], customTagNames: [] },
    ];

    it('handles deduplication scenarios in one go', async () => {
      await runScenarios([
        {
          name: 'duplicate ids collapse to first occurrence',
          run: () => {
            const duplicateItems: Item[] = [
              ...baseItems,
              { id: 'thought-1', content: 'Duplicate 1', requiredTags: ['introduction'], customTagNames: [] },
              { id: 'thought-2', content: 'Duplicate 2', requiredTags: ['main'], customTagNames: [] },
            ];
            const result = ensureUniqueItems(duplicateItems);
            expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
            expect(result).toEqual(expect.arrayContaining(baseItems));
          },
        },
        {
          name: 'edge cases (empty, single, already unique)',
          run: () => {
            expect(ensureUniqueItems([])).toEqual([]);
            expect(ensureUniqueItems([baseItems[0]])).toEqual([baseItems[0]]);
            expect(ensureUniqueItems(baseItems)).toEqual(baseItems);
          },
        },
        {
          name: 'all duplicates collapse to single entry',
          run: () => {
            const duplicates: Item[] = [
              { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
              { id: 'thought-1', content: 'Copy', requiredTags: ['introduction'], customTagNames: [] },
              { id: 'thought-1', content: 'Another Copy', requiredTags: ['introduction'], customTagNames: [] },
            ];
            const result = ensureUniqueItems(duplicates);
            expect(result).toHaveLength(1);
            expect(result[0].content).toBe('Test 1');
            expect(result[0].requiredTags).toEqual(['introduction']);
          },
        },
      ]);
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

    it('consolidates cross-section cleanup checks', async () => {
      await runScenarios([
        {
          name: 'removes duplicates from other sections only',
          run: () => {
            const result = removeIdFromOtherSections(baseContainers, 'introduction', 'thought-1');
            expect(result.main).not.toContainEqual(expect.objectContaining({ id: 'thought-1' }));
            expect(result.introduction).toContainEqual(expect.objectContaining({ id: 'thought-1' }));
            expect(result.conclusion).toEqual(baseContainers.conclusion);
          },
        },
        {
          name: 'no-op when target id is isolated',
          run: () => {
            expect(removeIdFromOtherSections(baseContainers, 'introduction', 'thought-2')).toEqual(baseContainers);
          },
        },
        {
          name: 'removes from multiple sections',
          run: () => {
            const containersWithDuplicates: Record<string, Item[]> = {
              ...baseContainers,
              conclusion: [{ id: 'thought-1', content: 'Test 1', requiredTags: ['conclusion'], customTagNames: [] }],
            };
            const result = removeIdFromOtherSections(containersWithDuplicates, 'introduction', 'thought-1');
            expect(result.main).not.toContainEqual(expect.objectContaining({ id: 'thought-1' }));
            expect(result.conclusion).toHaveLength(0);
          },
        },
        {
          name: 'handles empty or missing sections',
          run: () => {
            const emptyContainers = { introduction: [], main: [], conclusion: [], ambiguous: [] };
            expect(removeIdFromOtherSections(emptyContainers, 'introduction', 'thought-1')).toEqual(emptyContainers);

            const incompleteContainers = { introduction: baseContainers.introduction };
            const result = removeIdFromOtherSections(incompleteContainers, 'introduction', 'thought-1');
            expect(result.introduction).toEqual(baseContainers.introduction);
          },
        },
        {
          name: 'does not mutate source containers',
          run: () => {
            const original = JSON.parse(JSON.stringify(baseContainers));
            removeIdFromOtherSections(baseContainers, 'introduction', 'thought-1');
            expect(baseContainers).toEqual(original);
          },
        },
      ]);
    });
  });

  describe('calculateGroupPosition', () => {
    it('checks positional math in a single test', async () => {
      const trio = [
        { id: 'item-1', content: 'Item 1', position: 1000 },
        { id: 'item-2', content: 'Item 2', position: 2000 },
        { id: 'item-3', content: 'Item 3', position: 3000 },
      ];

      await runScenarios([
        {
          name: 'first/middle/last items return their positions',
          run: () => {
            expect(calculateGroupPosition(trio, 'item-1')).toBe(1000);
            expect(calculateGroupPosition(trio, 'item-2')).toBe(2000);
            expect(calculateGroupPosition(trio, 'item-3')).toBe(3000);
          },
        },
        {
          name: 'missing ids return -1',
          run: () => {
            expect(calculateGroupPosition(trio, 'item-4')).toBe(-1);
            expect(calculateGroupPosition([], 'item-1')).toBe(-1);
          },
        },
        {
          name: 'single item arrays and malformed entries',
          run: () => {
            expect(calculateGroupPosition([{ id: 'item-1', content: 'Item 1', position: 1000 }], 'item-1')).toBe(1000);
            expect(calculateGroupPosition([{ content: 'Item 1' }] as any, 'item-1')).toBe(-1);
          },
        },
        {
          name: 'null/undefined ids do not throw',
          run: () => {
            expect(() => calculateGroupPosition(trio, null as any)).not.toThrow();
            expect(() => calculateGroupPosition(trio, undefined as any)).not.toThrow();
          },
        },
      ]);
    });
  });

  describe('integration scenarios', () => {
    it('walks through combined flows once', () => {
      const containersWithDuplicates: Record<string, Item[]> = {
        introduction: [{ id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] }],
        main: [
          { id: 'thought-1', content: 'Test 1', requiredTags: ['main'], customTagNames: [] },
          { id: 'thought-2', content: 'Test 2', requiredTags: ['main'], customTagNames: [] },
        ],
        conclusion: [],
        ambiguous: [],
      };

      const uniqueContainers = {
        introduction: ensureUniqueItems(containersWithDuplicates.introduction),
        main: ensureUniqueItems(containersWithDuplicates.main),
        conclusion: ensureUniqueItems(containersWithDuplicates.conclusion),
        ambiguous: ensureUniqueItems(containersWithDuplicates.ambiguous),
      };

      const cleanedContainers = removeIdFromOtherSections(uniqueContainers, 'introduction', 'thought-1');

      const originalStructure: Structure = {
        introduction: ['thought-1'],
        main: ['thought-1', 'thought-2'],
        conclusion: [],
        ambiguous: [],
      };

      const newStructure: Structure = {
        introduction: ['thought-1'],
        main: ['thought-2'],
        conclusion: [],
        ambiguous: [],
      };

      expect(isStructureChanged(originalStructure, newStructure)).toBe(true);
      expect(calculateGroupPosition(cleanedContainers.introduction, 'thought-1')).toBe(1000);
      expect(calculateGroupPosition(cleanedContainers.main, 'thought-2')).toBe(1000);

      const complexContainers: Record<string, Item[]> = {
        introduction: [
          { id: 'thought-1', content: 'Test 1', requiredTags: ['introduction'], customTagNames: [] },
          { id: 'thought-2', content: 'Test 2', requiredTags: ['introduction'], customTagNames: [] },
        ],
        main: [
          { id: 'thought-1', content: 'Test 1 Copy', requiredTags: ['main'], customTagNames: [] },
          { id: 'thought-3', content: 'Test 3', requiredTags: ['main'], customTagNames: [] },
          { id: 'thought-2', content: 'Test 2 Copy', requiredTags: ['main'], customTagNames: [] },
        ],
        conclusion: [{ id: 'thought-1', content: 'Test 1 Another Copy', requiredTags: ['conclusion'], customTagNames: [] }],
        ambiguous: [],
      };

      let cleaned = removeIdFromOtherSections(complexContainers, 'introduction', 'thought-1');
      cleaned = removeIdFromOtherSections(cleaned, 'introduction', 'thought-2');
      expect(cleaned.introduction).toHaveLength(2);
      expect(cleaned.main).toHaveLength(1);
      expect(cleaned.conclusion).toHaveLength(0);
      expect(calculateGroupPosition(cleaned.main, 'thought-3')).toBe(1000);
    });
  });
});
