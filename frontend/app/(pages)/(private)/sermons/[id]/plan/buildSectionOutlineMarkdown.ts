import { orderedSubPoints } from "./planNodes";

import type { PlanExportCell, SermonPoint } from "@/models/models";


interface BuildSectionOutlineMarkdownParams {
  orderedOutlinePoints: SermonPoint[];
  outlinePointsContentById: Record<string, string>;
}

/**
 * ONE SECTION, ASSEMBLED FROM ITS CELLS.
 *
 * Text is written per plan node (see `planNodes.ts`), and this is where the nodes become
 * the document a preacher reads from the pulpit: `##` for the point, `###` for each
 * sub-point, each followed by whatever was written into it.
 *
 * A sub-point with nothing in it still prints its heading. That is deliberate — the empty
 * heading IS the skeleton, and seeing "I have not filled this in yet" while preparing is
 * worth more than a tidy document. The same behaviour existed before this file knew about
 * cells: an empty point printed its sub-point headings as a visual skeleton.
 */
export function buildSectionOutlineCells({
  orderedOutlinePoints,
  outlinePointsContentById,
}: BuildSectionOutlineMarkdownParams): PlanExportCell[] {
  return orderedOutlinePoints.flatMap((outlinePoint) => {
    const pointContent = outlinePointsContentById[outlinePoint.id]?.trim() ?? "";
    const cells: PlanExportCell[] = [{ heading: `## ${outlinePoint.text}`, level: 2, content: pointContent }];

    /**
     * A SUB-POINT HEADING IS PRINTED ONCE, NEVER TWICE.
     *
     * Two writers fill this map. A hand-written conspectus puts text in each sub-point's
     * own cell. Generation, on a point that has thoughts, returns ONE blob for the point
     * that already carries its own `###` headings inside. Printing headings for both
     * would duplicate every sub-point on generated points.
     *
     * So a sub-point prints when it holds text of its own; and when the point's own cell
     * is empty, all of them print as the skeleton — which is what this file did before
     * cells existed, and what makes an unfilled plan readable while preparing.
     */
    const subPoints = orderedSubPoints(outlinePoint);
    const showSkeleton = pointContent === "";

    /**
     * A generated blob already carries its sub-point headings inside it. When someone then
     * writes into that sub-point's own cell by hand, printing the heading again put the
     * same `### <title>` twice in one point. Whoever wrote it first keeps it.
     */
    const headingAlreadyInPointText = (title: string) =>
      // Matched as a whole heading line: a plain `includes` treated `### Hopeful response`
      // as already containing the heading `Hope`, and suppressed a heading that was never
      // there — leaving the hand-written text with no label at all.
      pointContent.split("\n").some((line) => line.trim() === `### ${title}`);

    subPoints.forEach((subPoint) => {
      const subPointContent = outlinePointsContentById[subPoint.id]?.trim() ?? "";
      if (!subPointContent && !showSkeleton) {
        return;
      }
      const heading = headingAlreadyInPointText(subPoint.text) ? undefined : `### ${subPoint.text}`;
      cells.push({ heading, level: 3, content: subPointContent });
    });

    return cells;
  });
}

export function buildSectionOutlineMarkdown(params: BuildSectionOutlineMarkdownParams): string {
  return buildSectionOutlineCells(params).flatMap(({ heading, content }) => [heading, content].filter(Boolean)).join("\n\n");
}
