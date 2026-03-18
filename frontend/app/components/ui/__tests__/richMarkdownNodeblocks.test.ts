import {
    getSelectedListItemPath,
    getSelectedTopLevelBranchBlockIndex,
    getSelectedNodeblockContext,
    getSelectedTopLevelBranchNodeblockIndex,
} from '../richMarkdownNodeblocks';

interface MockTopLevelNode {
    type: { name: string };
    nodeSize: number;
    childCount: number;
}

function createSelectionState({
    path,
    selectionFrom,
    topLevelNodes,
}: {
    path: number[];
    selectionFrom: number;
    topLevelNodes: Array<{ startOffset: number; node: MockTopLevelNode }>;
}) {
    const nodeNames = ['doc'];

    path.forEach(() => {
        nodeNames.push('bulletList');
        nodeNames.push('listItem');
    });

    nodeNames.push('paragraph');

    return {
        doc: {
            forEach: (callback: (node: MockTopLevelNode, offset: number, index: number) => void) => {
                topLevelNodes.forEach(({ node, startOffset }, index) => callback(node, startOffset, index));
            },
        },
        selection: {
            from: selectionFrom,
            $from: {
                depth: nodeNames.length - 1,
                node: (depth: number) => ({
                    type: {
                        name: nodeNames[depth],
                    },
                }),
                index: (depth: number) => {
                    if (depth % 2 === 1) {
                        return path[(depth - 1) / 2] ?? 0;
                    }

                    return 0;
                },
            },
        },
    };
}

describe('richMarkdownNodeblocks', () => {
    it('derives the nested list-item path from the current selection', () => {
        const state = createSelectionState({
            path: [1, 0],
            selectionFrom: 34,
            topLevelNodes: [],
        });

        expect(getSelectedListItemPath(state as never)).toEqual([1, 0]);
    });

    it('counts top-level note blocks across multiple bullet lists inside the current heading branch', () => {
        const state = createSelectionState({
            path: [0],
            selectionFrom: 43,
            topLevelNodes: [
                {
                    startOffset: 0,
                    node: { type: { name: 'heading' }, nodeSize: 10, childCount: 0 },
                },
                {
                    startOffset: 10,
                    node: { type: { name: 'paragraph' }, nodeSize: 6, childCount: 0 },
                },
                {
                    startOffset: 16,
                    node: { type: { name: 'bulletList' }, nodeSize: 14, childCount: 2 },
                },
                {
                    startOffset: 30,
                    node: { type: { name: 'paragraph' }, nodeSize: 5, childCount: 0 },
                },
                {
                    startOffset: 35,
                    node: { type: { name: 'bulletList' }, nodeSize: 12, childCount: 1 },
                },
            ],
        });

        expect(getSelectedTopLevelBranchNodeblockIndex(state as never)).toBe(2);
        expect(getSelectedNodeblockContext(state as never)).toEqual({
            path: [0],
            topLevelIndex: 2,
        });
    });

    it('does not treat note blocks after a structure pop marker as liftable from the current branch scope', () => {
        const state = createSelectionState({
            path: [0],
            selectionFrom: 37,
            topLevelNodes: [
                {
                    startOffset: 0,
                    node: { type: { name: 'heading' }, nodeSize: 10, childCount: 0 },
                },
                {
                    startOffset: 10,
                    node: { type: { name: 'bulletList' }, nodeSize: 12, childCount: 1 },
                },
                {
                    startOffset: 22,
                    node: { type: { name: 'horizontalRule' }, nodeSize: 1, childCount: 0 },
                },
                {
                    startOffset: 23,
                    node: { type: { name: 'bulletList' }, nodeSize: 18, childCount: 1 },
                },
            ],
        });

        expect(getSelectedTopLevelBranchNodeblockIndex(state as never)).toBeNull();
    });

    it('finds the top-level paragraph block index inside the current heading branch', () => {
        const state = createSelectionState({
            path: [],
            selectionFrom: 37,
            topLevelNodes: [
                {
                    startOffset: 0,
                    node: { type: { name: 'heading' }, nodeSize: 10, childCount: 0 },
                },
                {
                    startOffset: 10,
                    node: { type: { name: 'paragraph' }, nodeSize: 7, childCount: 0 },
                },
                {
                    startOffset: 17,
                    node: { type: { name: 'bulletList' }, nodeSize: 12, childCount: 1 },
                },
                {
                    startOffset: 29,
                    node: { type: { name: 'paragraph' }, nodeSize: 12, childCount: 0 },
                },
            ],
        });

        expect(getSelectedTopLevelBranchBlockIndex(state as never)).toBe(2);
    });
});
