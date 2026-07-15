import { toast } from 'sonner';

import { Item, SermonPoint } from "@/models/models";
import { isUsageCapReachedError } from '@/services/usageLimits';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

/**
 * Sorts items within a column using AI
 * @param columnId The ID of the column (introduction, main, conclusion, ambiguous)
 * @param items The items to be sorted
 * @param sermonId The ID of the sermon these items belong to
 * @param outlinePoints Optional outline points for additional context
 * @returns A promise resolving to the sorted items
 */
export const sortItemsWithAI = async (
  columnId: string,
  items: Item[],
  sermonId: string,
  outlinePoints?: SermonPoint[]
): Promise<Item[]> => {
  try {
    console.log(`sortItemsWithAI: Starting AI sort for column ${columnId} with ${items.length} items`);
    const authHeaders = await getAuthenticatedRequestHeaders();

    const response = await apiClient(`${API_BASE}/api/sort`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ columnId, items, sermonId, outlinePoints }),
      category: 'ai',
    });

    console.log(`sortItemsWithAI: Received response with status ${response.status}`);
    
    if (!response.ok) {
      console.error(`sortItemsWithAI: Failed with status ${response.status}`);
      throw new Error(`Sorting failed with status ${response.status}`);
    }

    const { sortedItems } = await response.json();
    console.log(`sortItemsWithAI: Successfully sorted ${sortedItems.length} items`);
    
    return sortedItems;
  } catch (error) {
    console.error("sortItemsWithAI: Error sorting items", error);
    if (isUsageCapReachedError(error)) throw error;
    // We can't use the useTranslation hook here since this is not a component
    // The error message will be handled by the caller using the translation key
    toast.error("Error sorting items with AI. Please try again.");
    throw error;
  }
};
