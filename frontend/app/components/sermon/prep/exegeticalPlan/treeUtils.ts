import type { ExegeticalPlanNode } from '@/models/models';

export const createNodeId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as { randomUUID: () => string }).randomUUID();
    }
  } catch {}
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

export const removeNode = (
  nodes: ExegeticalPlanNode[],
  idToRemove: string
): ExegeticalPlanNode[] => {
  return nodes
    .filter(n => n.id !== idToRemove)
    .map(n => ({
      ...n,
      children: n.children ? removeNode(n.children, idToRemove) : []
    }));
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
    return { ...n, children: n.children ? addChildNode(n.children, parentId, newNode) : [] };
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
