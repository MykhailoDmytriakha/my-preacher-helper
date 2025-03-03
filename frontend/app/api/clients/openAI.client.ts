import OpenAI from "openai";
import { Insights, Item, OutlinePoint, Sermon, Thought, VerseWithRelevance, DirectionSuggestion } from "@/models/models";
import { v4 as uuidv4 } from 'uuid';
import { 
  thoughtSystemPrompt, createThoughtUserMessage,
  insightsSystemPrompt, createInsightsUserMessage,
  sortingSystemPrompt, createSortingUserMessage,
  topicsSystemPrompt, createTopicsUserMessage,
  versesSystemPrompt, createVersesUserMessage,
  directionsSystemPrompt, createDirectionsUserMessage
} from "@/config/prompts";
import { extractSermonContent, parseAIResponse, logOperationTiming } from "./openAIHelpers";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

// ===== API Functions =====

export async function createTranscription(file: File): Promise<string> {
  console.log("createTranscription: Received file for transcription", file);
  const transcriptionResponse = await openai.audio.transcriptions.create({
    file,
    model: audioModel,
    response_format: "text",
  });
  console.log(
    "createTranscription: Transcription response received",
    transcriptionResponse
  );
  return transcriptionResponse;
}

/**
 * Generate a thought from transcription text
 * @param thoughtText Transcription text to process
 * @param sermon The current sermon context (for reference)
 * @param availableTags List of tags that the user can actually use
 * @returns Thought object with text, tags, date
 */
export async function generateThought(
  thoughtText: string,
  sermon: Sermon,
  availableTags: string[]
): Promise<Thought> {
  const userMessage = createThoughtUserMessage(thoughtText, sermon, availableTags);
  
  if (isDebugMode) {
    console.log("DEBUG MODE: System prompt:", thoughtSystemPrompt);
    console.log("DEBUG MODE: User message:", userMessage);
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: thoughtSystemPrompt },
        { role: "user", content: userMessage },
      ]
    });

    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response:", rawJson);
    }

    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateThought: JSON parsing error:", jsonError);
      throw new Error("Invalid JSON structure from OpenAI");
    }

    if (typeof result.text !== "string" || !Array.isArray(result.tags)) {
      console.error("generateThought: Invalid JSON structure received", result);
      throw new Error("Invalid JSON structure from OpenAI");
    }

    const labelWidth = 16;
    const transcriptionLabel = "- Transcription:";
    const thoughtLabel = "- Thought:";
    console.log(`${transcriptionLabel} ${thoughtText}\n${thoughtLabel} ${result.text}`);
    return {
      ...result,
      id: uuidv4(),
      date: new Date().toISOString()
    } as Thought;
  } catch (error) {
    console.error("generateThought: OpenAI API Error:", error);
    return {
      id: uuidv4(),
      text: thoughtText,
      tags: [],
      date: new Date().toISOString(),
    };
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
export async function sortItemsWithAI(
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
    
    // Create user message using the template
    const userMessage = createSortingUserMessage(columnId, items, sermon, outlinePoints);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for sorting:", userMessage);
    }
    
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sortingSystemPrompt },
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

/**
 * Generate insights for a sermon using OpenAI
 * @param sermon The sermon to generate insights for
 * @returns Generated insights or null if failed
 */
export async function generateSermonInsights(sermon: Sermon): Promise<Insights | null> {
  const startTime = Date.now();
  console.log("Generating sermon insights for:", sermon.title);
  
  try {
    // Extract sermon content using our helper function
    const sermonContent = extractSermonContent(sermon);
    
    // Create user message using the template
    const userMessage = createInsightsUserMessage(sermon, sermonContent);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for insights:", userMessage);
    }
    
    // Call OpenAI API to generate insights
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: insightsSystemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2000
    });
    
    const rawJson = response.choices[0].message.content;
    
    // Log completion time
    const endTime = Date.now();
    console.log(`Insights generation completed in ${(endTime - startTime) / 1000} seconds`);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for insights:", rawJson);
    }
    
    // Parse the response using our helper function
    const topics = parseAIResponse<string>(rawJson, "topics", "generateSermonInsights");
    const relatedVerses = parseAIResponse<VerseWithRelevance>(rawJson, "relatedVerses", "generateSermonInsights");
    const possibleDirections = parseAIResponse<DirectionSuggestion>(rawJson, "possibleDirections", "generateSermonInsights");
    
    // If any of the fields failed to parse, return null
    if (!topics || !relatedVerses || !possibleDirections) {
      console.error("Failed to parse insights response");
      return null;
    }
    
    // Create and return structured insights object
    return {
      topics,
      relatedVerses,
      possibleDirections
    };
  } catch (error) {
    console.error("Error generating sermon insights:", error);
    return null;
  }
}

/**
 * Generate only topics for a sermon using OpenAI
 * @param sermon The sermon to generate topics for
 * @returns Generated topics array or empty array if failed
 */
export async function generateSermonTopics(sermon: Sermon): Promise<string[]> {
  const startTime = Date.now();
  console.log("Generating sermon topics for:", sermon.title);
  
  try {
    // Extract sermon content using our helper function
    const sermonContent = extractSermonContent(sermon);
    
    // Create user message using the template
    const userMessage = createTopicsUserMessage(sermon, sermonContent);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for topics:", userMessage);
    }
    
    // Call OpenAI API to generate topics
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: topicsSystemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1500
    });
    
    const rawJson = response.choices[0].message.content;
    
    // Log completion time using the helper function
    logOperationTiming("Topics generation", startTime);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for topics:", rawJson);
    }
    
    // Parse the response using our helper function
    const topics = parseAIResponse<string>(rawJson, "topics", "generateSermonTopics");
    
    // Return the topics array or empty array if parsing failed
    return topics || [];
  } catch (error) {
    console.error("Error generating sermon topics:", error);
    return [];
  }
}

/**
 * Generate only related verses for a sermon using OpenAI
 * @param sermon The sermon to generate related verses for
 * @returns Generated related verses array with both reference and relevance, or empty array if failed
 */
export async function generateSermonVerses(sermon: Sermon): Promise<VerseWithRelevance[]> {
  const startTime = Date.now();
  console.log("Generating sermon verses for:", sermon.title);
  
  try {
    // Extract sermon content using our helper function
    const sermonContent = extractSermonContent(sermon);
    
    // Create user message using the template
    const userMessage = createVersesUserMessage(sermon, sermonContent);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for verses:", userMessage);
    }
    
    // Call OpenAI API to generate verses
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: versesSystemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1500
    });
    
    const rawJson = response.choices[0].message.content;
    
    // Log completion time using the helper function
    logOperationTiming("Verses generation", startTime);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for verses:", rawJson);
    }
    
    // Parse the response using our helper function
    const verses = parseAIResponse<VerseWithRelevance>(rawJson, "relatedVerses", "generateSermonVerses");
    
    // Return the verses array or empty array if parsing failed
    return verses || [];
  } catch (error) {
    console.error("Error generating sermon verses:", error);
    return [];
  }
}

/**
 * Generate only possible directions for a sermon using OpenAI
 * @param sermon The sermon to generate possible directions for
 * @returns Generated possible directions array or empty array if failed
 */
export async function generateSermonDirections(sermon: Sermon): Promise<DirectionSuggestion[] | null> {
  const startTime = Date.now();
  console.log("Generating sermon directions for:", sermon.title);
  
  try {
    // Extract sermon content using our helper function
    const sermonContent = extractSermonContent(sermon);
    
    // Create user message using the template
    const userMessage = createDirectionsUserMessage(sermon, sermonContent);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for directions:", userMessage);
    }
    
    // Call OpenAI API to generate directions
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: directionsSystemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2500
    });
    
    const rawJson = response.choices[0].message.content;
    
    // Log completion time
    const endTime = Date.now();
    console.log(`Directions generation completed in ${(endTime - startTime) / 1000} seconds`);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for directions:", rawJson);
    }
    
    // Parse the response using our helper function
    const directions = parseAIResponse<DirectionSuggestion>(rawJson, "possibleDirections", "generateSermonDirections");
    
    // If parsing failed, return null
    if (!directions) {
      console.error("Failed to parse directions response");
      return null;
    }
    
    // Add ids to the directions for React's keying system
    const directionsWithIds = directions.map(direction => ({
      ...direction,
      id: uuidv4()
    }));
    
    return directionsWithIds;
  } catch (error) {
    console.error("Error generating sermon directions:", error);
    return null;
  }
} 
