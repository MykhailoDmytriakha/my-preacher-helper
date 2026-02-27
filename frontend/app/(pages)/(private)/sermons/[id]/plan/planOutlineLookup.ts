import type { SermonSectionKey } from "./types";
import type { Sermon, SermonPoint } from "@/models/models";

export interface PlanOutlineLookupEntry {
  section: SermonSectionKey;
  outlinePoint: SermonPoint;
}

export interface PlanOutlineLookup {
  byPointId: Record<string, PlanOutlineLookupEntry>;
  pointIdsBySection: Record<SermonSectionKey, string[]>;
  pointsBySection: Record<SermonSectionKey, SermonPoint[]>;
}

const PLAN_SECTION_KEYS: SermonSectionKey[] = ["introduction", "main", "conclusion"];

function createEmptyLookup(): PlanOutlineLookup {
  return {
    byPointId: {},
    pointIdsBySection: {
      introduction: [],
      main: [],
      conclusion: [],
    },
    pointsBySection: {
      introduction: [],
      main: [],
      conclusion: [],
    },
  };
}

export function buildPlanOutlineLookup(sermon: Sermon | null | undefined): PlanOutlineLookup {
  const lookup = createEmptyLookup();

  if (!sermon?.outline) {
    return lookup;
  }

  for (const section of PLAN_SECTION_KEYS) {
    const points = sermon.outline[section] || [];
    lookup.pointsBySection[section] = points;
    lookup.pointIdsBySection[section] = points.map((point) => point.id);

    // Preserve previous scan semantics: first match wins if duplicated ids ever appear.
    for (const point of points) {
      if (!lookup.byPointId[point.id]) {
        lookup.byPointId[point.id] = {
          section,
          outlinePoint: point,
        };
      }
    }
  }

  return lookup;
}

export function getPointSectionFromLookup(
  lookup: PlanOutlineLookup,
  pointId: string
): SermonSectionKey | null {
  return lookup.byPointId[pointId]?.section ?? null;
}

export function getPointFromLookup(
  lookup: PlanOutlineLookup,
  pointId: string
): SermonPoint | undefined {
  return lookup.byPointId[pointId]?.outlinePoint;
}
