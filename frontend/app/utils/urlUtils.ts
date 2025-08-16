/**
 * Utility functions for generating URLs with specific parameters
 */

/**
 * Generates a Focus mode URL for the structure page
 * @param section - The section to focus on ('introduction', 'main', 'conclusion')
 * @param sermonId - The sermon ID to focus on
 * @param basePath - The base path for the structure page (default: '/structure')
 * @returns The complete URL for Focus mode
 */
export function getFocusModeUrl(section: string, sermonId: string, basePath: string = '/structure'): string {
  const searchParams = new URLSearchParams();
  searchParams.set('mode', 'focus');
  searchParams.set('section', section);
  searchParams.set('sermonId', sermonId);
  
  return `${basePath}?${searchParams.toString()}`;
}

/**
 * Generates a normal structure page URL
 * @param sermonId - The sermon ID
 * @param basePath - The base path for the structure page (default: '/structure')
 * @returns The complete URL for normal structure view
 */
export function getStructureUrl(sermonId: string, basePath: string = '/structure'): string {
  const searchParams = new URLSearchParams();
  searchParams.set('sermonId', sermonId);
  
  return `${basePath}?${searchParams.toString()}`;
}

/**
 * Checks if a URL represents a Focus mode
 * @param url - The URL to check
 * @returns Object with mode and section information
 */
export function parseFocusModeFromUrl(url: string): { mode: string | null; section: string | null; sermonId: string | null } {
  try {
    const urlObj = new URL(url, window.location.origin);
    const searchParams = urlObj.searchParams;
    
    return {
      mode: searchParams.get('mode'),
      section: searchParams.get('section'),
      sermonId: searchParams.get('sermonId')
    };
  } catch {
    return { mode: null, section: null, sermonId: null };
  }
}
