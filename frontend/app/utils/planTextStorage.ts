import type { Sermon, SermonOutline } from "@/models/models";

/** Node id → the text written under that node. */
export type PlanTextMap = Record<string, string>;

export const PLAN_TEXT_SECTIONS = ["introduction", "main", "conclusion"] as const;

/**
 * Every node id the structure currently holds — points and sub-points alike. Assembly and
 * cleanup both need it: it is the definition of "text that still belongs to something".
 */
export function liveNodeIds(outline: SermonOutline | null | undefined): Set<string> {
  const ids = new Set<string>();
  PLAN_TEXT_SECTIONS.forEach((section) => {
    const points = outline?.[section];
    if (!Array.isArray(points)) return;
    for (const point of points) {
      if (typeof point?.id !== "string") continue;
      ids.add(point.id);
      if (!Array.isArray(point.subPoints)) continue;
      for (const subPoint of point.subPoints) {
        if (typeof subPoint?.id === "string") ids.add(subPoint.id);
      }
    }
  });
  return ids;
}

/**
 * The plan's text, wherever it currently lives.
 *
 * `planText` wins when present. Otherwise the old per-section cells are read and flattened
 * into the same shape — a pure read, changing nothing in storage. A sermon therefore keeps
 * working untouched until the first save moves it over.
 */
export function readPlanText(sermon: Sermon | null | undefined): PlanTextMap {
  if (!sermon) return {};

  /**
   * MERGED, NOT CHOSEN — and this distinction is the whole safety of the transition.
   *
   * Preferring `planText` wholesale looked right and silently hid text: a sermon whose
   * section held two points, of which only one had been saved since, ends up with ONE key
   * in `planText`. Treating that as "the new shape is in charge" made the OTHER point
   * vanish from the editor, from reading, from preaching and from export — its text still
   * in storage, simply no longer looked at.
   *
   * So the old cells are the base and the new keys are laid over them: whatever has been
   * written under the new shape wins for its own node, and every node not yet moved keeps
   * showing what it always had. A sermon converges as it is used, and never loses sight of
   * anything on the way.
   */
  const collected = Object.create(null) as PlanTextMap;
  const addCells = (cells: unknown) => {
    if (!cells || typeof cells !== "object" || Array.isArray(cells)) return;
    for (const [nodeId, text] of Object.entries(cells)) {
      if (typeof text === "string") collected[nodeId] = text;
    }
  };

  const stored = sermon.plan ?? sermon.draft;
  if (stored) PLAN_TEXT_SECTIONS.forEach(section => addCells(stored[section]?.outlinePoints));
  addCells(sermon.planText);

  return { ...collected };
}
