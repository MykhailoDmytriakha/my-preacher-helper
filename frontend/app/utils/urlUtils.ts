/**
 * Utility functions for generating URLs with specific parameters
 */

const getDefaultStructurePath = (sermonId: string): string => {
  if (sermonId) {
    return `/sermons/${encodeURIComponent(sermonId)}/structure`;
  }
  return '/structure';
};

/**
 * Generates a Focus mode URL for the structure page
 * @param section - The section to focus on ('introduction', 'main', 'conclusion')
 * @param sermonId - The sermon ID to focus on
 * @param basePath - Optional override for the base path (defaults to /sermons/{id}/structure)
 * @returns The complete URL for Focus mode
 */
export function getFocusModeUrl(section: string, sermonId: string, basePath?: string): string {
  const searchParams = new URLSearchParams();
  searchParams.set('mode', 'focus');
  searchParams.set('section', section);
  
  const path = basePath ?? getDefaultStructurePath(sermonId);
  return `${path}?${searchParams.toString()}`;
}

/**
 * Generates a normal structure page URL
 * @param sermonId - The sermon ID
 * @param basePath - Optional override for the base path (defaults to /sermons/{id}/structure)
 * @returns The complete URL for normal structure view
 */
export function getStructureUrl(sermonId: string, basePath?: string): string {
  return basePath ?? getDefaultStructurePath(sermonId);
}

/**
 * Checks if a URL represents a Focus mode
 * @param url - The URL to check
 * @returns Object with mode and section information
 */
export function parseFocusModeFromUrl(url: string): { mode: string | null; section: string | null; sermonId: string | null } {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const urlObj = new URL(url, origin);
    const searchParams = urlObj.searchParams;
    let sermonId = searchParams.get('sermonId');

    if (!sermonId) {
      const segments = urlObj.pathname.split('/').filter(Boolean);
      const structureIndex = segments.lastIndexOf('structure');
      if (structureIndex >= 2 && segments[structureIndex - 2] === 'sermons') {
        const rawId = segments[structureIndex - 1];
        try {
          sermonId = decodeURIComponent(rawId);
        } catch {
          sermonId = rawId;
        }
      }
    }
    
    return {
      mode: searchParams.get('mode'),
      section: searchParams.get('section'),
      sermonId
    };
  } catch {
    return { mode: null, section: null, sermonId: null };
  }
}
