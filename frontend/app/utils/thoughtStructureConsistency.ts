import { getCanonicalTagForSection, normalizeStructureTag } from '@/utils/tagUtils';

import type { Sermon } from '@/models/models';
import type { StructureSectionId } from '@/utils/tagUtils';

/**
 * Whether a sermon holds a thought whose structure tag disagrees with its place in the outline —
 * the warning on the sermon page. Moved out of the page so its tests check this code, not a copy
 * of it (BUG-20260929-tests-check-their-own-copy).
 */
export const sermonHasInconsistentThoughts = (sermon: Sermon | null): boolean => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return false;

  return sermon.thoughts.some(thought => {
    const usedStructureTags = thought.tags
      .map((tag) => normalizeStructureTag(tag))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    if (usedStructureTags.length > 1) {
      return true;
    }

    if (usedStructureTags.length === 0) {
      return false;
    }

    if (!thought.outlinePointId) return true;

    let outlinePointSection: StructureSectionId | undefined;

    if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'introduction';
    } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'main';
    } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'conclusion';
    }

    if (!outlinePointSection) return true;

    return usedStructureTags[0] !== getCanonicalTagForSection(outlinePointSection);
  });
};
