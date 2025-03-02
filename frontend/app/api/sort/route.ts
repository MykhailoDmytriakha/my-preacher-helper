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
 * Uses AI to sort items in a logical sequence
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
    
    const sectionNames: Record<string, string> = {
      introduction: "Introduction (opening thoughts)",
      main: "Main Part (core message)",
      conclusion: "Conclusion (closing thoughts)",
      ambiguous: "Unclassified thoughts"
    };
    
    const sectionName = sectionNames[columnId] || columnId;
    
    // Create the items list without using arrow functions in the template string
    let itemsList = "";
    for (let i = 0; i < items.length; i++) {
      itemsList += `${i+1}. ${items[i].content}\n`;
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
          {"index": 2, "outlinePoint": "Name of the outline point this relates to", "content": "First few words of the item..."},
          {"index": 0, "outlinePoint": "Name of the outline point this relates to", "content": "First few words of the item..."},
          ...
        ]
      }
      
      The "index" should be the original position (0-based) of the item in the list.
      The "outlinePoint" should indicate which outline point this item corresponds to.
      The "content" should be the first 5-10 words of the item to confirm you understand what you're sorting.
      ${!outlinePointsText ? "If no outline points are provided, use \"General\" for the outlinePoint field." : ""}
      
      CRITICAL INSTRUCTION: You MUST include ALL ${items.length} items in your response without skipping any. Every index from 0 to ${items.length - 1} must be included exactly once in your sortedItems array.
      Your "sortedItems" array MUST contain exactly ${items.length} objects, one for each item (indices 0 to ${items.length - 1}).
      Double-check that you've included all indices from 0 to ${items.length - 1} before submitting your response.
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
          content: "You are a sermon organization assistant. Your job is to arrange sermon notes in a logical sequence that follows the provided outline structure exactly. You must carefully consider the actual content of each item being sorted and explicitly connect each item to the specific outline point it best relates to. Think deeply about how each sermon item fits into the overall structure. For each item you sort, include the original index, the outline point it matches, and a brief content preview to demonstrate you truly understand what you're organizing. This explicit matching helps ensure the sermon maintains a coherent theological flow. VERY IMPORTANT: You MUST include ALL items in your response. Do not leave any items out!"
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
      
      // Add enhanced debug logging here, after result is defined
      if (isDebugMode && result.sortedItems && Array.isArray(result.sortedItems)) {
        // Group items by outline point for better visualization
        const groupedByOutline: Record<string, Array<{index: number, content: string}>> = {};
        
        // Track which indices were included in the response
        const includedIndices = new Set<number>();
        
        result.sortedItems.forEach((item: {index: number, outlinePoint?: string, content: string}) => {
          if (item && typeof item.index === 'number') {
            includedIndices.add(item.index);
            const outlineKey = item.outlinePoint || 'Unspecified';
            if (!groupedByOutline[outlineKey]) {
              groupedByOutline[outlineKey] = [];
            }
            groupedByOutline[outlineKey].push({
              index: item.index,
              content: item.content || items[item.index]?.content?.substring(0, 30) || 'Unknown content'
            });
          }
        });
        
        // Find missing indices
        const missingIndices: number[] = [];
        for (let i = 0; i < items.length; i++) {
          if (!includedIndices.has(i)) {
            missingIndices.push(i);
          }
        }
        
        console.log("DEBUG MODE: Items grouped by outline points:");
        Object.entries(groupedByOutline).forEach(([outlinePoint, items]) => {
          console.log(`  ${outlinePoint} (${items.length} items):`);
          items.forEach(item => {
            console.log(`    - Index ${item.index}: "${item.content}"`);
          });
        });
        
        // Log information about missing indices
        if (missingIndices.length > 0) {
          console.log(`DEBUG MODE: WARNING - ${missingIndices.length} indices missing from AI response:`);
          console.log(`  Missing indices: ${missingIndices.join(', ')}`);
          
          // Show content of the missing items
          console.log("  Missing items content preview:");
          missingIndices.forEach(index => {
            const content = items[index]?.content?.substring(0, 50) || 'Unknown';
            console.log(`    - Index ${index}: "${content}..."`);
          });
        } else {
          console.log("DEBUG MODE: All indices included in AI response. Great!");
        }
      }
    } catch (jsonError) {
      console.error("sortItemsWithAI: JSON parsing error:", jsonError);
      console.error("sortItemsWithAI: Raw JSON was:", rawJson);
      return items; // Return original order if there's a parsing issue
    }
    
    if (!result.sortedItems || !Array.isArray(result.sortedItems)) {
      console.error("Invalid response format from AI:", result);
      return items; // Return original order if there's an issue
    }
    
    // Extract the indices from the sortedItems array
    let order = result.sortedItems.map((item: { index: number; outlinePoint?: string; content: string }) => {
      // Log some information about each sorted item
      if (item && typeof item.index === 'number' && typeof item.content === 'string') {
        const outlinePointInfo = item.outlinePoint ? `, Outline: "${item.outlinePoint}"` : '';
        console.log(`AI sorted: Index ${item.index}${outlinePointInfo}, Content: "${item.content}"`);
        return item.index;
      }
      return null;
    }).filter((index: number | null) => index !== null);
    
    // Validate and fix the order array to ensure it contains valid indices
    order = order.filter((index: number) => 
      typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < items.length
    );
    
    // Step 2: Add any missing indices in their original order
    const usedIndices = new Set(order);
    const missingIndices = [];
    
    for (let i = 0; i < items.length; i++) {
      if (!usedIndices.has(i)) {
        missingIndices.push(i);
      }
    }
    
    // If we have missing indices, append them to maintain all items
    if (missingIndices.length > 0) {
      console.log(`Found ${missingIndices.length} missing indices, appending them:`, missingIndices);
      
      // Also log the content of missing items to help debug
      if (isDebugMode) {
        console.log("Content preview of missing items:");
        missingIndices.forEach(index => {
          console.log(`  Index ${index}: "${items[index]?.content?.substring(0, 30)}..."`);
        });
      }
      
      order = [...order, ...missingIndices];
    }
    
    // Step 3: Handle duplicate indices by keeping only the first occurrence
    const seenIndices = new Set();
    order = order.filter((index: number) => {
      if (seenIndices.has(index)) {
        return false;
      }
      seenIndices.add(index);
      return true;
    });
    
    // Step 4: Ensure we have exactly the right number of indices
    if (order.length !== items.length) {
      console.error("Invalid order after cleanup, returning original order:", order);
      return items;
    }
    
    // Reorder the items based on the cleaned-up AI's suggestion
    const sortedItems = order.map((index: number) => items[index]);
    
    // Calculate execution time
    const executionTime = Date.now() - startTime;
    console.log(`SortItemsWithAI: AI sorting completed in ${executionTime}ms for ${items.length} items`);
    
    // Log the reordering without using map in the template string
    let originalIds = "";
    let newIds = "";
    for (let i = 0; i < items.length; i++) {
      originalIds += (i > 0 ? ',' : '') + items[i].id.slice(0, 4);
      newIds += (i > 0 ? ',' : '') + sortedItems[i].id.slice(0, 4);
    }
    console.log(`SortItemsWithAI: Reordered from [${originalIds}] to [${newIds}]`);
    
    return sortedItems;
  } catch (error) {
    console.error("Error in AI sorting:", error);
    return items; // Return original order if there's an error
  }
} 