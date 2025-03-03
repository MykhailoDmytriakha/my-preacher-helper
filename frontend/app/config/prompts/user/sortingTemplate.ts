import { Item, OutlinePoint, Sermon } from "@/models/models";

/**
 * Creates a user message for the AI sorting function
 * @param columnId The column/section ID to sort (introduction, main, conclusion, etc.)
 * @param items The items to be sorted
 * @param sermon The sermon context
 * @param outlinePoints Optional outline points to guide the sorting
 * @returns A formatted user message string
 */
export function createSortingUserMessage(
  columnId: string,
  items: Item[],
  sermon: Sermon,
  outlinePoints?: OutlinePoint[]
): string {
  // Create a mapping for section names
  const sectionNames: Record<string, string> = {
    introduction: "Introduction (opening thoughts)",
    main: "Main Part (core message)",
    conclusion: "Conclusion (closing thoughts)",
    ambiguous: "Unclassified thoughts"
  };
  
  const sectionName = sectionNames[columnId] || columnId;
  
  // Create the items list using the item key for clarity
  let itemsList = "";
  for (const item of items) {
    const key = item.id.slice(0, 4);
    itemsList += `key: ${key}, content: ${item.content}\n`;
  }
  
  // Add outline points information if available
  let outlinePointsText = "";
  if (outlinePoints && outlinePoints.length > 0) {
    outlinePointsText = "Outline Points for this section (follow this exact order when sorting):\n";
    for (let i = 0; i < outlinePoints.length; i++) {
      outlinePointsText += `${i+1}. ${outlinePoints[i].text}\n`;
    }
  }
  
  return `
    Sermon Title: ${sermon.title}
    Scripture: ${sermon.verse}
    Section: ${sectionName}
    
    ${outlinePointsText ? outlinePointsText + "\n" : ""}
    
    Items to sort (${items.length} items):
    ${itemsList.trim()}
    
    Sort these items into the most logical sequence for a sermon's ${sectionName}.
    ${outlinePointsText ? 
      "IMPORTANT: You MUST strictly follow the progression and structure of the outline points. Match each item to the most appropriate outline point and order them accordingly. Items related to earlier outline points should come before items related to later outline points." : 
      ""}
    Consider theological progression, narrative structure, and rhetorical impact.
    For the introduction, consider ordering from general to specific.
    For the main part, arrange points in a logical theological flow.
    For the conclusion, arrange for effective closing impact.
    
    IMPORTANT: Return a JSON object in this format:
    {
      "sortedItems": [
        {"key": "b086", "outlinePoint": "Name of the outline point this relates to", "content": "First few words of the item..."},
        {"key": "ee77", "outlinePoint": "Name of the outline point this relates to", "content": "First few words of the item..."},
        ...
      ]
    }
    
    The "key" should be the first 4 characters of the original item ID.
    The "outlinePoint" should indicate which outline point this item corresponds to.
    The "content" should be the first 5-10 words of the item to confirm you understand what you're sorting.
    ${!outlinePointsText ? "If no outline points are provided, use \"General\" for the outlinePoint field." : ""}
    
    CRITICAL INSTRUCTION: You MUST include ALL ${items.length} items in your response without skipping any. Every item key present in the input must be included exactly once in the sortedItems array.
    Double-check that you've included all keys before submitting your response.
  `;
} 