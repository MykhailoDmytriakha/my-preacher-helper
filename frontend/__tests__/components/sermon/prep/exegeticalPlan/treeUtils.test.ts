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
    it('generates unique IDs', () => {
      const id1 = createNodeId();
      const id2 = createNodeId();
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('generates string IDs', () => {
      const id = createNodeId();
      expect(typeof id).toBe('string');
    });
  });

  describe('createNewNode', () => {
    const nodeCases = [
      {
        name: 'creates a node with required properties',
        expectations: (node) => {
          expect(node).toHaveProperty('id');
          expect(node).toHaveProperty('title');
          expect(node).toHaveProperty('children');
        }
      },
      {
        name: 'creates nodes with unique IDs',
        expectations: (node1, node2) => {
          expect(node1.id).not.toBe(node2.id);
        }
      }
    ];

    it('basic node creation', () => {
      const node = createNewNode();
      nodeCases[0].expectations(node);
    });

    it('unique ID generation', () => {
      const node1 = createNewNode();
      const node2 = createNewNode();
      nodeCases[1].expectations(node1, node2);
    });
  });

  describe('syncDraftTitles', () => {
    const syncCases = [
      {
        name: 'syncs titles from a flat tree',
        tree: [{ id: '1', title: 'Node 1', children: [] }, { id: '2', title: 'Node 2', children: [] }],
        expectedDrafts: { '1': 'Node 1', '2': 'Node 2' },
        expectations: (result, expectedDrafts) => {
          expect(result).toEqual(expectedDrafts);
        }
      },
      {
        name: 'syncs titles from a nested tree',
        tree: [{ id: '1', title: 'Parent', children: [{ id: '1a', title: 'Child', children: [] }] }],
        expectedDrafts: { '1': 'Parent', '1a': 'Child' },
        expectations: (result, expectedDrafts) => {
          expect(result).toEqual(expectedDrafts);
        }
      }
    ];

    syncCases.forEach(({ name, tree, expectedDrafts, expectations }) => {
      it(name, () => {
        const result = syncDraftTitles(tree);
        expectations(result, expectedDrafts);
      });
    });
  });

  describe('mergeDraftTitles', () => {
    it('merges draft titles into nodes', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Old Title', children: [] }
      ];
      const draftTitles = { '1': 'New Title' };
      const result = mergeDraftTitles(nodes, draftTitles);
      expect(result[0].title).toBe('New Title');
    });

    it('preserves original title when no draft exists', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Original', children: [] }
      ];
      const draftTitles = {};
      const result = mergeDraftTitles(nodes, draftTitles);
      expect(result[0].title).toBe('Original');
    });

    it('merges draft titles for nested nodes', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent Old',
          children: [
            { id: '1a', title: 'Child Old', children: [] }
          ]
        }
      ];
      const draftTitles = { '1': 'Parent New', '1a': 'Child New' };
      const result = mergeDraftTitles(nodes, draftTitles);
      expect(result[0].title).toBe('Parent New');
      expect(result[0].children![0].title).toBe('Child New');
    });

    it('does not mutate the original nodes array', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Original', children: [] }
      ];
      const draftTitles = { '1': 'New' };
      const nodesCopy = JSON.parse(JSON.stringify(nodes));
      mergeDraftTitles(nodes, draftTitles);
      expect(nodes).toEqual(nodesCopy);
    });
  });

  describe('removeNode', () => {
    it('removes a root level node', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node 1', children: [] },
        { id: '2', title: 'Node 2', children: [] }
      ];
      const result = removeNode(nodes, '1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('removes a child node', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: [
            { id: '1a', title: 'Child A', children: [] },
            { id: '1b', title: 'Child B', children: [] }
          ]
        }
      ];
      const result = removeNode(nodes, '1a');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children![0].id).toBe('1b');
    });

    it('returns empty array when removing the only node', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Only Node', children: [] }
      ];
      const result = removeNode(nodes, '1');
      expect(result).toEqual([]);
    });

    it('handles removing deeply nested nodes', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Level 1',
          children: [
            {
              id: '2',
              title: 'Level 2',
              children: [
                { id: '3', title: 'Level 3', children: [] }
              ]
            }
          ]
        }
      ];
      const result = removeNode(nodes, '3');
      expect(result[0].children![0].children).toHaveLength(0);
    });

    it('does nothing when node ID not found', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node 1', children: [] }
      ];
      const result = removeNode(nodes, 'non-existent');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });
  });

  describe('addChildNode', () => {
    it('adds a child to a node without children', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent', children: [] }
      ];
      const newChild = { id: '1a', title: 'Child', children: [] };
      const result = addChildNode(nodes, '1', newChild);
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children![0].id).toBe('1a');
    });

    it('adds a child to a node with existing children', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: [
            { id: '1a', title: 'Existing Child', children: [] }
          ]
        }
      ];
      const newChild = { id: '1b', title: 'New Child', children: [] };
      const result = addChildNode(nodes, '1', newChild);
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children![1].id).toBe('1b');
    });

    it('adds a child to a deeply nested node', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Level 1',
          children: [
            { id: '2', title: 'Level 2', children: [] }
          ]
        }
      ];
      const newChild = { id: '3', title: 'Level 3', children: [] };
      const result = addChildNode(nodes, '2', newChild);
      expect(result[0].children![0].children).toHaveLength(1);
      expect(result[0].children![0].children![0].id).toBe('3');
    });

    it('does nothing when parent ID not found', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node', children: [] }
      ];
      const newChild = { id: '2', title: 'Child', children: [] };
      const result = addChildNode(nodes, 'non-existent', newChild);
      expect(result).toEqual(nodes);
    });
  });

  describe('addSiblingNode', () => {
    it('adds a sibling after the specified node', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node 1', children: [] },
        { id: '2', title: 'Node 2', children: [] }
      ];
      const newSibling = { id: '1a', title: 'Sibling', children: [] };
      const result = addSiblingNode(nodes, '1', newSibling);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('1a');
      expect(result[2].id).toBe('2');
    });

    it('adds a sibling to nested nodes', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: [
            { id: '1a', title: 'Child A', children: [] }
          ]
        }
      ];
      const newSibling = { id: '1b', title: 'Child B', children: [] };
      const result = addSiblingNode(nodes, '1a', newSibling);
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children![0].id).toBe('1a');
      expect(result[0].children![1].id).toBe('1b');
    });

    it('adds sibling as last element when target is last', () => {
      const nodes: ExegeticalPlanNode[] = [
        { id: '1', title: 'First', children: [] },
        { id: '2', title: 'Second', children: [] }
      ];
      const newSibling = { id: '3', title: 'Third', children: [] };
      const result = addSiblingNode(nodes, '2', newSibling);
      expect(result).toHaveLength(3);
      expect(result[2].id).toBe('3');
    });

    it('handles adding sibling to deeply nested nodes', () => {
      const nodes: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Level 1',
          children: [
            {
              id: '2',
              title: 'Level 2',
              children: [
                { id: '3', title: 'Level 3', children: [] }
              ]
            }
          ]
        }
      ];
      const newSibling = { id: '4', title: 'Level 3 Sibling', children: [] };
      const result = addSiblingNode(nodes, '3', newSibling);
      expect(result[0].children![0].children).toHaveLength(2);
      expect(result[0].children![0].children![1].id).toBe('4');
    });
  });

  describe('areTreesEqual', () => {
    it('returns true for identical trees', () => {
      const tree1: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node', children: [] }
      ];
      const tree2: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node', children: [] }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(true);
    });

    it('returns false for trees with different titles', () => {
      const tree1: ExegeticalPlanNode[] = [
        { id: '1', title: 'Title A', children: [] }
      ];
      const tree2: ExegeticalPlanNode[] = [
        { id: '1', title: 'Title B', children: [] }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(false);
    });

    it('returns false for trees with different IDs', () => {
      const tree1: ExegeticalPlanNode[] = [
        { id: '1', title: 'Title', children: [] }
      ];
      const tree2: ExegeticalPlanNode[] = [
        { id: '2', title: 'Title', children: [] }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(false);
    });

    it('returns false for trees with different lengths', () => {
      const tree1: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node', children: [] }
      ];
      const tree2: ExegeticalPlanNode[] = [
        { id: '1', title: 'Node', children: [] },
        { id: '2', title: 'Node 2', children: [] }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(false);
    });

    it('compares nested structures correctly', () => {
      const tree1: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: [
            { id: '1a', title: 'Child', children: [] }
          ]
        }
      ];
      const tree2: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: [
            { id: '1a', title: 'Child', children: [] }
          ]
        }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(true);
    });

    it('returns false when child counts differ', () => {
      const tree1: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: [
            { id: '1a', title: 'Child', children: [] }
          ]
        }
      ];
      const tree2: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Parent',
          children: []
        }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(false);
    });

    it('handles empty arrays', () => {
      expect(areTreesEqual([], [])).toBe(true);
    });

    it('returns true for deeply nested identical trees', () => {
      const tree1: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'L1',
          children: [
            {
              id: '2',
              title: 'L2',
              children: [
                { id: '3', title: 'L3', children: [] }
              ]
            }
          ]
        }
      ];
      const tree2: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'L1',
          children: [
            {
              id: '2',
              title: 'L2',
              children: [
                { id: '3', title: 'L3', children: [] }
              ]
            }
          ]
        }
      ];
      expect(areTreesEqual(tree1, tree2)).toBe(true);
    });
  });
});
