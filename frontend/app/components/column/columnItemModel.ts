import type { Item } from '@/models/models';

/** Group once without sorting or dropping legacy orphan links. Empty points are unlocked. */
export function buildColumnItemIndex(items: Item[]) {
  const byPoint = new Map<string, { items: Item[]; isLocked: boolean }>();
  const unassigned: Item[] = [];
  for (const item of items) {
    if (!item.outlinePointId) {
      unassigned.push(item);
      continue;
    }
    let group = byPoint.get(item.outlinePointId);
    if (!group) {
      group = { items: [], isLocked: true };
      byPoint.set(item.outlinePointId, group);
    }
    group.items.push(item);
    group.isLocked = group.isLocked && Boolean(item.isLocked);
  }
  return { byPoint, unassigned };
}
