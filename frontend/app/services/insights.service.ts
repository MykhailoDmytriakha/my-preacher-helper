import { Insights } from '@/models/models';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

/**
 * Generates insights for a sermon by calling the API
 * @param sermonId ID of the sermon to generate insights for
 * @returns The generated insights or null if failed
 */
export const generateInsights = async (sermonId: string): Promise<Insights | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/insights?sermonId=${sermonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`generateInsights: Response not ok for sermon ${sermonId}, status: ${response.status}`);
      throw new Error('Failed to generate insights');
    }
    
    const data = await response.json();
    return data.insights as Insights;
  } catch (error) {
    console.error('generateInsights: Error generating insights:', error);
    return null;
  }
};

/**
 * Generates only topics for a sermon by calling the API
 * @param sermonId ID of the sermon to generate topics for
 * @returns The updated insights object or null if failed
 */
export const generateTopics = async (sermonId: string): Promise<Insights | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/insights/topics?sermonId=${sermonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`generateTopics: Response not ok for sermon ${sermonId}, status: ${response.status}`);
      throw new Error('Failed to generate topics');
    }
    
    const data = await response.json();
    return data.insights as Insights;
  } catch (error) {
    console.error('generateTopics: Error generating topics:', error);
    return null;
  }
};

/**
 * Generates only related verses for a sermon by calling the API
 * @param sermonId ID of the sermon to generate related verses for
 * @returns The updated insights object or null if failed
 */
export const generateRelatedVerses = async (sermonId: string): Promise<Insights | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/insights/verses?sermonId=${sermonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`generateRelatedVerses: Response not ok for sermon ${sermonId}, status: ${response.status}`);
      throw new Error('Failed to generate related verses');
    }
    
    const data = await response.json();
    return data.insights as Insights;
  } catch (error) {
    console.error('generateRelatedVerses: Error generating related verses:', error);
    return null;
  }
};

/**
 * Generates only possible directions for a sermon by calling the API
 * @param sermonId ID of the sermon to generate possible directions for
 * @returns The updated insights object or null if failed
 */
export const generatePossibleDirections = async (sermonId: string): Promise<Insights | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/insights/directions?sermonId=${sermonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`generatePossibleDirections: Response not ok for sermon ${sermonId}, status: ${response.status}`);
      throw new Error('Failed to generate possible directions');
    }
    
    const data = await response.json();
    return data.insights as Insights;
  } catch (error) {
    console.error('generatePossibleDirections: Error generating possible directions:', error);
    return null;
  }
};

/**
 * Generates a thoughts plan for a sermon by calling the API
 * @param sermonId ID of the sermon to generate thoughts plan for
 * @returns The updated insights object or null if failed
 */
export const generateThoughtsBasedPlan = async (sermonId: string): Promise<Insights | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/insights/plan?sermonId=${sermonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`generateThoughtsBasedPlan: Response not ok for sermon ${sermonId}, status: ${response.status}`);
      throw new Error('Failed to generate thoughts plan');
    }
    
    const data = await response.json();
    return data.insights as Insights;
  } catch (error) {
    console.error('generateThoughtsBasedPlan: Error generating thoughts plan:', error);
    return null;
  }
}; 