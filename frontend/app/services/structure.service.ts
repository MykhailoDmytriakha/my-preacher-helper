import { log } from '@utils/logger';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3000";

export const updateStructure = async (sermonId: string, structure: any): Promise<any> => {
  try {
    const response = await fetch(`${API_BASE}/api/structure?sermonId=${sermonId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structure })
    });
    if (!response.ok) {
      throw new Error(`Failed to update structure: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    log.error("Error updating structure:", error);
    throw error;
  }
}; 