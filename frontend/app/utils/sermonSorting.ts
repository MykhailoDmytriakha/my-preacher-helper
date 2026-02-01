import { Sermon, Thought, ThoughtsBySection, SermonOutline } from '@/models/models';
import { normalizeStructureTag } from '@/utils/tagUtils';

/**
 * Gets thoughts for a specific section, strictly following the manual sort order
 * defined in `sermon.structure`.
 * 
 * Logic:
 * 1. If `sermon.structure[section]` exists, return thoughts in that EXACT order.
 * 2. Append any "orphaned" thoughts (tagged for this section but missing from structure), sorted by Date.
 * 3. Fallback: If no structure exists, return all section thoughts sorted by Date.
 */
export function getSortedThoughts(
    sermon: Sermon,
    section: 'introduction' | 'main' | 'conclusion' | 'ambiguous'
): Thought[] {
    const allThoughts = sermon.thoughts || [];
    const thoughtMap = new Map(allThoughts.map(t => [t.id, t]));

    // 1. Get ordered thoughts from Structure (Manual Sort)
    const structureIds = (sermon.structure as unknown as ThoughtsBySection)?.[section as keyof ThoughtsBySection] || [];
    const orderedThoughts: Thought[] = [];
    const processedIds = new Set<string>();

    for (const id of structureIds) {
        const thought = thoughtMap.get(id);
        if (thought) {
            orderedThoughts.push(thought);
            processedIds.add(id);
        }
    }

    // 2. If no structure, or to supplement it, check Outline Points
    // Priority: Structure > Outline > Orphans
    const outlinePoints = sermon.outline?.[section as keyof SermonOutline] || [];
    for (const point of outlinePoints) {
        // Collect all thoughts assigned to this specific point
        const pointThoughts = allThoughts
            .filter(t => t.outlinePointId === point.id && !processedIds.has(t.id))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        for (const t of pointThoughts) {
            orderedThoughts.push(t);
            processedIds.add(t.id);
        }
    }

    // 3. Find orphans (thoughts belonging to this section but not in structure/outline)
    // Helper to check section belonging
    const isInSection = (t: Thought) => {
        if (processedIds.has(t.id)) return false; // Already processed
        if (section === 'ambiguous') {
            // Ambiguous = has NO structure tags
            return !t.tags?.some(tag => normalizeStructureTag(tag) !== null);
        }

        // Check canonical tag
        const canonical = t.tags?.map(normalizeStructureTag).find(Boolean);
        const sectionToCanonical = {
            'introduction': 'intro',
            'main': 'main',
            'conclusion': 'conclusion'
        };
        return canonical === sectionToCanonical[section as 'introduction' | 'main' | 'conclusion'];
    };

    const orphans = allThoughts.filter(isInSection);

    // Sort orphans by date
    orphans.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return [...orderedThoughts, ...orphans];
}
