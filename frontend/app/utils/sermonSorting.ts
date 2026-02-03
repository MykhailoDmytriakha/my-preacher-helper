import { Sermon, Thought } from '@/models/models';
import { getPreachOrderedThoughtsBySection } from '@/utils/thoughtOrdering';

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
    return getPreachOrderedThoughtsBySection(sermon, section, { includeOrphans: true });
}
