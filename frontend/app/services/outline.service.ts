import { SermonPoint } from '@/models/models';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { isKnownOffline } from '@/utils/connectivity';

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
    if (isKnownOffline()) {
      return [];
    }
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await apiClient(`/api/sermons/${sermonId}/generate-outline-points`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ section }),
      category: 'ai',
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
