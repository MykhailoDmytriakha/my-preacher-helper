import { ThoughtInStructure } from "@/models/models";

/**
 * Creates the user message for a single sermon plan point.
 * Matches the structure used in thought generation for consistency.
 */
export function createPlanPointContentUserMessage(
    pointText: string,
    thoughts: (ThoughtInStructure | string)[],
    keyFragments: string[] = []
): string {
    const thoughtsList = thoughts.map((t, i) => {
        const text = typeof t === 'string' ? t : t.content;
        return `THOUGHT ${i + 1}: ${text}`;
    }).join('\n\n');

    const fragmentsList = keyFragments.length > 0
        ? `\n\nKEY FRAGMENTS (Naturally integrate if possible):\n${keyFragments.map(f => `- ${f}`).join('\n')}`
        : '';

    return `OUTLINE POINT: ${pointText}

${thoughtsList}${fragmentsList}

--------------------------------
STRICT: Create exactly ${thoughts.length} main points (###) matching the thoughts above.
`;
}
