import { ThoughtsBySection, Item, Sermon, SermonPoint } from "@/models/models";
import { LOCAL_THOUGHT_PREFIX } from "@/utils/pendingThoughtsStore";

/**
 * Check if structure has changed between two states
 */
export const isStructureChanged = (
  structurePrev: string | ThoughtsBySection | Record<string, unknown> | null | undefined,
  structureNew: string | ThoughtsBySection | Record<string, unknown> | null | undefined
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

export const isLocalThoughtId = (id: string): boolean => id.startsWith(LOCAL_THOUGHT_PREFIX);

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

export const buildStructureFromContainers = (containers: Record<string, Item[]>): ThoughtsBySection => {
  const synced = (items: Item[]) => items.filter((item) => !isLocalThoughtId(item.id));

  return {
    introduction: dedupeIds(synced(containers.introduction || []).map((item) => item.id)),
    main: dedupeIds(synced(containers.main || []).map((item) => item.id)),
    conclusion: dedupeIds(synced(containers.conclusion || []).map((item) => item.id)),
    ambiguous: dedupeIds(synced(containers.ambiguous || []).map((item) => item.id)),
  };
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
  } else {
    movedIndex = target;
  }

  // Validate the index
  if (movedIndex === -1 || movedIndex < 0 || movedIndex >= items.length) {
    return -1; // Item not found or invalid index
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

/**
 * Helper function to find an outline point by ID within a sermon's outline
 */
export function findOutlinePoint(
  outlinePointId: string | undefined,
  sermon: Sermon | null
): { text: string; section: string } | undefined {
  if (!outlinePointId || !sermon?.outline) {
    return undefined;
  }

  const sections = ['introduction', 'main', 'conclusion'] as const;
  for (const section of sections) {
    const point = sermon.outline[section]?.find((p: SermonPoint) => p.id === outlinePointId);
    if (point) {
      return {
        text: point.text,
        section: '' // Don't show section in structure page
      };
    }
  }
  return undefined;
}

/**
 * Helper function to build an Item object for UI rendering
 */
export function buildItemForUI(params: {
  id: string;
  text: string;
  tags: string[];
  allowedTags: { name: string; color: string }[];
  sectionTag?: string;
  outlinePointId?: string;
  outlinePoint?: { text: string; section: string };
}): Item {
  const { id, text, tags, allowedTags, sectionTag, outlinePointId, outlinePoint } = params;

  return {
    id,
    content: text,
    customTagNames: tags.map((tagName) => ({
      name: tagName,
      color: allowedTags.find((tag) => tag.name === tagName)?.color || "#4c51bf",
    })),
    requiredTags: sectionTag ? [sectionTag] : [],
    outlinePointId,
    outlinePoint,
  };
}
