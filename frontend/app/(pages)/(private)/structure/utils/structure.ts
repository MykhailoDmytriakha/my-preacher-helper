import { Structure, Item } from "@/models/models";

/**
 * Check if structure has changed between two states
 */
export const isStructureChanged = (
  structurePrev: string | Structure | Record<string, unknown> | null | undefined,
  structureNew: string | Structure | Record<string, unknown> | null | undefined
): boolean => {
  // Handle null/undefined cases gracefully
  if (structurePrev === null || structurePrev === undefined) {
    return structureNew !== null && structureNew !== undefined;
  }
  if (structureNew === null || structureNew === undefined) {
    return structurePrev !== null && structurePrev !== undefined;
  }

  const parse = (v: string | object) =>
    typeof v === "string" ? JSON.parse(v) : v;
  const prev = parse(structurePrev);
  const curr = parse(structureNew);
  const sections = ["introduction", "main", "conclusion", "ambiguous"];

  return sections.some(
    (section) => {
      const prevSection = prev[section] || [];
      const currSection = curr[section] || [];
      return prevSection.length !== currSection.length ||
        prevSection.some(
          (item: string, index: number) => item !== currSection[index]
        );
    }
  );
};

/**
 * Remove duplicate IDs from array
 */
export const dedupeIds = (ids: string[]): string[] => {
  return Array.from(new Set(ids));
};

/**
 * Ensure unique items by ID within a container
 */
export const ensureUniqueItems = (items: Item[]): Item[] => {
  const seen = new Set<string>();
  const result: Item[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    result.push(it);
  }
  return result;
};

/**
 * Remove an item ID from all sections except the specified one
 */
export const removeIdFromOtherSections = (
  all: Record<string, Item[]>, 
  keepIn: string, 
  idToKeep: string
): Record<string, Item[]> => {
  const sections = ["introduction", "main", "conclusion", "ambiguous"] as const;
  const result: Record<string, Item[]> = { ...all };
  for (const sec of sections) {
    if (sec === keepIn) continue;
    const arr = result[sec] || [];
    const filtered = arr.filter((it) => it.id !== idToKeep);
    if (filtered.length !== arr.length) {
      result[sec] = filtered;
    }
  }
  return result;
};

/**
 * Calculate intermediate position between two items
 */
export const calculateIntermediatePosition = (
  prevPos?: number, 
  nextPos?: number
): number => {
  if (prevPos !== undefined && nextPos !== undefined && prevPos < nextPos) {
    return (prevPos + nextPos) / 2;
  } else if (prevPos !== undefined) {
    return prevPos + 1000;
  } else if (nextPos !== undefined) {
    return nextPos - 1000;
  } else {
    return 1000;
  }
};

/**
 * Find position for item within a group (outline point or unassigned)
 */
export const calculateGroupPosition = (
  items: Item[],
  target: string | number,
  groupKey?: string
): number => {
  // Handle case where target is a string ID - find the index first
  let movedIndex: number;
  if (typeof target === 'string') {
    movedIndex = items.findIndex(item => item.id === target);
    if (movedIndex === -1) {
      return -1; // Item not found
    }
  } else {
    movedIndex = target;
    if (movedIndex < 0 || movedIndex >= items.length) {
      return -1; // Invalid index
    }
  }

  // If no groupKey provided, use the item's current group
  if (groupKey === undefined) {
    const item = items[movedIndex];
    if (!item) return -1;
    groupKey = item.outlinePointId || '__unassigned__';
  }

  // Collect items of the same group in current visual order
  const sameGroupIndexes: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const itKey = it.outlinePointId || '__unassigned__';
    if (itKey === groupKey) sameGroupIndexes.push(i);
  }

  // Find previous and next neighbor within the same group relative to movedIndex
  let prevIdxInSection: number | null = null;
  let nextIdxInSection: number | null = null;
  for (const idx of sameGroupIndexes) {
    if (idx < movedIndex) prevIdxInSection = idx;
    if (idx > movedIndex) { nextIdxInSection = idx; break; }
  }

  const prevItem = prevIdxInSection !== null ? items[prevIdxInSection] : undefined;
  const nextItem = nextIdxInSection !== null ? items[nextIdxInSection] : undefined;
  const prevPos = typeof prevItem?.position === 'number' ? (prevItem!.position as number) : undefined;
  const nextPos = typeof nextItem?.position === 'number' ? (nextItem!.position as number) : undefined;

  return calculateIntermediatePosition(prevPos, nextPos);
};
