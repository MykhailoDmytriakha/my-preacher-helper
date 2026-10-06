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
 * THE CELLS A PLAN EDITOR SHOWS ONCE STORAGE HAS SPOKEN — one rule for both plan editors.
 *
 * Storage wins, except for a cell the screen must keep: one being typed into, or one whose
 * write is still queued. A cell storage no longer holds leaves the screen too. Merging the new
 * text over the old screen kept it (BUG-20261003-plan-seeding-keeps-removed-cell): the editor
 * showed text its document had lost, and the next save of that point was refused as a change
 * from another device.
 */
export function mergeStoredPlanText(
  screen: PlanTextMap,
  stored: PlanTextMap,
  keepScreen: (nodeId: string) => boolean
): PlanTextMap {
  const next: PlanTextMap = { ...stored };
  Object.keys(screen).forEach((nodeId) => {
    if (keepScreen(nodeId)) next[nodeId] = screen[nodeId];
  });
  return next;
}

/**
 * The "saved" marks that go with `mergeStoredPlanText`: every stored cell counts as saved unless
 * the screen already says otherwise, and a cell that left the screen leaves its mark behind —
 * kept, it showed an empty card as filled and held its save button disabled.
 */
export function mergeStoredSavedFlags(
  saved: Record<string, boolean>,
  stored: PlanTextMap,
  keepScreen: (nodeId: string) => boolean
): Record<string, boolean> {
  const next: Record<string, boolean> = Object.fromEntries(Object.keys(stored).map((nodeId) => [nodeId, true]));
  Object.keys(saved).forEach((nodeId) => {
    if (nodeId in stored || keepScreen(nodeId)) next[nodeId] = saved[nodeId];
  });
  return next;
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
  if (!sermon?.plan && !sermon?.draft) return assembled;

  const withFallback = { ...assembled };
  SECTIONS.forEach((section) => {
    const fallback = legacySectionText(sermon, section, liveText);
    if (fallback) withFallback[section] = fallback;
  });
  return withFallback;
}

/**
 * PER SECTION, WHICHEVER OLD COPY ACTUALLY HOLDS TEXT — not a fixed winner.
 *
 * A sermon from before the split may hold both `plan` and `draft`, and they can each be
 * complete in different sections: one holds only the introduction, the working copy holds
 * all three. Choosing one document wholesale then dropped the other's sections on the
 * floor, which is a plan losing text in front of its author. Asking section by section
 * costs nothing and cannot lose anything, so the question "which one wins" stops existing.
 *
 * Where both hold this section, `plan` wins — it is the saved document and `draft` the
 * legacy field, as the export path has always said in words and as the repository does
 * when it hydrates `plan` from `plan` first. Two suites used to encode OPPOSITE orders
 * here because the two code paths never met; they meet now, and this is the order — and
 * the ONLY place it is decided: `hasWrittenPlan` once asked `plan ?? draft` wholesale and
 * `writtenSections` asked `draft ?? plan`, so an empty `plan` hid a written `draft` behind
 * the "not ready" screen (found 2026-10-03, BUG-20261002-sermon-read-only-copy-bare-page).
 * Whether that text is SHOWN is `legacySectionText`'s answer, and the predicates ask it too.
 */
function storedSectionOutline(sermon: Sermon | null | undefined, section: SectionKey): string {
  const fromPlan = sermon?.plan?.[section]?.outline ?? "";
  return fromPlan.trim() ? fromPlan : sermon?.draft?.[section]?.outline ?? "";
}

/**
 * The old whole-section text a section still stands on, or "" once the section lives in the
 * per-node shape. One rule for the assembled plan above and for the screens that show it on a
 * copy for reading (BUG-20261002-sermon-read-only-copy-bare-page).
 */
export function legacySectionText(
  sermon: Sermon | null | undefined,
  section: SectionKey,
  /** The text as it is ON SCREEN — includes edits not yet saved into the sermon. */
  liveText: PlanTextMap
): string {
  const fallback = storedSectionOutline(sermon, section);
  if (fallback.trim() === "") return "";

  // "Nothing to assemble from" means no NODE OF THIS SECTION holds text — not that the
  // assembly came out empty, because a bare structure still yields its headings.
  const nodeIds = (sermon?.outline?.[section] ?? []).flatMap((point) => (
    [point.id, ...((point.subPoints ?? []).map((sub) => sub.id))]
  ));
  const sectionHasText = nodeIds.some((id) => (liveText[id] ?? "").trim() !== "");

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

  return sectionHasText || sectionWasWritten ? "" : fallback;
}

/**
 * Which sections actually have something WRITTEN in them.
 *
 * Not the same question as "is the assembled section non-empty": assembly prints the
 * structure's headings, so a section with points and no text still comes back full of text
 * and would answer yes to anything that just checked the string. Readiness to preach asked
 * exactly that and called an untouched plan ready.
 */
export function writtenSections(sermon: Sermon | null | undefined): Record<SectionKey, boolean> {
  const text = readPlanText(sermon);
  const live = liveNodeIds(sermon?.outline);
  const written = (section: SectionKey): boolean => {
    const nodeIds = (sermon?.outline?.[section] ?? []).flatMap((point) => (
      [point.id, ...((point.subPoints ?? []).map((sub) => sub.id))]
    ));
    if (nodeIds.some((id) => live.has(id) && (text[id] ?? "").trim() !== "")) return true;
    // An older sermon may hold only the assembled string for this section — see `hasWrittenPlan`.
    return legacySectionText(sermon, section, text) !== "";
  };
  return { introduction: written("introduction"), main: written("main"), conclusion: written("conclusion") };
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
  // It still has a plan, and answering "no" would route someone away from it. Counted exactly as
  // the plan is drawn (`legacySectionText`): a section rewritten in cells, even emptied, no longer
  // stands on its old string, so neither "ready to preach" nor exports may count it.
  return SECTIONS.some((section) => legacySectionText(sermon, section, text) !== "");
}
