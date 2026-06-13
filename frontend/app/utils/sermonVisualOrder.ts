import { buildSubPointRenderableEntries, flattenSubPointRenderableEntries } from "@/utils/subPoints";
import { getPreachOrderedThoughtsBySection } from "@/utils/thoughtOrdering";

import type { Sermon, SermonPoint, Thought } from "@/models/models";

export const VISUAL_SECTION_ORDER = ["introduction", "main", "conclusion", "ambiguous"] as const;

export type VisualSectionKey = (typeof VISUAL_SECTION_ORDER)[number];
export type VisualOutlineSectionKey = Exclude<VisualSectionKey, "ambiguous">;

type VisualOrderSermon = Pick<Sermon, "thoughts" | "structure" | "thoughtsBySection" | "outline">;

export function isVisualSectionKey(value: unknown): value is VisualSectionKey {
  return typeof value === "string" && VISUAL_SECTION_ORDER.includes(value as VisualSectionKey);
}

export function normalizeVisualSectionKey(value: unknown): VisualSectionKey | null {
  if (value === "mainPart") return "main";
  return isVisualSectionKey(value) ? value : null;
}

export function getVisualSectionOutlinePoints(
  sermon: Pick<Sermon, "outline">,
  section: VisualSectionKey,
): SermonPoint[] {
  if (section === "ambiguous") return [];
  return sermon.outline?.[section] ?? [];
}

/**
 * One source of truth for the visible thought order used by Structure/Plan:
 * section order -> outline point order -> direct thoughts/sub-points interleaved by position.
 */
export function getVisualOrderedThoughtsBySection(
  sermon: VisualOrderSermon,
  section: VisualSectionKey,
): Thought[] {
  const sectionThoughts = getPreachOrderedThoughtsBySection(sermon, section, { includeOrphans: true });
  const outlinePoints = getVisualSectionOutlinePoints(sermon, section);

  if (outlinePoints.length === 0) {
    return sectionThoughts;
  }

  const outlinePointIds = new Set(outlinePoints.map((point) => point.id));
  const usedThoughtIds = new Set<string>();
  const ordered: Thought[] = [];

  for (const point of outlinePoints) {
    const pointThoughts = sectionThoughts.filter((thought) => thought.outlinePointId === point.id);
    const pointVisualThoughts = flattenSubPointRenderableEntries(
      buildSubPointRenderableEntries(pointThoughts, point.subPoints ?? [])
    );

    for (const thought of pointVisualThoughts) {
      if (usedThoughtIds.has(thought.id)) continue;
      usedThoughtIds.add(thought.id);
      ordered.push(thought);
    }
  }

  for (const thought of sectionThoughts) {
    if (usedThoughtIds.has(thought.id)) continue;
    if (thought.outlinePointId && outlinePointIds.has(thought.outlinePointId)) continue;
    usedThoughtIds.add(thought.id);
    ordered.push(thought);
  }

  return ordered;
}

export function getVisualOrderedThoughtsForOutlinePoint(
  sermon: VisualOrderSermon,
  outlinePointId: string,
): Thought[] {
  const sections: VisualOutlineSectionKey[] = ["introduction", "main", "conclusion"];
  const section = sections.find((candidate) =>
    sermon.outline?.[candidate]?.some((point) => point.id === outlinePointId)
  );

  if (!section) return [];

  return getVisualOrderedThoughtsBySection(sermon, section).filter(
    (thought) => thought.outlinePointId === outlinePointId
  );
}
