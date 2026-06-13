import { Sermon, Thought } from '@/models/models';
import { getVisualOrderedThoughtsBySection } from '@/utils/sermonVisualOrder';

/**
 * Gets thoughts for a specific section in the same visible order used by
 * Structure and Plan.
 * 
 * Logic:
 * 1. Resolve section membership from outline, structure, tags, then ambiguity.
 * 2. Follow outline point order when points exist.
 * 3. Interleave direct thoughts and sub-points by position inside each outline point.
 */
export function getSortedThoughts(
    sermon: Sermon,
    section: 'introduction' | 'main' | 'conclusion' | 'ambiguous'
): Thought[] {
    return getVisualOrderedThoughtsBySection(sermon, section);
}
