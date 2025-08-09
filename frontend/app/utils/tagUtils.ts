import { getContrastColor } from "@utils/color";
import { getTagStyling } from '@/utils/themeColors';

/**
 * Canonical structure tag ids used across the app for logic
 */
export type CanonicalStructureId = 'intro' | 'main' | 'conclusion';

/**
 * Map of aliases (in different languages/cases) to canonical ids
 * Note: keys are stored in lowercase for case-insensitive matching
 */
const STRUCTURE_ALIAS_TO_CANONICAL: Record<string, CanonicalStructureId> = {
  // English long and short
  'introduction': 'intro',
  'intro': 'intro',
  'main part': 'main',
  'main': 'main',
  'conclusion': 'conclusion',

  // English capitalized variations
  'introduction ': 'intro',
  'main part ': 'main',
  'conclusion ': 'conclusion',

  // Russian
  'вступление': 'intro',
  'основная часть': 'main',
  'заключение': 'conclusion',

  // Ukrainian
  'вступ': 'intro',
  'основна частина': 'main',
  'висновок': 'conclusion',
};

/**
 * Normalize any structure-like tag to a canonical id or return null if not a structure tag
 */
export function normalizeStructureTag(tag: string | undefined | null): CanonicalStructureId | null {
  if (!tag) return null;
  const key = String(tag).trim().toLowerCase();
  return STRUCTURE_ALIAS_TO_CANONICAL[key] ?? null;
}

/**
 * Check if a tag is a structure tag (Introduction, Main, Conclusion in any supported language)
 */
export const isStructureTag = (tag: string): boolean => normalizeStructureTag(tag) !== null;

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
      className: "w-3.5 h-3.5 mr-1"
    };
  }
  if (canonical === 'main') {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
      className: "w-3.5 h-3.5 mr-1"
    };
  }
  if (canonical === 'conclusion') {
    return {
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 17 10 11 20 5"></polyline><line x1="4" y1="19" x2="12" y2="19"></line></svg>`,
      className: "w-3.5 h-3.5 mr-1"
    };
  }
  return null;
};

/**
 * Generate CSS styles for a tag
 */
export const getTagStyle = (tag: string, color?: string) => {
  const structureTagStatus = isStructureTag(tag);
  
  // Base class for all tags
  let className = "px-2 py-0.5 rounded-full flex items-center";
  
  // Enhanced styling for structure tags
  if (structureTagStatus) {
    className += " font-medium shadow-sm pl-1.5";
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