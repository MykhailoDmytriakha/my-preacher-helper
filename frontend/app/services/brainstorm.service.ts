import { BrainstormSuggestion } from "@/models/models";
import { apiClient } from '@/utils/apiClient';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const generateBrainstormSuggestion = async (
  sermonId: string
): Promise<BrainstormSuggestion> => {
  try {
    console.log("generateBrainstormSuggestion: Starting brainstorm generation for sermon:", sermonId);

    const response = await apiClient(`${API_BASE}/api/sermons/${sermonId}/brainstorm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      category: 'ai'
    });

    console.log("generateBrainstormSuggestion: Received response:", response.status);
    
    if (!response.ok) {
      console.error(
        "generateBrainstormSuggestion: Generation failed with status",
        response.status
      );
      throw new Error("Brainstorm generation failed");
    }

    const result = await response.json();
    console.log("generateBrainstormSuggestion: Generation succeeded. Suggestion:", result.suggestion);
    return result.suggestion;
  } catch (error) {
    console.error("generateBrainstormSuggestion: Error generating brainstorm suggestion", error);
    throw error;
  }
};
