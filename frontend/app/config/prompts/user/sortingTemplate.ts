import { Item, SermonPoint, Sermon } from "@/models/models";

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
  outlinePoints?: SermonPoint[]
): string {
  // Create a mapping for section names
  const sectionNames: Record<string, string> = {
    introduction: "Introduction (opening thoughts)",
    main: "Main Part (core message)",
    conclusion: "Conclusion (closing thoughts)",
    ambiguous: "Unclassified thoughts"
  };
  
  const sectionName = sectionNames[columnId] || columnId;
  const lockedItems = items
    .map((item, index) => (
      item.isLocked
        ? { index: index + 1, key: item.id.slice(0, 4), content: item.content }
        : null
    ))
    .filter((item): item is { index: number; key: string; content: string } => item !== null);
  
  // Create the items list using the item key for clarity
  let itemsList = "";
  for (const [index, item] of items.entries()) {
    const key = item.id.slice(0, 4);
    itemsList += `position: ${index + 1}, key: ${key}, locked: ${item.isLocked ? "yes" : "no"}, content: ${item.content}\n`;
  }
  
  // Add outline points information if available (including sub-points)
  let outlinePointsText = "";
  let hasSubPoints = false;
  if (outlinePoints && outlinePoints.length > 0) {
    outlinePointsText = "SermonOutline Points for this section (follow this exact order when sorting):\n";
    for (let i = 0; i < outlinePoints.length; i++) {
      outlinePointsText += `${i+1}. ${outlinePoints[i].text}\n`;
      const subs = outlinePoints[i].subPoints;
      if (subs && subs.length > 0) {
        hasSubPoints = true;
        const sorted = [...subs].sort((a, b) => a.position - b.position);
        for (const sp of sorted) {
          outlinePointsText += `   - ${sp.text}\n`;
        }
      }
    }
  }
  const singleOutlinePoint = outlinePoints && outlinePoints.length === 1 ? outlinePoints[0] : undefined;

  const lockedItemsText = lockedItems.length > 0
    ? `Locked anchor items (must remain at the exact same position number as in the input):\n${lockedItems.map((item) => (
      `${item.index}. key: ${item.key}, content: ${item.content}`
    )).join("\n")}\n`
    : "";
  
  return `
    Sermon Title: ${sermon.title}
    Scripture: ${sermon.verse}
    Section: ${sectionName}
    
    ${outlinePointsText ? outlinePointsText + "\n" : ""}
    ${singleOutlinePoint ? `All items already belong to the outline point "${singleOutlinePoint.text}". Keep every item in this exact outline point and improve only the order inside it.\n\n` : ""}
    ${lockedItemsText ? lockedItemsText + "\n" : ""}
    
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
    
    CRITICAL ASPECT - SMOOTH PROGRESSION: Ensure the progression of thoughts is gradual and smooth (coherent progression), making it easy for listeners to follow. The sermon should flow naturally like a smooth, even road without bumps or potholes. Adjacent thoughts should connect logically, with each thought building on the previous one. Avoid jarring transitions or unrelated thoughts placed next to each other.
    ${lockedItems.length > 0 ? "LOCKED ITEM RULE: Every item marked locked: yes is a fixed anchor. Each locked item MUST stay in the exact same position number as in the input. You may reorder only unlocked items around those fixed anchors. Before answering, verify that every locked item is still in its original slot." : ""}
    
    CRITICAL TASK: For each item, you MUST assign it to the most appropriate outline point. This assignment is crucial for sermon organization.
    
    IMPORTANT: Return a JSON object in this format:
    {
      "sortedItems": [
        {"key": "b086", "outlinePoint": "Name of the outline point", "subPoint": "Name of sub-point if applicable", "content": "First few words..."},
        {"key": "ee77", "outlinePoint": "Name of the outline point", "content": "First few words..."},
        ...
      ]
    }

    The "key" should be the first 4 characters of the original item ID.
    ${outlinePointsText ?
      "The \"outlinePoint\" field MUST match EXACTLY one of the following outline points (copy and paste the exact text to avoid errors):\n" +
      outlinePoints?.map(op => `  - "${op.text}"`).join("\n") :
      "The \"outlinePoint\" should indicate which outline point this item corresponds to. Use the EXACT text of one of the outline points provided."
    }
    ${hasSubPoints ?
      "The \"subPoint\" field is OPTIONAL. If an outline point has sub-points listed above, assign the item to the most appropriate sub-point using its EXACT text. If the item doesn't fit a specific sub-point, omit the field to assign directly to the outline point.\nAvailable sub-points:\n" +
      outlinePoints?.filter(op => op.subPoints && op.subPoints.length > 0).map(op =>
        `  Under "${op.text}":\n` + [...(op.subPoints ?? [])].sort((a, b) => a.position - b.position).map(sp => `    - "${sp.text}"`).join("\n")
      ).join("\n") :
      ""
    }
    The "content" should be the first 5-10 words of the item to confirm you understand what you're sorting.
    ${!outlinePointsText ? "If no outline points are provided, use \"General\" for the outlinePoint field or create appropriate outline points based on the content." : ""}
    
    CRITICAL INSTRUCTION: You MUST include ALL ${items.length} items in your response without skipping any. Every item key present in the input must be included exactly once in the sortedItems array.
    Double-check that you've included all keys before submitting your response.
  `;
} 
