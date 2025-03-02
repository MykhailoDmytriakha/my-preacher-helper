import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Item, Sermon, OutlinePoint } from '@/models/models';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const gptModel = process.env.OPENAI_GPT_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

/**
 * POST /api/sort
 * Sorts items within a column using AI
 */
export async function POST(request: Request) {
  console.log("Sort route: Received POST request for AI sorting");
  
  try {
    // Start execution time measurement
    const startTime = performance.now();
    
    const { columnId, items, sermonId, outlinePoints } = await request.json();

    if (!columnId || !items || !Array.isArray(items) || !sermonId) {
      console.error("Sort route: Missing required parameters", { columnId, itemsLength: items?.length, sermonId });
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    console.log(`Sort route: Sorting ${items.length} items in column ${columnId} for sermon ${sermonId}`);

    // Fetch the sermon data for context
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Sort route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Log item IDs for easier tracking
    console.log("Sort route: Items to sort (IDs):", items.map((item: Item) => item.id.slice(0, 4)).join(', '));
    
    // Perform the AI sorting
    const sortedItems = await sortItemsWithAI(columnId, items, sermon, outlinePoints);
    
    // Calculate execution time
    const executionTime = performance.now() - startTime;
    console.log(`AI sorting completed in ${executionTime.toFixed(2)}ms`);
    
    console.log(`Sort route: Successfully sorted ${sortedItems.length} items`);
    return NextResponse.json({ sortedItems });
  } catch (error) {
    console.error('Sort route: Error sorting items:', error);
    return NextResponse.json({ error: 'Failed to sort items' }, { status: 500 });
  }
}

/**
 * Uses AI to sort items in a logical sequence based on the provided outline points.
 * 
 * @param columnId - The ID of the column being sorted (e.g., "introduction", "main", "conclusion").
 * @param items - The list of items to sort.
 * @param sermon - The sermon object containing title and scripture for context.
 * @param outlinePoints - Optional outline points to guide the sorting.
 * @returns A promise that resolves to the sorted list of items.
 */
async function sortItemsWithAI(
  columnId: string, 
  items: Item[], 
  sermon: Sermon, 
  outlinePoints?: OutlinePoint[]
): Promise<Item[]> {
  try {
    // Start measuring execution time
    const startTime = Date.now();
    
    if (items.length <= 1) {
      console.log("Sort AI: No need to sort 0 or 1 items");
      return items; // No need to sort 0 or 1 items
    }
    
    // Create a mapping of keys (first 4 chars of ID) to items for reference and logging
    const itemsMapByKey: Record<string, Item> = {};
    const keyToIndex: Record<string, number> = {};
    items.forEach((item, index) => {
      const key = item.id.slice(0, 4);
      itemsMapByKey[key] = item;
      keyToIndex[key] = index;
    });
    
    // Log the mapping for debugging
    console.log("Sort AI: Item key to ID mapping:");
    Object.entries(itemsMapByKey).forEach(([key, item]) => {
      console.log(`  Key ${key} -> ID: ${item.id.slice(0, 4)}, Content preview: "${item.content.substring(0, 30)}..."`);
    });
    
    const sectionNames: Record<string, string> = {
      introduction: "Introduction (opening thoughts)",
      main: "Main Part (core message)",
      conclusion: "Conclusion (closing thoughts)",
      ambiguous: "Unclassified thoughts"
    };
    
    const sectionName = sectionNames[columnId] || columnId;
    
    // Create the items list using the item key (first 4 characters of ID) for clarity in the prompt
    let itemsList = "";
    for (const item of items) {
      const key = item.id.slice(0,4);
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
    
    const userMessage = `
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
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for sorting:", userMessage);
    }
    
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a sermon organization assistant. Your job is to arrange sermon notes in a logical sequence that follows the provided outline structure exactly. For each item you sort, include the key (first 4 characters of the original item ID), the outline point it matches, and a brief content preview. VERY IMPORTANT: You MUST include ALL items in your response. Do not leave any items out!"
        },
        { role: "user", content: userMessage },
      ]
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for sorting:", rawJson);
    }
    
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
      
      // Log original item order for comparison
      const originalItemKeys = items.map((item: Item) => item.id.slice(0, 4));
      console.log("DEBUG: Original item keys:", originalItemKeys.join(','));
      
      // Validate and extract keys from the AI response
      if (!result.sortedItems || !Array.isArray(result.sortedItems)) {
        console.error("Invalid response format from AI:", result);
        return items; // Return original order if malformed
      }
      
      const extractedKeys: string[] = [];
      result.sortedItems.forEach((item: any, pos: number) => {
        if (item && typeof item.key === 'string') {
          extractedKeys.push(item.key);
          const originalItem = itemsMapByKey[item.key];
          console.log(`DEBUG: Raw API response item ${pos}: key=${item.key}, maps to ID=${originalItem ? originalItem.id.slice(0,4) : 'INVALID'}, content="${originalItem ? originalItem.content.substring(0, 30) : 'INVALID'}..."`);
        }
      });
      console.log("DEBUG: All keys extracted from raw API response:", extractedKeys);
      
      // Grouping by outline points if in debug mode
      if (isDebugMode && result.sortedItems.length > 0) {
        const groupedByOutline: Record<string, Array<{key: string, content: string}>> = {};
        const includedKeys = new Set<string>();
        
        result.sortedItems.forEach((item: {key: string, outlinePoint?: string, content: string}) => {
          if (item && typeof item.key === 'string') {
            includedKeys.add(item.key);
            const outlineKey = item.outlinePoint || 'Unspecified';
            if (!groupedByOutline[outlineKey]) {
              groupedByOutline[outlineKey] = [];
            }
            groupedByOutline[outlineKey].push({
              key: item.key,
              content: item.content || (itemsMapByKey[item.key]?.content.substring(0, 30) || 'Unknown content')
            });
          }
        });
        
        // Check for missing keys
        const missingKeys: string[] = [];
        for (const key of Object.keys(itemsMapByKey)) {
          if (!includedKeys.has(key)) {
            missingKeys.push(key);
          }
        }
        
        console.log("DEBUG MODE: Items grouped by outline points:");
        Object.entries(groupedByOutline).forEach(([outline, arr]) => {
          console.log(`  ${outline} (${arr.length} items):`);
          arr.forEach(item => {
            console.log(`    - Key ${item.key}: "${item.content}"`);
          });
        });
        
        if (missingKeys.length > 0) {
          console.log(`DEBUG MODE: WARNING - ${missingKeys.length} keys missing from AI response:`);
          console.log(`  Missing keys: ${missingKeys.join(', ')}`);
          missingKeys.forEach(key => {
            const content = itemsMapByKey[key]?.content.substring(0, 50) || 'Unknown';
            console.log(`    - Key ${key}: "${content}..."`);
          });
        } else {
          console.log("DEBUG MODE: All keys included in AI response.");
        }
      }
    } catch (jsonError) {
      console.error("sortItemsWithAI: JSON parsing error:", jsonError);
      console.error("sortItemsWithAI: Raw JSON was:", rawJson);
      return items; // Return original order if parsing fails
    }
    
    // Extract and validate keys from the AI response
    const aiSortedKeys = result.sortedItems
      .map((aiItem: any) => {
        if (aiItem && typeof aiItem.key === 'string') {
          let key = aiItem.key;
          if (!itemsMapByKey[key] && key.length > 4) {
            // Attempt to correct the key by taking the last 4 characters
            const correctedKey = key.substring(key.length - 4);
            if (itemsMapByKey[correctedKey]) {
              console.log(`AI sorted: Corrected key from ${key} to ${correctedKey}`);
              key = correctedKey;
            } else {
              console.log(`AI sorted: Key ${key} is invalid even after correction attempt.`);
              return null;
            }
          } else if (!itemsMapByKey[key]) {
            console.log(`AI sorted: Invalid key ${key} -> Not found in itemsMapByKey`);
            return null;
          }
          const originalItem = itemsMapByKey[key];
          console.log(`AI sorted: Valid key ${key} -> ID: ${originalItem.id.slice(0, 4)}, Content: "${originalItem.content.substring(0, 30)}..."`);
          return key;
        }
        return null;
      })
      .filter((key: string | null): key is string => key !== null);

    // Remove duplicates, keeping the first occurrence
    const uniqueKeys: string[] = [];
    const seenKeys = new Set<string>();
    
    for (const key of aiSortedKeys) {
      if (!seenKeys.has(key)) {
        uniqueKeys.push(key);
        seenKeys.add(key);
      } else {
        console.log(`AI sorted: Skipping duplicate key ${key} -> ID: ${itemsMapByKey[key].id.slice(0, 4)}`);
      }
    }
    
    console.log("Sort AI: Unique sorted keys after removing duplicates:", uniqueKeys);

    // Detect missing keys
    const includedKeysSet = new Set(uniqueKeys);
    const missingKeys: string[] = [];
    
    Object.keys(itemsMapByKey).forEach(key => {
      if (!includedKeysSet.has(key)) {
        missingKeys.push(key);
        console.log(`AI sorted: Missing key ${key} -> ID: ${key}, Content: "${itemsMapByKey[key].content.substring(0, 30)}..."`);
      }
    });
    
    // Create final order of keys by appending missing keys
    const finalKeysOrder = [...uniqueKeys, ...missingKeys];
    if (finalKeysOrder.length !== items.length) {
      console.error(`CRITICAL ERROR: Final keys order has ${finalKeysOrder.length} items, but expected ${items.length}. Adjusting...`);
      while (finalKeysOrder.length > items.length) {
        const removed = finalKeysOrder.pop();
        console.error(`Removed extra key: ${removed}`);
      }
      Object.keys(itemsMapByKey).forEach(key => {
        if (!finalKeysOrder.includes(key)) {
          finalKeysOrder.push(key);
          console.error(`Added missing key: ${key}`);
        }
      });
    }
    
    console.log("Sort AI: Final order of keys:", finalKeysOrder);
    
    // Map keys to items to form the sortedItems
    const sortedItems = finalKeysOrder.map(key => itemsMapByKey[key]);
    
    // Log final sorted order with IDs
    console.log("Sort AI: Final sorted order (IDs):", sortedItems.map(item => item.id.slice(0, 4)).join(', '));
    
    // Calculate and log execution time
    const executionTime = Date.now() - startTime;
    console.log(`SortItemsWithAI: AI sorting completed in ${executionTime}ms for ${items.length} items`);
    
    // Log before/after comparison
    const originalIds = items.map(item => item.id.slice(0, 4)).join(',');
    const newIds = sortedItems.map(item => item.id.slice(0, 4)).join(',');
    console.log(`SortItemsWithAI: Reordered from [${originalIds}] to [${newIds}]`);
    
    return sortedItems;
  } catch (error) {
    console.error("Error in AI sorting:", error);
    return items; // Return original order if an error occurs
  }
}