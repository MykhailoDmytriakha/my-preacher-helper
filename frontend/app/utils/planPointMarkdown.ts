import { PlanPointContentResponseSchema, type PlanPointContentResponse } from '@/config/schemas/zod/planPointContent.zod';

/**
 * Canonicalize every arrow spelling to a single " → ". The model emits inconsistent
 * separators ("->", "-->", "—>", "=>", "→"), which renders as an ugly mix next to the
 * assembler's own "→" prefix. We normalize deterministically rather than trust the model
 * to pick one glyph. A leading arrow is dropped so the assembler's "→ " prefix never doubles.
 */
function normalizeArrows(text: string): string {
  return text
    .replace(/\s*(?:-{1,2}>|—>|=>|→)\s*/g, " → ")
    .replace(/^\s*→\s*/, "")
    .trim();
}

/**
 * Deterministically assemble the structured cue card (v13) into markdown. The model
 * returns ONLY the filling (turn + per-group cues/refs); the outline-point and sub-point
 * HEADINGS belong to the sermon structure, not to this content.
 *
 * Layout (v13):
 *   **→ turn**            — route arrow, RIGHT under the outline-point heading (arrows → →)
 *   ### {sub-point}       — sub-point heading as a real h3 (only when sub-points exist)
 *   - cue                 — recall triggers that stand on their own
 *   **{set label}**       — names a MOVE the thought already makes, with its items under it
 *   - item                — the members of that move, in one shape
 *   *ref*                 — that group's verses, one per line under its cues
 *
 * A set is NOT a heading: headings belong to the preacher's structure. It is a caption over a
 * handful of cues that belong together — three images of one emptiness, two sides of one faith,
 * then/now — and without it a list of six bullets hides the very shape the preacher wants to see
 * at a glance. Where a thought has no such shape, `sets` is empty and the list stays flat.
 * No anchor/title is emitted: the outline point already provides the heading, and emitting
 * one produced a heading nested inside the outline-point heading. Sub-point headings are h3
 * (matching the structure skeleton in buildSectionOutlineMarkdown) so the UI gives them a
 * marker + indent and the Word export (#..###) nests them under the point.
 */
export function assemblePlanPointMarkdown(data: PlanPointContentResponse): string {
  const lines: string[] = [];

  // Route arrow at the TOP, right under the outline-point heading. All arrows → "→".
  const turn = normalizeArrows((data.turn ?? "").trim());
  if (turn) lines.push(`**→ ${turn}**`);

  for (const group of data.groups ?? []) {
    const heading = (group.heading ?? "").trim();
    const cues = (group.cues ?? []).map((c) => normalizeArrows(c.trim())).filter(Boolean);
    // refs carry recognizable verse text; each renders on its own italic line.
    const refs = (group.refs ?? []).map((r) => r.trim()).filter(Boolean);
    const sets = (group.sets ?? []).filter((set) => set?.label?.trim() && (set.items ?? []).some((i) => i.trim()));
    if (!heading && cues.length === 0 && sets.length === 0 && refs.length === 0) continue;

    lines.push(""); // blank line detaches this group from whatever came before
    // Sub-point heading as a real h3 level (no heading when there are no sub-points).
    if (heading) lines.push(`### ${heading}`);
    cues.forEach((c) => lines.push(`- ${c}`));

    // Each set: a bold caption paragraph, then its items as an ordinary list. A blank line
    // before the caption keeps it a paragraph of its own rather than a bullet's continuation.
    for (const set of sets) {
      const label = (set.label ?? "").trim();
      const items = (set.items ?? []).map((i) => normalizeArrows(i.trim())).filter(Boolean);
      if (!label || items.length === 0) continue;
      // Only separate from what came before if something actually came before: a group whose
      // cues all moved into sets would otherwise open with two blank lines.
      if (lines[lines.length - 1] !== "") lines.push("");
      lines.push(`**${label}**`);
      items.forEach((i) => lines.push(`- ${i}`));
    }
    // Each verse on its OWN line: a blank line before every ref makes it a separate
    // paragraph. Without it, "*a*\n*b*\n*c*" is one paragraph (soft breaks collapse to
    // spaces) and the verses render run-together. Works for both the UI markdown render
    // and the line-based Word export.
    refs.forEach((r) => lines.push("", `*${r}*`));
  }

  return lines.join("\n").trim();
}

export function storedPlanPointContent(value: unknown): string {
  return assemblePlanPointMarkdown(PlanPointContentResponseSchema.parse(value));
}
