import {
  createNodeId,
  createNewNode,
  syncDraftTitles,
  mergeDraftTitles,
  removeNode,
  addChildNode,
  addSiblingNode,
  areTreesEqual
} from '@/components/sermon/prep/exegeticalPlan/treeUtils';
import type { ExegeticalPlanNode } from '@/models/models';

describe('treeUtils', () => {
  describe('createNodeId', () => {
    it('generates unique string IDs in a single test', () => {
      const id1 = createNodeId();
      const id2 = createNodeId();
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);
    });
  });

  describe('createNewNode', () => {
    it('creates nodes with required props and unique ids', () => {
      const node = createNewNode();
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('title');
      expect(node).toHaveProperty('children');

      const node2 = createNewNode();
      expect(node.id).not.toBe(node2.id);
    });
  });

  describe('syncDraftTitles', () => {
    it('syncs both flat and nested trees within one test', () => {
      const flat = syncDraftTitles([
        { id: '1', title: 'Node 1', children: [] },
        { id: '2', title: 'Node 2', children: [] },
      ]);
      expect(flat).toEqual({ '1': 'Node 1', '2': 'Node 2' });

      const nested = syncDraftTitles([{ id: '1', title: 'Parent', children: [{ id: '1a', title: 'Child', children: [] }] }]);
      expect(nested).toEqual({ '1': 'Parent', '1a': 'Child' });
    });
  });

  describe('mergeDraftTitles', () => {
    it('merges drafts for flat and nested trees without mutation', () => {
      const flatNodes: ExegeticalPlanNode[] = [{ id: '1', title: 'Old Title', children: [] }];
      const mergedFlat = mergeDraftTitles(flatNodes, { '1': 'New Title' });
      expect(mergedFlat[0].title).toBe('New Title');

      const nestedNodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent Old', children: [{ id: '1a', title: 'Child Old', children: [] }] },
      ];
      const mergedNested = mergeDraftTitles(nestedNodes, { '1': 'Parent New', '1a': 'Child New' });
      expect(mergedNested[0].children![0].title).toBe('Child New');

      const immutableSource: ExegeticalPlanNode[] = [{ id: '2', title: 'Original', children: [] }];
      const copy = JSON.parse(JSON.stringify(immutableSource));
      mergeDraftTitles(immutableSource, { '2': 'Updated' });
      expect(immutableSource).toEqual(copy);
    });
  });

  describe('removeNode', () => {
    it('handles root, nested, empty, and missing cases in one test', () => {
      const rootNodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node 1', children: [] },
        { id: '2', title: 'Node 2', children: [] },
      ];
      expect(removeNode(rootNodes, '1')[0].id).toBe('2');

      const nestedNodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent', children: [{ id: '1a', title: 'Child A', children: [] }, { id: '1b', title: 'Child B', children: [] }] },
      ];
      const nestedResult = removeNode(nestedNodes, '1a');
      expect(nestedResult[0].children).toHaveLength(1);

      expect(removeNode([{ id: 'only', title: 'Only', children: [] }], 'only')).toEqual([]);

      const deepNodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Level 1', children: [{ id: '2', title: 'Level 2', children: [{ id: '3', title: 'Level 3', children: [] }] }] },
      ];
      expect(removeNode(deepNodes, '3')[0].children![0].children).toHaveLength(0);

      const unchanged = removeNode([{ id: '1', title: 'Node 1', children: [] }], 'non-existent');
      expect(unchanged).toHaveLength(1);
    });
  });

  describe('addChildNode', () => {
    it('adds children for root, nested, and missing parents in one test', () => {
      const base: ExegeticalPlanNode[] = [{ id: '1', title: 'Parent', children: [] }];
      let result = addChildNode(base, '1', { id: '1a', title: 'Child', children: [] });
      expect(result[0].children).toHaveLength(1);

      const withExisting: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent', children: [{ id: '1a', title: 'Existing Child', children: [] }] },
      ];
      result = addChildNode(withExisting, '1', { id: '1b', title: 'New', children: [] });
      expect(result[0].children).toHaveLength(2);

      const nested: ExegeticalPlanNode[] = [{ id: '1', title: 'L1', children: [{ id: '2', title: 'L2', children: [] }] }];
      result = addChildNode(nested, '2', { id: '3', title: 'L3', children: [] });
      expect(result[0].children![0].children).toHaveLength(1);

      const unchanged = addChildNode([{ id: 'x', title: 'Node', children: [] }], 'missing', { id: 'y', title: 'Child', children: [] });
      expect(unchanged).toEqual([{ id: 'x', title: 'Node', children: [] }]);
    });
  });

  describe('addSiblingNode', () => {
    it('inserts siblings in root and nested lists', () => {
      const rootNodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node 1', children: [] },
        { id: '2', title: 'Node 2', children: [] },
      ];
      let result = addSiblingNode(rootNodes, '1', { id: '1a', title: 'Sibling', children: [] });
      expect(result.map((n) => n.id)).toEqual(['1', '1a', '2']);
      result = addSiblingNode(rootNodes, '2', { id: '3', title: 'Third', children: [] });
      expect(result.map((n) => n.id)).toEqual(['1', '2', '3']);

      const nestedNodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent', children: [{ id: '1a', title: 'Child A', children: [] }] },
      ];
      result = addSiblingNode(nestedNodes, '1a', { id: '1b', title: 'Child B', children: [] });
      expect(result[0].children?.map((n) => n.id)).toEqual(['1a', '1b']);

      const deepNodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'L1',
          children: [{ id: '2', title: 'L2', children: [{ id: '3', title: 'L3', children: [] }] }],
        },
      ];
      result = addSiblingNode(deepNodes, '3', { id: '4', title: 'L3 Sibling', children: [] });
      expect(result[0].children![0].children?.map((n) => n.id)).toEqual(['3', '4']);
    });
  });

  describe('areTreesEqual', () => {
    it('evaluates equality across multiple scenarios', () => {
      expect(areTreesEqual([{ id: '1', title: 'Node', children: [] }], [{ id: '1', title: 'Node', children: [] }])).toBe(true);
      expect(areTreesEqual([{ id: '1', title: 'A', children: [] }], [{ id: '1', title: 'B', children: [] }])).toBe(false);
      expect(areTreesEqual([{ id: '1', title: 'Title', children: [] }], [{ id: '2', title: 'Title', children: [] }])).toBe(false);
      expect(
        areTreesEqual(
          [{ id: '1', title: 'Node', children: [] }],
          [
            { id: '1', title: 'Node', children: [] },
            { id: '2', title: 'Node 2', children: [] },
          ],
        ),
      ).toBe(false);

      const nested = [{ id: '1', title: 'Parent', children: [{ id: '1a', title: 'Child', children: [] }] }];
      expect(areTreesEqual(nested, nested)).toBe(true);
      expect(areTreesEqual(nested, [{ id: '1', title: 'Parent', children: [] }])).toBe(false);
      expect(areTreesEqual([], [])).toBe(true);
    });
  });
});
