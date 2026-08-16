import { buildSectionOutlineMarkdown } from "@/(pages)/(private)/sermons/[id]/plan/buildSectionOutlineMarkdown";

import type { CombinedPlan } from "@/(pages)/(private)/sermons/[id]/plan/types";
import type { Sermon, SermonOutline } from "@/models/models";

/**
 * THE TEXT OF A PLAN, KEYED BY THE NODE IT BELONGS TO.
 *
 * The plan used to be stored three times over: the structure in `sermon.outline`, the text
 * in `plan.<section>.outlinePoints`, and the ASSEMBLED document in `plan.<section>.outline`
 * — which is what reading, preaching and export actually took. Three copies of one truth,
 * kept in step by hand, and they drifted: one of the owner's sermons holds three cells of
 * text and zero points in its structure.
 *
 * Now there is one place for text, `sermon.planText`, addressed by node id, and the
 * assembled document is not stored at all — `renderPlan` builds it when someone reads it.
 * A document that is never stored cannot fall out of step with the data it came from.
 *
 * Two properties follow, and they are the whole point:
 *   - a write touches ONE key, so saving one card cannot overwrite another;
 *   - text left behind by a deleted node is inert, because assembly walks the STRUCTURE.
 *
 * Reading understands the old shape too — see `readPlanText`. That is what lets the new
 * code go out while the stored data is still in the old form, which matters here because
 * production and local run against the SAME database.
 */

/** Node id → the text written under that node. */
export type PlanTextMap = Record<string, string>;

const SECTIONS = ["introduction", "main", "conclusion"] as const;
type SectionKey = (typeof SECTIONS)[number];

/**
 * Every node id the structure currently holds — points and sub-points alike. Assembly and
 * cleanup both need it: it is the definition of "text that still belongs to something".
 */
export function liveNodeIds(outline: SermonOutline | null | undefined): Set<string> {
  const ids = new Set<string>();
  SECTIONS.forEach((section) => {
    (outline?.[section] ?? []).forEach((point) => {
      ids.add(point.id);
      (point.subPoints ?? []).forEach((subPoint) => ids.add(subPoint.id));
    });
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
  const collected: PlanTextMap = {};

  const stored = sermon.plan ?? sermon.draft;
  if (stored) {
    SECTIONS.forEach((section) => {
      Object.entries(stored[section]?.outlinePoints ?? {}).forEach(([nodeId, text]) => {
        if (typeof text === "string") collected[nodeId] = text;
      });
    });
  }

  Object.entries(sermon.planText ?? {}).forEach(([nodeId, text]) => {
    if (typeof text === "string") collected[nodeId] = text;
  });

  return collected;
}

/**
 * The document a preacher reads — assembled on the spot from structure plus text.
 *
 * Nothing here is persisted. That is deliberate: the stored assembled string was the copy
 * that went stale, printed headings of deleted points, and had to be rebuilt by hand after
 * every edit.
 */
export function renderPlan(
  outline: SermonOutline | null | undefined,
  text: PlanTextMap
): CombinedPlan {
  const section = (key: SectionKey) => buildSectionOutlineMarkdown({
    orderedOutlinePoints: outline?.[key] ?? [],
    outlinePointsContentById: text,
  });

  return {
    introduction: section("introduction"),
    main: section("main"),
    conclusion: section("conclusion"),
  };
}

/**
 * Assembles a whole sermon's plan, and NEVER lets an existing one vanish.
 *
 * A sermon written before per-node cells existed may hold only the assembled string for a
 * section, with nothing to assemble from. Building strictly from structure plus text would
 * hand such a section back empty — a plan that disappears the day this ships. So when a
 * section assembles to nothing and storage still holds text for it, the stored text is
 * shown exactly as it always was, until someone edits that section and it moves over.
 */
export function renderPlanWithFallback(
  sermon: Sermon | null | undefined,
  /** The text as it is ON SCREEN — includes edits not yet saved into the sermon. */
  liveText: PlanTextMap
): CombinedPlan {
  const assembled = renderPlan(sermon?.outline, liveText);
  const stored = sermon?.plan ?? sermon?.draft;
  if (!stored) return assembled;

  const text = liveText;
  const withFallback = { ...assembled };
  SECTIONS.forEach((section) => {
    // "Nothing to assemble from" means no NODE OF THIS SECTION holds text — not that the
    // assembly came out empty, because a bare structure still yields its headings.
    const nodeIds = (sermon?.outline?.[section] ?? []).flatMap((point) => (
      [point.id, ...((point.subPoints ?? []).map((sub) => sub.id))]
    ));
    const sectionHasText = nodeIds.some((id) => (text[id] ?? "").trim() !== "");

    /**
     * A CLEARED CELL IS AN ANSWER, AND THE FALLBACK MUST NOT ARGUE WITH IT.
     *
     * The fallback exists for sections nobody has ever written under the new shape. Once a
     * node here has been WRITTEN — even written empty — this section is being maintained in
     * the new shape, and showing the old assembled string would undo the person's edit in
     * front of them: they clear a card, reload, and yesterday's paragraph is back.
     *
     * So an empty string counts as "written", while a node that was simply never touched
     * does not.
     */
    const sectionWasWritten = nodeIds.some((id) => (sermon?.planText ?? {})[id] !== undefined);

    if (!sectionHasText && !sectionWasWritten && (stored[section]?.outline ?? "").trim() !== "") {
      withFallback[section] = stored[section]?.outline ?? "";
    }
  });
  return withFallback;
}

/** For readers holding only a sermon — exports, menus, anything without editor state. */
export function renderPlanFromSermon(sermon: Sermon | null | undefined): CombinedPlan {
  return renderPlanWithFallback(sermon, readPlanText(sermon));
}

/**
 * Is anything written in this plan at all?
 *
 * Asked of the TEXT rather than of the stored document, because the stored document is on
 * its way out. Text belonging to nodes that no longer exist does not count as a plan — it
 * is debris, and answering "yes" on debris would put an empty screen in front of someone.
 */
export function hasWrittenPlan(sermon: Sermon | null | undefined): boolean {
  const text = readPlanText(sermon);
  const live = liveNodeIds(sermon?.outline);
  if (Object.entries(text).some(([nodeId, body]) => live.has(nodeId) && body.trim() !== "")) {
    return true;
  }

  // An older sermon may hold only the assembled string — see `renderPlanFromSermon`.
  // It still has a plan, and answering "no" would route someone away from it.
  const stored = sermon?.plan ?? sermon?.draft;
  return SECTIONS.some((section) => (stored?.[section]?.outline ?? "").trim() !== "");
}
