import { SubPoint, ThoughtInStructure } from "@/models/models";

const MAX_SEMANTIC_MOVE_CHARS = 220;

function getThoughtText(thought: ThoughtInStructure | string): string {
    return typeof thought === 'string' ? thought : thought.content;
}

function trimSemanticMove(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= MAX_SEMANTIC_MOVE_CHARS) {
        return normalized;
    }
    return `${normalized.slice(0, MAX_SEMANTIC_MOVE_CHARS).trim()}...`;
}

function extractNumberedSemanticMoves(text: string): string[] {
    const lineMoves = text
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(\d+)[.)]\s+(.+)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => trimSemanticMove(match[2]));

    if (lineMoves.length >= 2) {
        return lineMoves;
    }

    const inlineMoves = Array.from(
        text
            .replace(/\r?\n/g, ' ')
            .matchAll(/(?:^|\s)(\d+)[.)]\s+([\s\S]*?)(?=\s+\d+[.)]\s+|$)/g)
    )
        .map((match) => trimSemanticMove(match[2]))
        .filter((move) => move.length > 0);

    return inlineMoves.length >= 2 ? inlineMoves : [];
}

function createSemanticStructureSignals(thoughts: (ThoughtInStructure | string)[]): string {
    const numberedThoughts = thoughts
        .map((thought, index) => ({
            thoughtNumber: index + 1,
            moves: extractNumberedSemanticMoves(getThoughtText(thought)),
        }))
        .filter(({ moves }) => moves.length > 0);

    if (numberedThoughts.length === 0) {
        return '';
    }

    const signals = numberedThoughts
        .map(({ thoughtNumber, moves }) => {
            const moveLines = moves
                .map((move, index) => `  ${index + 1}. ${move}`)
                .join('\n');
            return `- THOUGHT ${thoughtNumber} contains an explicit numbered sequence. Keep these items as an INTERNAL CUE LIST under the relevant cue, not as separate ### headings:\n${moveLines}`;
        })
        .join('\n');

    return `\n\nINTERNAL CUE LIST SIGNALS (preserve these as nested plan items, not expanded heading blocks):\n${signals}`;
}

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
        const text = getThoughtText(t);
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

    const semanticStructureSignals = sortedSubPoints.length === 0
        ? createSemanticStructureSignals(thoughts)
        : '';

    return `OUTLINE POINT: ${pointText}

${thoughtsList}${fragmentsList}${subPointsSection}${semanticStructureSignals}

--------------------------------
${sortedSubPoints.length > 0
        ? `STRICT: Produce a preacher cue sheet using ### headings for each sub-point.
- Include a ### heading for each listed sub-point, even if no thoughts are directly tagged to it.
- Keep content under each sub-point concise: short cue lines, bullets, or nested lists.
- Do not create extra ### headings for ordinary details inside a sub-point.`
        : `STRICT: Produce a preacher cue sheet for this one outline point.
- The outline point title is already visible in the UI; do not repeat it as a heading unless the source has a major named internal transition.
- Do not create one ### heading per THOUGHT, detail, or rhetorical action.
- Use short cue lines, bullets, and nested numbered lists so the preacher can glance and remember the route.
- Preserve explicit numbered sequences as internal lists under the relevant cue.
- Merge repeated moves; keep memorable source phrases, contrast pairs, arrows, and compact Bible references.
- Quote verse text only when the source thought itself provided that exact text.`
    }
`;
}
