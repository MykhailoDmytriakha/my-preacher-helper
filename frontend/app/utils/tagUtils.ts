import { buildChipClasses, type ChipSize } from '@/utils/chipClasses';
import {
  isStructureTag,
  normalizeStructureTag,
} from '@/utils/structureTags';
import { getTagStyling } from '@/utils/themeColors';
import { getContrastColor } from "@utils/color";

export type {
  CanonicalStructureId,
  StructureSectionId,
} from '@/utils/structureTags';
export {
  CANONICAL_TO_SECTION,
  CANONICAL_TO_TRANSLATION_KEY,
  getCanonicalTagForSection,
  getTranslationKeyForTag,
  isStructureTag,
  normalizeStructureTag,
  SECTION_TO_CANONICAL,
} from '@/utils/structureTags';

// Constants for repeated strings
// No margin: the chip shape spaces its own children with `gap`.
const ICON_CLASS_NAME = "w-3.5 h-3.5";

/**
 * Get default styling for tags without custom colors
 */
export const getDefaultTagStyling = (tag: string) => {
  const canonical = normalizeStructureTag(tag);
  if (canonical === 'intro') return getTagStyling('introduction');
  if (canonical === 'main') return getTagStyling('mainPart');
  if (canonical === 'conclusion') return getTagStyling('conclusion');
  // Default for non-structure tags
  return {
    bg: "bg-indigo-100 dark:bg-indigo-900",
    text: "text-indigo-800 dark:text-indigo-200"
  };
};

/**
 * Get appropriate icon for structure tags
 */
export const getStructureIcon = (tag: string) => {
  const canonical = normalizeStructureTag(tag);
  if (canonical === 'intro') {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
      className: ICON_CLASS_NAME
    };
  }
  if (canonical === 'main') {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
      className: ICON_CLASS_NAME
    };
  }
  if (canonical === 'conclusion') {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 17 10 11 20 5"></polyline><line x1="4" y1="19" x2="12" y2="19"></line></svg>`,
      className: ICON_CLASS_NAME
    };
  }
  return null;
};

/**
 * Generate CSS styles for a tag.
 *
 * The SHAPE is borrowed from the app's one chip (`buildChipClasses`) rather than spelled
 * here, so a thought tag and a Scripture reference are the same object on screen. Only the
 * COLOUR stays local, because a thought tag has two colour sources this component owns and
 * a token cannot: the canonical section palette for structure tags, and whatever the
 * preacher picked by hand for the rest, which arrives as an inline `style`.
 */
export const getTagStyle = (tag: string, color?: string, size: ChipSize = 'sm') => {
  const structureTagStatus = isStructureTag(tag);

  // `custom` contributes no plate of its own — the colour is appended just below.
  let className = buildChipClasses({ tone: 'custom', size });

  // Enhanced styling for structure tags
  if (structureTagStatus) {
    className += " shadow-sm pl-1.5";
  }

  // Always compute default class-based styling first to stabilize class tokens
  const defaultStyle = getDefaultTagStyling(tag);
  className += ` ${defaultStyle.bg} ${defaultStyle.text}`;

  // Prepare inline style; for structure tags ignore provided color (canonical palette only)
  let style: Record<string, string> = {};
  if (!structureTagStatus && color) {
    style = {
      backgroundColor: color,
      color: getContrastColor(color),
    };
  }

  // Add subtle border for structure tags
  if (structureTagStatus) {
    className += " border border-current border-opacity-20 shadow";
  }

  return { className, style };
}; 
