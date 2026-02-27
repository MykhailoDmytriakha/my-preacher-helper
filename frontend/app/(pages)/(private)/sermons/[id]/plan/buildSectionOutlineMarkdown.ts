import type { SermonPoint } from "@/models/models";

interface BuildSectionOutlineMarkdownParams {
  orderedOutlinePoints: SermonPoint[];
  outlinePointsContentById: Record<string, string>;
}

export function buildSectionOutlineMarkdown({
  orderedOutlinePoints,
  outlinePointsContentById,
}: BuildSectionOutlineMarkdownParams): string {
  if (orderedOutlinePoints.length === 0) {
    return "";
  }

  return orderedOutlinePoints
    .map((outlinePoint) => {
      const pointContent = outlinePointsContentById[outlinePoint.id] ?? "";
      return `## ${outlinePoint.text}\n\n${pointContent}`;
    })
    .join("\n\n");
}
