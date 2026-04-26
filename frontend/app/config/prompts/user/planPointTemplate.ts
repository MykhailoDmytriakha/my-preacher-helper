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
    const moves = text
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(\d+)[.)]\s+(.+)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => trimSemanticMove(match[2]));

    return moves.length >= 2 ? moves : [];
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
            return `- THOUGHT ${thoughtNumber} contains an explicit numbered sequence. Treat each item as a REQUIRED SEMANTIC MOVE:\n${moveLines}`;
        })
        .join('\n');

    return `\n\nSEMANTIC STRUCTURE SIGNALS (preserve these as meaning, not just words):\n${signals}`;
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
        ? `STRICT: Organize content using ### headings for each sub-point. Include a heading for each sub-point even if no thoughts are directly tagged to it.`
        : `STRICT: Build a semantic preaching map, not a word summary.
- Usually start from one ### heading per THOUGHT, but split a THOUGHT into multiple ### headings when it contains an explicit numbered list, sermon roadmap, or multiple required semantic moves.
- Preserve every REQUIRED SEMANTIC MOVE. Do not merge separate moves only to match the number of thoughts.
- The preacher should be able to glance at the plan and understand the route without rereading the full thoughts.`
    }
`;
}
