import { BrainstormSuggestion } from "@/models/models";
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

export const generateBrainstormSuggestion = async (
  sermonId: string
): Promise<BrainstormSuggestion> => {
  try {
    console.log("generateBrainstormSuggestion: Starting brainstorm generation for sermon:", sermonId);
    const authHeaders = await getAuthenticatedRequestHeaders();

    const response = await apiClient(`/api/sermons/${sermonId}/brainstorm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
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
