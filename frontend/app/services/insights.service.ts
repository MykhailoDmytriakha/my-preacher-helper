import { Insights, Sermon } from '@/models/models';
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