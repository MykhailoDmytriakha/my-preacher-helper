import { Outline, OutlinePoint } from '@/models/models';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

/**
 * Fetches the outline for a specific sermon
 * @param sermonId The ID of the sermon to fetch the outline for
 * @returns The sermon outline or undefined if not found
 */
export const getSermonOutline = async (sermonId: string): Promise<Outline | undefined> => {
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
export const updateSermonOutline = async (sermonId: string, outline: Outline): Promise<Outline | null> => {
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