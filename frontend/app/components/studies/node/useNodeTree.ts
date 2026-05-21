'use client';

import { Dispatch, useMemo, useReducer } from 'react';

import type { ContentNode, ContentNodeMedia } from '@/models/models';

const HARD_SIZE_LIMIT = 900_000;
const SOFT_SIZE_LIMIT = 700_000;

let hasWarnedAboutLargeTree = false;

export interface NodeTreeState {
  nodes: Record<string, ContentNode>;
  rootId: string;
  focusedNodeId: string | null;
  isEditingText: boolean;
}

export interface FlatNode {
  id: string;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
}

export interface SelectFlatOptions {
  includeRoot?: boolean;
}

export type NodeTreeAction =
  | { type: 'setRoot'; root: ContentNode }
  | { type: 'setFocus'; nodeId: string | null }
  | { type: 'startEdit' }
  | { type: 'stopEdit' }
  | { type: 'updateHeader'; id: string; header: string }
  | { type: 'updateText'; id: string; text: string }
  | { type: 'addMedia'; id: string; media: ContentNodeMedia }
  | { type: 'removeMedia'; id: string; mediaId: string }
  | { type: 'toggleCollapse'; id: string }
  | { type: 'insertSibling'; id: string; newId: string }
  | { type: 'insertChild'; id: string; newId: string }
  | { type: 'deleteNode'; id: string }
  | { type: 'promote'; id: string }
  | { type: 'demote'; id: string }
  | { type: 'moveNode'; id: string; targetParentId: string; targetIndex: number }
  | { type: 'moveUp'; id: string }
  | { type: 'moveDown'; id: string }
  /**
   * Lift any header/text/media that lives directly on the root node into a
   * brand-new first child (id = `childId`). The root itself becomes a pure
   * structural wrapper — it stores only children. Used at editor mount when
   * legacy data has content sitting on root; afterwards the editor renders
   * children only and the user never sees the root row.
   */
  | { type: 'liftRootContent'; childId: string };

type BoundSelectors = {
  selectFlat: (options?: SelectFlatOptions) => FlatNode[];
  selectAncestorIds: (id: string) => string[];
  selectTree: () => ContentNode;
};

function childRef(id: string): ContentNode {
  return { id };
}

function getChildIds(node: ContentNode | undefined): string[] {
  return node?.children?.map((child) => child.id) ?? [];
}

function withChildIds(node: ContentNode, childIds: string[]): ContentNode {
  const { children: _children, ...rest } = node;

  if (childIds.length === 0) {
    return rest;
  }

  return {
    ...rest,
    children: childIds.map(childRef),
  };
}

function flattenNode(node: ContentNode, nodes: Record<string, ContentNode>): void {
  const childIds = node.children?.map((child) => {
    flattenNode(child, nodes);
    return child.id;
  }) ?? [];
  const { children: _children, ...nodeWithoutChildren } = node;

  nodes[node.id] = childIds.length > 0
    ? { ...nodeWithoutChildren, children: childIds.map(childRef) }
    : nodeWithoutChildren;
}

export function flatten(root: ContentNode): NodeTreeState {
  const nodes: Record<string, ContentNode> = {};
  flattenNode(root, nodes);

  return {
    nodes,
    rootId: root.id,
    focusedNodeId: null,
    isEditingText: false,
  };
}

function serializeNode(state: NodeTreeState, id: string, visited: Set<string>): ContentNode {
  const node = state.nodes[id];
  if (!node || visited.has(id)) {
    return { id };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(id);
  const childIds = getChildIds(node);
  const { children: _children, ...nodeWithoutChildren } = node;

  if (childIds.length === 0) {
    return nodeWithoutChildren;
  }

  return {
    ...nodeWithoutChildren,
    children: childIds.map((childId) => serializeNode(state, childId, nextVisited)),
  };
}

export function selectTree(state: NodeTreeState): ContentNode {
  return serializeNode(state, state.rootId, new Set<string>());
}

export function selectFlat(state: NodeTreeState, options: SelectFlatOptions = {}): FlatNode[] {
  const includeRoot = options.includeRoot ?? true;
  const flatNodes: FlatNode[] = [];

  const visit = (id: string, depth: number): void => {
    const node = state.nodes[id];
    if (!node) return;

    const childIds = getChildIds(node);
    const isCollapsed = Boolean(node.collapsed);

    flatNodes.push({
      id,
      depth,
      hasChildren: childIds.length > 0,
      isCollapsed,
    });

    if (isCollapsed) return;
    childIds.forEach((childId) => visit(childId, depth + 1));
  };

  if (includeRoot) {
    visit(state.rootId, 0);
  } else {
    getChildIds(state.nodes[state.rootId]).forEach((childId) => visit(childId, 0));
  }

  return flatNodes;
}

function findParentId(state: NodeTreeState, id: string): string | null {
  for (const node of Object.values(state.nodes)) {
    if (getChildIds(node).includes(id)) {
      return node.id;
    }
  }

  return null;
}

export function selectAncestorIds(state: NodeTreeState, id: string): string[] {
  const ancestors: string[] = [];
  let currentId: string | null = id;

  while (currentId) {
    const parentId = findParentId(state, currentId);
    if (!parentId) break;

    ancestors.push(parentId);
    currentId = parentId;
  }

  return ancestors;
}

function findLocation(state: NodeTreeState, id: string): { parentId: string; index: number } | null {
  const parentId = findParentId(state, id);
  if (!parentId) return null;

  const index = getChildIds(state.nodes[parentId]).indexOf(id);
  if (index === -1) return null;

  return { parentId, index };
}

function updateNode(
  state: NodeTreeState,
  id: string,
  updater: (node: ContentNode) => ContentNode
): NodeTreeState {
  const current = state.nodes[id];
  if (!current) return state;

  const updated = updater(current);
  if (updated === current) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [id]: updated,
    },
  };
}

function removeMediaFromNode(node: ContentNode, mediaId: string): ContentNode {
  const nextMedia = node.media?.filter((item) => item.id !== mediaId) ?? [];
  const { media: _media, ...rest } = node;

  return nextMedia.length > 0
    ? { ...rest, media: nextMedia }
    : rest;
}

function insertSibling(state: NodeTreeState, id: string, newId: string): NodeTreeState {
  if (state.nodes[newId]) return state;

  const location = findLocation(state, id);
  if (!location) return state;

  const parent = state.nodes[location.parentId];
  const childIds = getChildIds(parent);
  const nextChildIds = [
    ...childIds.slice(0, location.index + 1),
    newId,
    ...childIds.slice(location.index + 1),
  ];

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [newId]: { id: newId },
      [location.parentId]: withChildIds(parent, nextChildIds),
    },
    focusedNodeId: newId,
    isEditingText: false,
  };
}

function nodeContentEquals(a: ContentNode, b: ContentNode): boolean {
  return (a.header ?? '') === (b.header ?? '')
    && (a.text ?? '') === (b.text ?? '')
    && JSON.stringify(a.media ?? []) === JSON.stringify(b.media ?? []);
}

function stripRootContent(state: NodeTreeState): NodeTreeState {
  const root = state.nodes[state.rootId];
  if (!root) return state;
  const { header: _h, text: _t, media: _m, ...rootRest } = root;
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [state.rootId]: rootRest as ContentNode,
    },
  };
}

function liftRootContent(state: NodeTreeState, childId: string): NodeTreeState {
  const root = state.nodes[state.rootId];
  if (!root) return state;
  if (state.nodes[childId]) return state;

  const hasContent = Boolean(root.header || root.text || (root.media?.length ?? 0) > 0);
  if (!hasContent) return state;

  // Dedup guard: if root content is byte-identical to the first child, this
  // is a legacy save that already mirrors the data in both places (likely a
  // ghost from a prior auto-lift cycle). Creating another lifted child would
  // produce the visible duplicate the user has been reporting. Just strip
  // root content silently so subsequent saves persist a clean shape.
  const existingChildRefs = root.children ?? [];
  const firstChildId = existingChildRefs[0]?.id;
  const firstChild = firstChildId ? state.nodes[firstChildId] : undefined;
  if (firstChild && nodeContentEquals(root, firstChild)) {
    return stripRootContent(state);
  }

  const liftedChild: ContentNode = {
    id: childId,
    ...(root.header !== undefined ? { header: root.header } : {}),
    ...(root.text !== undefined ? { text: root.text } : {}),
    ...(root.media !== undefined ? { media: root.media } : {}),
  };

  // Strip header/text/media from root — it's now a pure structural wrapper.
  // Prepend the lifted child before any existing children so converters that
  // emit "preamble text + heading children" (e.g. markdownToNodeTree) don't
  // lose the preamble: it becomes the first sibling.
  const { header: _h, text: _t, media: _m, ...rootRest } = root;
  const nextRoot: ContentNode = {
    ...rootRest,
    id: state.rootId,
    children: [childRef(childId), ...existingChildRefs],
  };

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [childId]: liftedChild,
      [state.rootId]: nextRoot,
    },
    focusedNodeId: childId,
  };
}

function insertChild(state: NodeTreeState, id: string, newId: string): NodeTreeState {
  if (!state.nodes[id] || state.nodes[newId]) return state;

  const parent = state.nodes[id];
  const nextChildIds = [...getChildIds(parent), newId];
  const nextParent = withChildIds(parent, nextChildIds);

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [newId]: { id: newId },
      [id]: parent.collapsed ? { ...nextParent, collapsed: false } : nextParent,
    },
    focusedNodeId: newId,
    isEditingText: false,
  };
}

function collectSubtreeIds(state: NodeTreeState, id: string): string[] {
  const node = state.nodes[id];
  if (!node) return [];

  return [
    id,
    ...getChildIds(node).flatMap((childId) => collectSubtreeIds(state, childId)),
  ];
}

function deleteNode(state: NodeTreeState, id: string): NodeTreeState {
  if (id === state.rootId || !state.nodes[id]) return state;

  const location = findLocation(state, id);
  if (!location) return state;

  const parent = state.nodes[location.parentId];
  const childIds = getChildIds(parent);
  const nextChildIds = childIds.filter((childId) => childId !== id);
  const nextFocusedNodeId = childIds[location.index - 1] ?? location.parentId;
  const nextNodes = { ...state.nodes };

  collectSubtreeIds(state, id).forEach((subtreeId) => {
    delete nextNodes[subtreeId];
  });
  nextNodes[location.parentId] = withChildIds(parent, nextChildIds);

  return {
    ...state,
    nodes: nextNodes,
    focusedNodeId: nextFocusedNodeId,
    isEditingText: false,
  };
}

function promote(state: NodeTreeState, id: string): NodeTreeState {
  if (id === state.rootId) return state;

  const location = findLocation(state, id);
  if (!location || location.parentId === state.rootId) return state;

  const grandParentId = findParentId(state, location.parentId);
  if (!grandParentId) return state;

  const parent = state.nodes[location.parentId];
  const grandParent = state.nodes[grandParentId];
  const parentChildIds = getChildIds(parent).filter((childId) => childId !== id);
  const grandParentChildIds = getChildIds(grandParent);
  const parentIndex = grandParentChildIds.indexOf(location.parentId);

  if (parentIndex === -1) return state;

  const nextGrandParentChildIds = [
    ...grandParentChildIds.slice(0, parentIndex + 1),
    id,
    ...grandParentChildIds.slice(parentIndex + 1),
  ];

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [location.parentId]: withChildIds(parent, parentChildIds),
      [grandParentId]: withChildIds(grandParent, nextGrandParentChildIds),
    },
  };
}

function demote(state: NodeTreeState, id: string): NodeTreeState {
  const location = findLocation(state, id);
  if (!location || location.index === 0) return state;

  const parent = state.nodes[location.parentId];
  const siblingIds = getChildIds(parent);
  const previousSiblingId = siblingIds[location.index - 1];
  const previousSibling = state.nodes[previousSiblingId];

  if (!previousSibling) return state;

  const nextParentChildIds = siblingIds.filter((childId) => childId !== id);
  const nextPreviousSiblingChildIds = [...getChildIds(previousSibling), id];
  const nextPreviousSibling = withChildIds(previousSibling, nextPreviousSiblingChildIds);

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [location.parentId]: withChildIds(parent, nextParentChildIds),
      [previousSiblingId]: previousSibling.collapsed
        ? { ...nextPreviousSibling, collapsed: false }
        : nextPreviousSibling,
    },
  };
}

function moveWithinSiblings(state: NodeTreeState, id: string, direction: -1 | 1): NodeTreeState {
  const location = findLocation(state, id);
  if (!location) return state;

  const parent = state.nodes[location.parentId];
  const childIds = getChildIds(parent);
  const nextIndex = location.index + direction;

  if (nextIndex < 0 || nextIndex >= childIds.length) return state;

  const nextChildIds = [...childIds];
  [nextChildIds[location.index], nextChildIds[nextIndex]] = [
    nextChildIds[nextIndex],
    nextChildIds[location.index],
  ];

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [location.parentId]: withChildIds(parent, nextChildIds),
    },
  };
}

function moveNode(
  state: NodeTreeState,
  id: string,
  targetParentId: string,
  targetIndex: number
): NodeTreeState {
  if (
    id === state.rootId
    || targetParentId === id
    || !state.nodes[id]
    || !state.nodes[targetParentId]
    || selectAncestorIds(state, targetParentId).includes(id)
  ) {
    return state;
  }

  const location = findLocation(state, id);
  if (!location) return state;

  const sourceParent = state.nodes[location.parentId];
  const targetParent = state.nodes[targetParentId];
  const sourceChildIds = getChildIds(sourceParent);
  const targetChildIds = location.parentId === targetParentId
    ? sourceChildIds.filter((childId) => childId !== id)
    : getChildIds(targetParent);
  const safeTargetIndex = Math.min(Math.max(targetIndex, 0), targetChildIds.length);
  const nextTargetChildIds = [
    ...targetChildIds.slice(0, safeTargetIndex),
    id,
    ...targetChildIds.slice(safeTargetIndex),
  ];

  if (location.parentId === targetParentId) {
    if (sourceChildIds.join('\u0000') === nextTargetChildIds.join('\u0000')) return state;

    return {
      ...state,
      nodes: {
        ...state.nodes,
        [targetParentId]: withChildIds(targetParent, nextTargetChildIds),
      },
    };
  }

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [location.parentId]: withChildIds(
        sourceParent,
        sourceChildIds.filter((childId) => childId !== id)
      ),
      [targetParentId]: withChildIds(
        targetParent.collapsed ? { ...targetParent, collapsed: false } : targetParent,
        nextTargetChildIds
      ),
    },
  };
}

function reduceNodeTree(state: NodeTreeState, action: NodeTreeAction): NodeTreeState {
  switch (action.type) {
    case 'setRoot':
      return flatten(action.root);
    case 'setFocus':
      if (action.nodeId !== null && !state.nodes[action.nodeId]) return state;
      return { ...state, focusedNodeId: action.nodeId };
    case 'startEdit':
      return { ...state, isEditingText: true };
    case 'stopEdit':
      return { ...state, isEditingText: false };
    case 'updateHeader':
      return updateNode(state, action.id, (node) => ({ ...node, header: action.header }));
    case 'updateText':
      return updateNode(state, action.id, (node) => ({ ...node, text: action.text }));
    case 'addMedia':
      return updateNode(state, action.id, (node) => ({
        ...node,
        media: [...(node.media ?? []), action.media],
      }));
    case 'removeMedia':
      return updateNode(state, action.id, (node) => removeMediaFromNode(node, action.mediaId));
    case 'toggleCollapse':
      return updateNode(state, action.id, (node) => ({ ...node, collapsed: !node.collapsed }));
    case 'insertSibling':
      return insertSibling(state, action.id, action.newId);
    case 'insertChild':
      return insertChild(state, action.id, action.newId);
    case 'liftRootContent':
      return liftRootContent(state, action.childId);
    case 'deleteNode':
      return deleteNode(state, action.id);
    case 'promote':
      return promote(state, action.id);
    case 'demote':
      return demote(state, action.id);
    case 'moveNode':
      return moveNode(state, action.id, action.targetParentId, action.targetIndex);
    case 'moveUp':
      return moveWithinSiblings(state, action.id, -1);
    case 'moveDown':
      return moveWithinSiblings(state, action.id, 1);
    default: {
      const _exhaustiveCheck: never = action;
      return _exhaustiveCheck;
    }
  }
}

function guardedNodeTreeReducer(state: NodeTreeState, action: NodeTreeAction): NodeTreeState {
  const nextState = reduceNodeTree(state, action);
  if (nextState === state) return state;

  const nextSize = JSON.stringify(selectTree(nextState)).length;
  if (nextSize > HARD_SIZE_LIMIT) {
    console.warn(
      `Node tree action "${action.type}" rejected: serialized size ${nextSize} exceeds ${HARD_SIZE_LIMIT}.`
    );
    return state;
  }

  if (!hasWarnedAboutLargeTree && nextSize > SOFT_SIZE_LIMIT) {
    const previousSize = JSON.stringify(selectTree(state)).length;
    if (previousSize < SOFT_SIZE_LIMIT) {
      hasWarnedAboutLargeTree = true;
      console.warn(
        `Node tree serialized size is ${nextSize}; autosave payload is approaching the ${HARD_SIZE_LIMIT} limit.`
      );
    }
  }

  return nextState;
}

export function useNodeTree(initialRoot: ContentNode): {
  state: NodeTreeState;
  dispatch: Dispatch<NodeTreeAction>;
  selectors: BoundSelectors;
} {
  const [state, dispatch] = useReducer(guardedNodeTreeReducer, initialRoot, flatten);
  const selectors = useMemo<BoundSelectors>(() => ({
    selectFlat: (options?: SelectFlatOptions) => selectFlat(state, options),
    selectAncestorIds: (id: string) => selectAncestorIds(state, id),
    selectTree: () => selectTree(state),
  }), [state]);

  return { state, dispatch, selectors };
}
