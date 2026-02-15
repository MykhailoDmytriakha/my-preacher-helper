import {
    createNodeId,
    createNewNode,
    syncDraftTitles,
    mergeDraftTitles,
    removeNode,
    addChildNode,
    addSiblingNode,
    areTreesEqual,
    promoteNode,
    demoteNode
} from './treeUtils';
import type { ExegeticalPlanNode } from '@/models/models';

describe('treeUtils', () => {
    describe('createNodeId', () => {
        it('generates a unique string id using crypto.randomUUID when available', () => {
            // Save original
            const originalCrypto = global.crypto;

            // Mock crypto using Object.defineProperty to bypass read-only restriction
            Object.defineProperty(global, 'crypto', {
                value: {
                    randomUUID: jest.fn(() => 'uuid-123')
                },
                writable: true, // Allow overwriting
                configurable: true // Allow deleting/restoring
            });

            const id = createNodeId();
            expect(id).toBe('uuid-123');
            expect(global.crypto.randomUUID).toHaveBeenCalled();

            // Restore
            Object.defineProperty(global, 'crypto', {
                value: originalCrypto,
                writable: true,
                configurable: true
            });
        });

        it('falls back to date/random string if crypto is undefined', () => {
            const originalCrypto = global.crypto;

            Object.defineProperty(global, 'crypto', {
                value: undefined,
                writable: true,
                configurable: true // Important for restoration
            });

            const id = createNodeId();
            expect(typeof id).toBe('string');
            expect(id).toMatch(/^n-\d+-[a-z0-9]+$/);

            Object.defineProperty(global, 'crypto', {
                value: originalCrypto,
                writable: true,
                configurable: true
            });
        });
        it('generates a unique string id', () => {
            const id1 = createNodeId();
            const id2 = createNodeId();
            expect(typeof id1).toBe('string');
            expect(id1).not.toBe(id2);
        });
    });

    describe('createNewNode', () => {
        it('creates a node with an id and empty properties', () => {
            const node = createNewNode();
            expect(node.id).toBeDefined();
            expect(node.title).toBe('');
            expect(node.children).toEqual([]);
        });
    });

    describe('syncDraftTitles', () => {
        it('creates a flat map of titles indexed by id', () => {
            const nodes: ExegeticalPlanNode[] = [
                {
                    id: '1', title: 'A', children: [
                        { id: '2', title: 'B', children: [] }
                    ]
                },
                { id: '3', title: 'C', children: [] }
            ];
            const result = syncDraftTitles(nodes);
            expect(result).toEqual({
                '1': 'A',
                '2': 'B',
                '3': 'C'
            });
        });
    });

    describe('mergeDraftTitles', () => {
        it('merges draft titles back into the tree structure', () => {
            const nodes: ExegeticalPlanNode[] = [
                {
                    id: '1', title: 'A', children: [
                        { id: '2', title: 'B', children: [] }
                    ]
                }
            ];
            const drafts = { '1': 'A updated', '2': 'B updated' };
            const result = mergeDraftTitles(nodes, drafts);
            expect(result[0].title).toBe('A updated');
            expect(result[0].children![0].title).toBe('B updated');
        });
    });

    describe('removeNode', () => {
        it('removes a node and its descendants from the tree', () => {
            const nodes: ExegeticalPlanNode[] = [
                {
                    id: '1', title: 'A', children: [
                        { id: '2', title: 'B', children: [] }
                    ]
                },
                { id: '3', title: 'C', children: [] }
            ];
            const result = removeNode(nodes, '2');
            expect(result[0].children).toEqual([]);

            const result2 = removeNode(nodes, '1');
            expect(result2.length).toBe(1);
            expect(result2[0].id).toBe('3');
        });
    });

    describe('addChildNode', () => {
        it('adds a new child to a specific parent', () => {
            const nodes: ExegeticalPlanNode[] = [
                { id: '1', title: 'A', children: [] }
            ];
            const newNode: ExegeticalPlanNode = { id: '2', title: 'B', children: [] };
            const result = addChildNode(nodes, '1', newNode);
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children![0].id).toBe('2');
        });
    });

    describe('addSiblingNode', () => {
        it('adds a sibling after a specific node', () => {
            const nodes: ExegeticalPlanNode[] = [
                { id: '1', title: 'A', children: [] }
            ];
            const newNode: ExegeticalPlanNode = { id: '2', title: 'B', children: [] };
            const result = addSiblingNode(nodes, '1', newNode);
            expect(result).toHaveLength(2);
            expect(result[1].id).toBe('2');
        });
    });

    describe('areTreesEqual', () => {
        it('returns true for identical trees', () => {
            const tree1 = [{ id: '1', title: 'A', children: [{ id: '2', title: 'B', children: [] }] }];
            const tree2 = [{ id: '1', title: 'A', children: [{ id: '2', title: 'B', children: [] }] }];
            expect(areTreesEqual(tree1, tree2)).toBe(true);
        });

        it('returns false for different lengths', () => {
            expect(areTreesEqual([{ id: '1', title: '', children: [] }], [])).toBe(false);
        });

        it('returns false for different IDs or titles', () => {
            const tree1 = [{ id: '1', title: 'A', children: [] }];
            const tree2 = [{ id: '2', title: 'A', children: [] }];
            const tree3 = [{ id: '1', title: 'B', children: [] }];
            expect(areTreesEqual(tree1, tree2)).toBe(false);
            expect(areTreesEqual(tree1, tree3)).toBe(false);
        });
    });

    describe('promoteNode', () => {
        it('moves a child node to become a sibling of its parent', () => {
            const nodes: ExegeticalPlanNode[] = [
                {
                    id: '1', title: 'Parent', children: [
                        { id: '2', title: 'Child', children: [] }
                    ]
                }
            ];
            const result = promoteNode(nodes, '2');
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('1');
            expect(result[0].children).toHaveLength(0);
            expect(result[1].id).toBe('2');
        });

        it('supports promoting from deeper levels', () => {
            const nodes: ExegeticalPlanNode[] = [
                {
                    id: '1', title: 'Root', children: [
                        {
                            id: '2', title: 'Parent', children: [
                                { id: '3', title: 'Child', children: [] }
                            ]
                        }
                    ]
                }
            ];
            const result = promoteNode(nodes, '3');
            expect(result[0].children).toHaveLength(2);
            expect(result[0].children![0].id).toBe('2');
            expect(result[0].children![1].id).toBe('3');
        });

        it('returns same nodes if id not found', () => {
            const nodes = [{ id: '1', title: '', children: [] }];
            const result = promoteNode(nodes, 'non-existent');
            expect(result).toBe(nodes);
        });

        it('recurses but finds nothing if children matches but id does not', () => {
            const nodes = [{ id: '1', title: '', children: [{ id: '2', title: '', children: [] }] }];
            // Trying to promote something deep that doesn't exist
            const result = promoteNode(nodes, '999');
            expect(result).toBe(nodes);
        });
    });

    describe('demoteNode', () => {
        it('moves a node to become a child of its previous sibling', () => {
            const nodes: ExegeticalPlanNode[] = [
                { id: '1', title: 'First', children: [] },
                { id: '2', title: 'Second', children: [] }
            ];
            const result = demoteNode(nodes, '2');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children![0].id).toBe('2');
        });

        it('returns same nodes if it is the first sibling', () => {
            const nodes = [{ id: '1', title: '', children: [] }];
            expect(demoteNode(nodes, '1')).toBe(nodes);
        });

        it('supports demoting in deeper levels', () => {
            const nodes: ExegeticalPlanNode[] = [
                {
                    id: '1', title: 'Root', children: [
                        { id: '2', title: 'First', children: [] },
                        { id: '3', title: 'Second', children: [] }
                    ]
                }
            ];
            const result = demoteNode(nodes, '3');
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children![0].id).toBe('2');
            expect(result[0].children![0].children![0].id).toBe('3');
        });

        it('returns same nodes if id not found', () => {
            const nodes = [{ id: '1', title: '', children: [] }];
            expect(demoteNode(nodes, '999')).toBe(nodes);
        });

        it('recurses but does not change if deep demote is not possible or id not found', () => {
            const nodes = [{ id: '1', title: 'Root', children: [{ id: '2', title: 'Child', children: [] }] }];
            // Try demoting '2' but it's first child
            expect(demoteNode(nodes, '2')).toBe(nodes); // Actually demoteNode implementation might differ on this...
            // Wait, '2' is a child of '1'. In '1'.children, '2' is at index 0. So it cannot be demoted.

            // Let's verify 'demoteNode' logic: if (i===0) return nodes; -> This is inside the loop. 
            // If it returns 'nodes', it returns the *children array* to the recursive caller?
            // No, 'demoteNode' returns the new list of nodes for that level.
            // If it's same, it returns 'nodes' (the parent level). 
            // So yes, it should return same nodes.

            const result = demoteNode(nodes, '2');
            expect(result).toBe(nodes);
        });
    });
});
