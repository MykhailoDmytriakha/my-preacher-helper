import type { OutlinePoint, SermonOutline, SubPoint } from "@/models/models";

type OutlineSectionKey = keyof Pick<SermonOutline, "introduction" | "main" | "conclusion">;

type WithSubPointPosition = {
  id: string;
  subPointId?: string | null;
  position?: number;
};

export type ResolvedOutlineLocation = {
  outlinePoint: OutlinePoint;
  section: OutlineSectionKey;
  subPoint: SubPoint | null;
};

export type SubPointRenderableEntry<T extends WithSubPointPosition> =
  | { type: "item"; item: T }
  | { type: "subPoint"; subPoint: SubPoint; items: T[] };

const POSITION_FALLBACK = Number.MAX_SAFE_INTEGER;

const getNumericPosition = (value?: number) =>
  typeof value === "number" ? value : POSITION_FALLBACK;

export const sortSubPointsByPosition = (subPoints: SubPoint[] = []): SubPoint[] =>
  [...subPoints].sort((left, right) => left.position - right.position);

export const buildSubPointIdSet = (subPoints: SubPoint[] = []) =>
  new Set(sortSubPointsByPosition(subPoints).map((subPoint) => subPoint.id));

export const normalizeSubPointId = (
  subPointId: string | null | undefined,
  subPoints: SubPoint[] = [],
): string | null => {
  if (!subPointId) return null;
  return buildSubPointIdSet(subPoints).has(subPointId) ? subPointId : null;
};

export const findOutlinePointLocation = (
  sermonOutline: SermonOutline | undefined,
  outlinePointId: string | null | undefined,
): { outlinePoint: OutlinePoint; section: OutlineSectionKey } | null => {
  if (!sermonOutline || !outlinePointId) return null;

  const sections: OutlineSectionKey[] = ["introduction", "main", "conclusion"];
  for (const section of sections) {
    const outlinePoint = sermonOutline[section]?.find((point) => point.id === outlinePointId);
    if (outlinePoint) {
      return { outlinePoint, section };
    }
  }

  return null;
};

export const resolveThoughtOutlineLocation = (
  sermonOutline: SermonOutline | undefined,
  outlinePointId: string | null | undefined,
  subPointId: string | null | undefined,
): ResolvedOutlineLocation | null => {
  const pointLocation = findOutlinePointLocation(sermonOutline, outlinePointId);
  if (!pointLocation) return null;

  const normalizedSubPointId = normalizeSubPointId(subPointId, pointLocation.outlinePoint.subPoints);
  const subPoint = normalizedSubPointId
    ? pointLocation.outlinePoint.subPoints?.find((candidate) => candidate.id === normalizedSubPointId) ?? null
    : null;

  return {
    outlinePoint: pointLocation.outlinePoint,
    section: pointLocation.section,
    subPoint,
  };
};

export function buildSubPointRenderableEntries<T extends WithSubPointPosition>(
  items: T[],
  subPoints: SubPoint[] = [],
): Array<SubPointRenderableEntry<T>> {
  const sortedSubPoints = sortSubPointsByPosition(subPoints);
  if (sortedSubPoints.length === 0) {
    return items.map((item) => ({ type: "item", item }));
  }

  const indexedItems = items.map((item, index) => ({ item, index }));
  const subPointIds = new Set(sortedSubPoints.map((subPoint) => subPoint.id));

  const entries = [
    ...indexedItems
      .filter(({ item }) => !item.subPointId || !subPointIds.has(item.subPointId))
      .map(({ item, index }) => ({
        type: "item" as const,
        item,
        position: getNumericPosition(item.position),
        fallbackIndex: index,
      })),
    ...sortedSubPoints.map((subPoint, index) => ({
      type: "subPoint" as const,
      subPoint,
      items: indexedItems
        .filter(({ item }) => item.subPointId === subPoint.id)
        .sort((left, right) => {
          const positionDiff = getNumericPosition(left.item.position) - getNumericPosition(right.item.position);
          if (positionDiff !== 0) return positionDiff;
          return left.index - right.index;
        })
        .map(({ item }) => item),
      position: getNumericPosition(subPoint.position),
      fallbackIndex: items.length + index,
    })),
  ];

  entries.sort((left, right) => {
    const positionDiff = left.position - right.position;
    if (positionDiff !== 0) return positionDiff;
    return left.fallbackIndex - right.fallbackIndex;
  });

  return entries.map((entry) => {
    if (entry.type === "item") {
      return { type: "item", item: entry.item };
    }

    return {
      type: "subPoint",
      subPoint: entry.subPoint,
      items: entry.items,
    };
  });
}

export function flattenSubPointRenderableEntries<T extends WithSubPointPosition>(
  entries: Array<SubPointRenderableEntry<T>>,
): T[] {
  return entries.flatMap((entry) => (
    entry.type === "item" ? [entry.item] : entry.items
  ));
}
