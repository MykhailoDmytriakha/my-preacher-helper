import { Sermon, Thought, ThoughtsBySection } from '@/models/models';

export const SECTION_CONFIG = {
    introduction: { tag: 'introduction', title: 'Вступление' },
    mainPart: { tag: 'main', title: 'Основная часть' },
    conclusion: { tag: 'conclusion', title: 'Заключение' },
} as const;

export type SectionKey = keyof typeof SECTION_CONFIG;

/**
 * Utility to check if a thought belongs to a specific section based on tags.
 */
function isThoughtInSection(thought: Thought, sectionKey: SectionKey): boolean {
    const tags = (thought.tags || []).map(tag => tag.toLowerCase().trim());

    const isIntro = tags.some(tag =>
        ['introduction', 'intro', 'start', 'beginning', 'vstup', 'вступ', 'вступление', 'начало'].includes(tag)
    );
    const isConclusion = tags.some(tag =>
        ['conclusion', 'end', 'summary', 'outro', 'zaver', 'висновок', 'заключение', 'конец', 'кінець'].includes(tag)
    );
    const isMainExplicit = tags.some(tag =>
        ['main', 'mainpart', 'body', 'content', 'основная часть', 'основная', 'основна частина'].includes(tag)
    );

    if (sectionKey === 'introduction') return isIntro;
    if (sectionKey === 'conclusion') return isConclusion;

    // Main Part catch-all: explicitly main OR (not intro AND not conclusion)
    if (sectionKey === 'mainPart') {
        return isMainExplicit || (!isIntro && !isConclusion);
    }

    return false;
}

/**
 * Extracts thoughts for a specific section using Waterfall Logic:
 */
export function getSectionThoughts(sermon: Sermon, sectionKey: SectionKey): Thought[] {
    const allThoughts = sermon.thoughts || [];
    const thoughtMap = new Map(allThoughts.map(t => [t.id, t]));

    // 1. OUTLINE (Plan) - Highest Priority
    const outlinePoints = sermon.outline?.[sectionKey as keyof typeof sermon.outline];

    if (outlinePoints && Array.isArray(outlinePoints) && outlinePoints.length > 0) {
        const sectionThoughts: Thought[] = [];
        const usedThoughtIds = new Set<string>();

        // Add thoughts from outline points
        outlinePoints.forEach((point: { id: string }) => {
            const pointThoughts = allThoughts
                .filter(t => t.outlinePointId === point.id)
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            pointThoughts.forEach(t => {
                sectionThoughts.push(t);
                usedThoughtIds.add(t.id);
            });
        });

        // Add remaining thoughts for this section (unassigned to points)
        const structureKey = sectionKey === 'mainPart' ? 'main' : sectionKey;
        const structureIds = (sermon.structure as unknown as ThoughtsBySection | undefined)?.[structureKey as keyof ThoughtsBySection] || [];

        const unassigned = allThoughts.filter(t => {
            if (usedThoughtIds.has(t.id)) return false;
            return isThoughtInSection(t, sectionKey);
        });

        if (structureIds.length > 0) {
            unassigned.sort((a, b) => {
                const idxA = structureIds.indexOf(a.id);
                const idxB = structureIds.indexOf(b.id);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                return 0;
            });
        }

        return [...sectionThoughts, ...unassigned];
    }

    // 2. STRUCTURE (Manual Order)
    const structureKey = sectionKey === 'mainPart' ? 'main' : sectionKey;
    const structureIds = (sermon.structure as unknown as ThoughtsBySection | undefined)?.[structureKey as keyof ThoughtsBySection];

    if (structureIds && Array.isArray(structureIds) && structureIds.length > 0) {
        return structureIds
            .map((id: string) => thoughtMap.get(id))
            .filter((t): t is Thought => !!t);
    }

    // 3. TAGS (Legacy/Default)
    return allThoughts
        .filter(t => isThoughtInSection(t, sectionKey))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Extracts plain text from sermon for TTS processing.
 */
export function extractSermonText(sermon: Sermon, targetSection?: SectionKey): string {
    const lines: string[] = [];

    // Only add title/verse if we are processing 'all' or specifically 'introduction'
    const isIntroOrAll = !targetSection || targetSection === 'introduction';

    if (isIntroOrAll) {
        if (sermon.title) lines.push(`Проповедь: ${sermon.title}`);
        if (sermon.verse) lines.push(`Текст Писания: ${sermon.verse}`);
        lines.push('');
    }

    // Determine which sections to process
    const sectionsToProcess = targetSection
        ? [targetSection]
        : (['introduction', 'mainPart', 'conclusion'] as SectionKey[]);

    for (const sectionKey of sectionsToProcess) {
        const sectionThoughts = getSectionThoughts(sermon, sectionKey);
        const config = SECTION_CONFIG[sectionKey];

        if (sectionThoughts.length > 0) {
            lines.push(`${config.title}:`);
            for (const thought of sectionThoughts) {
                lines.push(`- ${thought.text}`);
            }
            lines.push('');
        }
    }

    return lines.join('\n').trim();
}
