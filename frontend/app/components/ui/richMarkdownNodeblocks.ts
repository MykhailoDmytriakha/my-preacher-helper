import type { Editor } from '@tiptap/react';

export type RichMarkdownActiveListType = 'bulletList' | 'orderedList' | null;
export interface RichMarkdownSelectedNodeblockContext {
    path: number[];
    topLevelIndex: number | null;
}

type EditorStateLike = Pick<Editor, 'state'>['state'];

export function getActiveListType(state: EditorStateLike): RichMarkdownActiveListType {
    for (let depth = state.selection.$from.depth; depth >= 0; depth -= 1) {
        const node = state.selection.$from.node(depth);

        if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
            return node.type.name;
        }
    }

    return null;
}

export function isSelectionInsideListItem(state: EditorStateLike): boolean {
    for (let depth = state.selection.$from.depth; depth >= 0; depth -= 1) {
        if (state.selection.$from.node(depth).type.name === 'listItem') {
            return true;
        }
    }

    return false;
}

export function getSelectedListItemPath(state: EditorStateLike): number[] | null {
    const path: number[] = [];

    for (let depth = 1; depth <= state.selection.$from.depth; depth += 1) {
        const node = state.selection.$from.node(depth);
        const parentNode = state.selection.$from.node(depth - 1);

        if (
            node.type.name !== 'listItem' ||
            (parentNode.type.name !== 'bulletList' && parentNode.type.name !== 'orderedList')
        ) {
            continue;
        }

        path.push(state.selection.$from.index(depth - 1));
    }

    return path.length > 0 ? path : null;
}

export function getSelectedTopLevelBranchNodeblockIndex(state: EditorStateLike): number | null {
    const selectedListItemPath = getSelectedListItemPath(state);

    if (!selectedListItemPath) {
        return null;
    }

    const topLevelNodes: Array<{
        node: { type: { name: string }; nodeSize: number; childCount: number };
        startOffset: number;
    }> = [];

    state.doc.forEach((node, offset) => {
        topLevelNodes.push({
            node: node as typeof topLevelNodes[number]['node'],
            startOffset: offset,
        });
    });

    let activeHeadingIndex = -1;

    topLevelNodes.forEach(({ node, startOffset }, index) => {
        if (node.type.name === 'heading' && startOffset <= state.selection.from) {
            activeHeadingIndex = index;
        }
    });

    if (activeHeadingIndex < 0) {
        return null;
    }

    let accumulatedTopLevelNodeblocks = 0;

    for (let index = activeHeadingIndex + 1; index < topLevelNodes.length; index += 1) {
        const { node, startOffset } = topLevelNodes[index];

        if (node.type.name === 'heading' || node.type.name === 'horizontalRule') {
            break;
        }

        if (node.type.name !== 'bulletList') {
            continue;
        }

        const endOffset = startOffset + node.nodeSize;
        const selectionIsInsideThisList = state.selection.from >= startOffset && state.selection.from <= endOffset;

        if (selectionIsInsideThisList) {
            return accumulatedTopLevelNodeblocks + selectedListItemPath[0];
        }

        accumulatedTopLevelNodeblocks += node.childCount;
    }

    return null;
}

export function getSelectedTopLevelBranchBlockIndex(state: EditorStateLike): number | null {
    const topLevelNodes: Array<{
        node: { type: { name: string }; nodeSize: number };
        startOffset: number;
    }> = [];

    state.doc.forEach((node, offset) => {
        topLevelNodes.push({
            node: node as typeof topLevelNodes[number]['node'],
            startOffset: offset,
        });
    });

    let activeHeadingIndex = -1;

    topLevelNodes.forEach(({ node, startOffset }, index) => {
        if (node.type.name === 'heading' && startOffset <= state.selection.from) {
            activeHeadingIndex = index;
        }
    });

    if (activeHeadingIndex < 0) {
        return null;
    }

    let topLevelBlockIndex = 0;

    for (let index = activeHeadingIndex + 1; index < topLevelNodes.length; index += 1) {
        const { node, startOffset } = topLevelNodes[index];

        if (node.type.name === 'heading' || node.type.name === 'horizontalRule') {
            break;
        }

        const endOffset = startOffset + node.nodeSize;
        const selectionIsInsideThisBlock = state.selection.from >= startOffset && state.selection.from <= endOffset;

        if (selectionIsInsideThisBlock) {
            return topLevelBlockIndex;
        }

        topLevelBlockIndex += 1;
    }

    return null;
}

export function getSelectedNodeblockContext(state: EditorStateLike): RichMarkdownSelectedNodeblockContext | null {
    const path = getSelectedListItemPath(state);

    if (!path) {
        return null;
    }

    return {
        path,
        topLevelIndex: getSelectedTopLevelBranchNodeblockIndex(state),
    };
}
