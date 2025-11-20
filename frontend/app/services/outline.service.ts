import { SermonOutline, SermonPoint } from '@/models/models';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

/**
 * Fetches the outline for a specific sermon
 * @param sermonId The ID of the sermon to fetch the outline for
 * @returns The sermon outline or undefined if not found
 */
export const getSermonOutline = async (sermonId: string): Promise<SermonOutline | undefined> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons/outline?sermonId=${sermonId}`, {
      cache: "no-store",
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (response.status === 404) {
      return undefined;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sermon outline: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching outline for sermon ${sermonId}:`, error);
    throw error;
  }
};

/**
 * Updates the outline for a specific sermon
 * @param sermonId The ID of the sermon to update the outline for
 * @param outline The updated outline data
 * @returns The updated outline or null if the update failed
 */
export const updateSermonOutline = async (sermonId: string, outline: SermonOutline): Promise<SermonOutline | null> => {
  // Validate outline data
  if (!outline.main) {
    outline.main = [];
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/sermons/outline?sermonId=${sermonId}`, {
      method: "PUT",
      headers: { 
        "Content-Type": "application/json",
        'Accept': 'application/json'
      },
      body: JSON.stringify({ outline })
    });
    
    if (!response.ok) {
      console.error(`Error updating outline for sermon ${sermonId}, status: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error updating outline for sermon ${sermonId}:`, error);
    return null;
  }
};

/**
 * Generates outline points for a specific section of a sermon
 * @param sermonId The ID of the sermon
 * @param section The section to generate points for ('introduction', 'main', 'conclusion')
 * @returns Array of generated outline points or empty array if generation failed
 */
export const generateSermonPointsForSection = async (
  sermonId: string, 
  section: 'introduction' | 'main' | 'conclusion'
): Promise<SermonPoint[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/generate-outline-points`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ section })
    });

    if (!response.ok) {
      throw new Error(`Failed to generate outline points: ${response.statusText}`);
    }

    const data = await response.json();
    return data.outlinePoints || [];
  } catch (error) {
    console.error(`Error generating outline points for sermon ${sermonId}, section ${section}:`, error);
    throw error;
  }
}; 