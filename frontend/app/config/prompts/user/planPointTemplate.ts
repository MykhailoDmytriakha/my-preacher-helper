import { SubPoint, ThoughtInStructure } from "@/models/models";

/**
 * Creates the user message for a single sermon plan point.
 * Matches the structure used in thought generation for consistency.
 */
export function createPlanPointContentUserMessage(
    pointText: string,
    thoughts: (ThoughtInStructure | string)[],
    keyFragments: string[] = [],
    subPoints?: SubPoint[]
): string {
    const thoughtsList = thoughts.map((t, i) => {
        const text = typeof t === 'string' ? t : t.content;
        const subPointId = typeof t === 'string' ? undefined : t.subPointId;
        const subPointLabel = subPointId && subPoints
            ? subPoints.find(sp => sp.id === subPointId)?.text
            : undefined;
        const subPointTag = subPointLabel ? ` [sub-point: ${subPointLabel}]` : '';
        return `THOUGHT ${i + 1}${subPointTag}: ${text}`;
    }).join('\n\n');

    const fragmentsList = keyFragments.length > 0
        ? `\n\nKEY FRAGMENTS (Naturally integrate if possible):\n${keyFragments.map(f => `- ${f}`).join('\n')}`
        : '';

    const sortedSubPoints = subPoints && subPoints.length > 0
        ? [...subPoints].sort((a, b) => a.position - b.position)
        : [];

    const subPointsSection = sortedSubPoints.length > 0
        ? `\n\nSUB-POINTS STRUCTURE (organize the content following this inner skeleton):\n${sortedSubPoints.map((sp, i) => `${i + 1}. ${sp.text}`).join('\n')}\n\nIMPORTANT: Structure your output with ### headings matching these sub-points. Thoughts tagged with a sub-point should appear under its heading. Thoughts without a sub-point tag belong to the general outline point.`
        : '';

    return `OUTLINE POINT: ${pointText}

${thoughtsList}${fragmentsList}${subPointsSection}

--------------------------------
${sortedSubPoints.length > 0
        ? `STRICT: Organize content using ### headings for each sub-point. Include a heading for each sub-point even if no thoughts are directly tagged to it.`
        : `STRICT: Create exactly ${thoughts.length} main points (###) matching the thoughts above.`
    }
`;
}
