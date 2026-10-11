import type { ExegeticalPlanNode } from '@/models/models';

export const createNodeId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as { randomUUID: () => string }).randomUUID();
    }
  } catch { }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const createNewNode = (): ExegeticalPlanNode => ({
  id: createNodeId(),
  title: '',
  children: []
});

export const syncDraftTitles = (nodes: ExegeticalPlanNode[]): Record<string, string> => {
  const draftTitles: Record<string, string> = {};
  const syncNode = (node: ExegeticalPlanNode) => {
    draftTitles[node.id] = node.title || '';
    if (node.children) {
      node.children.forEach(syncNode);
    }
  };
  nodes.forEach(syncNode);
  return draftTitles;
};

export const mergeDraftTitles = (
  nodes: ExegeticalPlanNode[],
  draftTitles: Record<string, string>
): ExegeticalPlanNode[] => {
  return nodes.map(node => ({
    ...node,
    title: draftTitles[node.id] !== undefined ? draftTitles[node.id] : (node.title || ''),
    children: node.children ? mergeDraftTitles(node.children, draftTitles) : []
  }));
};

/*
 * Tree operations change only the path to the point they act on: every other point keeps exactly
 * what is stored (no `children: []` added where there were none). A plan kept in a document is
 * merged with other devices field by field, and an untouched point that looks changed turns
 * another device's edit or deletion of it into a false conflict.
 */
export const setNodeTitle = (
  nodes: ExegeticalPlanNode[],
  id: string,
  title: string
): ExegeticalPlanNode[] => {
  return nodes.map(n => {
    if (n.id === id) return { ...n, title };
    return n.children ? { ...n, children: setNodeTitle(n.children, id, title) } : n;
  });
};

/** Where a point sits: its parent's id (null at the top level) and its index among its siblings. */
export const findPlace = (
  nodes: ExegeticalPlanNode[],
  id: string,
  parentId: string | null = null
): { parentId: string | null; index: number } | null => {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parentId, index: i };
    const inner = nodes[i].children ? findPlace(nodes[i].children!, id, nodes[i].id) : null;
    if (inner) return inner;
  }
  return null;
};

const insertAt = (nodes: ExegeticalPlanNode[], index: number, node: ExegeticalPlanNode) => {
  const next = [...nodes];
  next.splice(Math.min(index, next.length), 0, node);
  return next;
};

/** Put a point at a place; a parent that is gone sends it to the end of the top level. */
export const insertNode = (
  nodes: ExegeticalPlanNode[],
  place: { parentId: string | null; index: number },
  node: ExegeticalPlanNode
): ExegeticalPlanNode[] => {
  const { parentId, index } = place;
  if (parentId === null) return insertAt(nodes, index, node);
  if (!findPlace(nodes, parentId)) return [...nodes, node];
  const into = (list: ExegeticalPlanNode[]): ExegeticalPlanNode[] => list.map(n => {
    if (n.id === parentId) return { ...n, children: insertAt(n.children ?? [], index, node) };
    return n.children ? { ...n, children: into(n.children) } : n;
  });
  return into(nodes);
};

export const removeNode = (
  nodes: ExegeticalPlanNode[],
  idToRemove: string
): ExegeticalPlanNode[] => {
  return nodes
    .filter(n => n.id !== idToRemove)
    .map(n => n.children ? { ...n, children: removeNode(n.children, idToRemove) } : n);
};

export const addChildNode = (
  nodes: ExegeticalPlanNode[],
  parentId: string,
  newNode: ExegeticalPlanNode
): ExegeticalPlanNode[] => {
  return nodes.map(n => {
    if (n.id === parentId) {
      return { ...n, children: [...(n.children || []), newNode] };
    }
    return n.children ? { ...n, children: addChildNode(n.children, parentId, newNode) } : n;
  });
};

export const addSiblingNode = (
  nodes: ExegeticalPlanNode[],
  siblingId: string,
  newNode: ExegeticalPlanNode
): ExegeticalPlanNode[] => {
  const result: ExegeticalPlanNode[] = [];

  nodes.forEach(n => {
    const updated = n.children && n.children.length > 0
      ? { ...n, children: addSiblingNode(n.children, siblingId, newNode) }
      : n;
    result.push(updated);

    if (n.id === siblingId) {
      result.push(newNode);
    }
  });

  return result;
};

export const areTreesEqual = (
  tree1: ExegeticalPlanNode[],
  tree2: ExegeticalPlanNode[]
): boolean => {
  if (tree1.length !== tree2.length) return false;

  const compareNode = (node1: ExegeticalPlanNode, node2: ExegeticalPlanNode): boolean => {
    if (node1.id !== node2.id) return false;
    if (node1.title !== node2.title) return false;
    if ((node1.children?.length || 0) !== (node2.children?.length || 0)) return false;

    if (node1.children && node2.children) {
      for (let i = 0; i < node1.children.length; i++) {
        if (!compareNode(node1.children[i], node2.children[i])) return false;
      }
    }

    return true;
  };

  for (let i = 0; i < tree1.length; i++) {
    if (!compareNode(tree1[i], tree2[i])) return false;
  }

  return true;
};

/**
 * Lift a point to its parent's level, right after the parent. `from` is the parent the person saw:
 * if the point has been moved under another one meanwhile, nothing changes.
 */
export const promoteNode = (
  nodes: ExegeticalPlanNode[],
  id: string,
  from?: string
): ExegeticalPlanNode[] => {
  if (from !== undefined && findPlace(nodes, id)?.parentId !== from) return nodes;
  // Check if node is a direct child of any of these nodes
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.children?.some(child => child.id === id)) {
      const childIndex = node.children.findIndex(child => child.id === id);
      const childToPromote = node.children[childIndex];

      const newChildren = [...node.children];
      newChildren.splice(childIndex, 1);

      const newNodes = [...nodes];
      newNodes[i] = { ...node, children: newChildren };
      newNodes.splice(i + 1, 0, childToPromote);
      return newNodes;
    }

    // Recurse (a point without children cannot hold the target)
    if (!node.children?.length) continue;
    const updatedChildren = promoteNode(node.children, id);
    if (updatedChildren !== node.children) {
      const newNodes = [...nodes];
      newNodes[i] = { ...node, children: updatedChildren };
      return newNodes;
    }
  }

  return nodes;
};

const findNode = (nodes: ExegeticalPlanNode[], id: string): ExegeticalPlanNode | null => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = n.children ? findNode(n.children, id) : null;
    if (inner) return inner;
  }
  return null;
};

/** The point right above a point among its siblings — where a demotion puts it. */
export const previousSiblingId = (nodes: ExegeticalPlanNode[], id: string): string | null => {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return i > 0 ? nodes[i - 1].id : null;
    const inner = nodes[i].children ? previousSiblingId(nodes[i].children!, id) : null;
    if (inner) return inner;
  }
  return null;
};

/**
 * Move a point to the end of `under`'s children. `under` is the point the person saw above it —
 * passed in when the plan may have been reordered since, otherwise its previous sibling here.
 */
export const demoteNode = (
  nodes: ExegeticalPlanNode[],
  id: string,
  under: string | null = previousSiblingId(nodes, id)
): ExegeticalPlanNode[] => {
  const moving = findNode(nodes, id);
  if (!under || !moving || findNode([moving], under) || !findNode(nodes, under)) return nodes;
  return addChildNode(removeNode(nodes, id), under, moving);
};
