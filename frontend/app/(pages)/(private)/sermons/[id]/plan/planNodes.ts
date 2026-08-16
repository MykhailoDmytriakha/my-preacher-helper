import type { SermonPoint, SubPoint } from "@/models/models";

/**
 * A PLAN NODE is one cell of the outline a preacher writes into.
 *
 * The plan screen used to hold exactly one text per outline point, which forced anyone
 * preparing WITHOUT thoughts to keep the hierarchy in their head and type the sub-point
 * headings by hand. A sermon prepared as a conspectus is the opposite: the skeleton is
 * already there, detailed, and the work is filling it in cell by cell.
 *
 * So text is stored AT THE NODE — keyed by the point's id or the sub-point's id. The
 * stored shape does not change (`SermonContent.outlinePoints` is `Record<string, string>`
 * and ids are unique), but three things start working for free: renaming a sub-point
 * keeps its text, reordering carries the text along, and moving a sub-point to another
 * point moves what was written under it.
 */
export interface PlanNode {
  /** Key into `plan.<section>.outlinePoints` — the point's id or the sub-point's id. */
  id: string;
  /** Heading shown above the cell. Empty for the point's own cell: the card already names it. */
  heading: string;
  /**
   * Hierarchical number — "2" for a point, "2.1" for its first sub-point.
   *
   * The heading text alone cannot carry the level: a sub-point may be titled anything,
   * and on screen "Point B" nested under "Point A" read as another top-level point. The
   * number states the level regardless of what the preacher named things.
   */
  label: string;
  kind: "point" | "subPoint";
}

/** Sub-points in the order the preacher arranged them. */
export function orderedSubPoints(outlinePoint: SermonPoint): SubPoint[] {
  return [...(outlinePoint.subPoints ?? [])].sort((a, b) => a.position - b.position);
}

/**
 * The cells of one outline point, in reading order: the point's own cell first, then one
 * per sub-point. A point without sub-points yields a single cell — the plan screen then
 * looks exactly as it did before, which is the point: no "sub-point mode" to switch into.
 */
export function planNodesForPoint(outlinePoint: SermonPoint, pointIndex = 0): PlanNode[] {
  const pointLabel = String(pointIndex + 1);

  return [
    { id: outlinePoint.id, heading: "", label: pointLabel, kind: "point" },
    ...orderedSubPoints(outlinePoint).map<PlanNode>((subPoint, subPointIndex) => ({
      id: subPoint.id,
      heading: subPoint.text,
      label: `${pointLabel}.${subPointIndex + 1}`,
      kind: "subPoint",
    })),
  ];
}

/** Does this point hold any written text, in its own cell or in any sub-point cell? */
export function pointHasContent(
  outlinePoint: SermonPoint,
  contentByNodeId: Record<string, string>
): boolean {
  return planNodesForPoint(outlinePoint).some((node) => Boolean(contentByNodeId[node.id]?.trim()));
}
