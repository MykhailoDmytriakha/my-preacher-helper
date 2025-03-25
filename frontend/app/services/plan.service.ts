import { Plan } from '@/models/models';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

/**
 * Fetches the plan for a specific sermon
 * @param sermonId The ID of the sermon to fetch the plan for
 * @returns The sermon plan or undefined if not found
 */
export const getSermonPlan = async (sermonId: string): Promise<Plan | undefined> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/plan`, {
      cache: "no-store",
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (response.status === 404) {
      return undefined;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sermon plan: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching plan for sermon ${sermonId}:`, error);
    throw error;
  }
};

/**
 * Generates a new plan for a specific sermon
 * @param sermonId The ID of the sermon to generate the plan for
 * @param section Optional section to generate plan for (introduction, main, conclusion)
 * @returns The generated plan or undefined if generation failed
 */
export const generateSermonPlan = async (sermonId: string, section?: string): Promise<Plan | undefined> => {
  try {
    const url = section 
      ? `${API_BASE}/api/sermons/${sermonId}/plan?section=${section}`
      : `${API_BASE}/api/sermons/${sermonId}/plan`;
      
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      console.error(`Error generating plan for sermon ${sermonId}, status: ${response.status}`);
      return undefined;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error generating plan for sermon ${sermonId}:`, error);
    return undefined;
  }
}; 