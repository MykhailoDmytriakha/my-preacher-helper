import OpenAI from "openai";
import { Insights, Item, OutlinePoint, Sermon, Thought } from "@/models/models";
import { generateThoughtPromptSystemMessage } from "@/config/prompt";
import { v4 as uuidv4 } from 'uuid';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

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
 * Generate a Thought by sending the transcription to GPT and returning a structured response.
 * @param thoughtText Raw transcription text from Whisper
 * @param sermon The current sermon context (for reference)
 * @param availableTags List of tags that the user can actually use
 * @returns Thought object with text, tags, date
 */
export async function generateThought(
  thoughtText: string,
  sermon: Sermon,
  availableTags: string[]
): Promise<Thought> {
  const userMessage = `
    Контекст проповеди:
    Название проповеди: ${sermon.title}
    Текст проповеди: ${sermon.verse}
    Доступные tags: ${availableTags.join(", ")}. ИСПОЛЬЗУЙТЕ ТОЛЬКО ЭТИ tags!
    --------------------------------
    Транскрипция: ${thoughtText}
    --------------------------------
    `;
  
  if (isDebugMode) {
    console.log("DEBUG MODE: System prompt:", generateThoughtPromptSystemMessage);
    console.log("DEBUG MODE: User message:", userMessage);
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: generateThoughtPromptSystemMessage },
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

/**
 * Generate insights for a sermon using OpenAI
 * @param sermon The sermon to generate insights for
 * @returns Generated insights or null if failed
 */
export async function generateSermonInsights(sermon: Sermon): Promise<Insights | null> {
  try {
    console.log(`Starting insights generation for sermon: ${sermon.title}`);
    
    // Better extract meaningful content from the sermon
    let sermonContent = "";
    
    // Extract text from thoughts, removing empty or very short entries
    const thoughtTexts: string[] = [];
    if (sermon.thoughts && sermon.thoughts.length > 0) {
      console.log(`Processing ${sermon.thoughts.length} thoughts`);
      
      const meaningfulThoughts = sermon.thoughts
        .filter(t => t.text && t.text.trim().length > 10) // Filter out very short thoughts
        .map(t => {
          // Include tags as context
          if (t.tags && t.tags.length > 0) {
            return `[${t.tags.join(', ')}] ${t.text}`;
          }
          return t.text;
        });
      
      // Add thoughts to both our collection and the sermon content
      thoughtTexts.push(...meaningfulThoughts);
      sermonContent = meaningfulThoughts.join("\n\n");
    } else {
      console.log("No thoughts found in sermon");
    }
    
    // Keep track of thoughts used by tag to avoid duplicates
    const usedThoughtIds = new Set<string>();
    
    // Add structure content if available - properly handle structure content
    if (sermon.structure) {
      console.log("Processing sermon structure");
      
      // Map to help us find thoughts by ID
      const thoughtsById = new Map();
      if (sermon.thoughts) {
        sermon.thoughts.forEach(t => {
          if (t.id) thoughtsById.set(t.id, t);
        });
      }
      
      // For introduction
      if (sermon.structure.introduction && sermon.structure.introduction.length > 0) {
        sermonContent += "\n\nIntroduction:";
        let introContent: string[] = [];
        
        // First try to resolve IDs to actual thoughts
        for (const item of sermon.structure.introduction) {
          // Check if item is a UUID
          if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            const thought = thoughtsById.get(item);
            if (thought && thought.text) {
              introContent.push(thought.text);
              usedThoughtIds.add(thought.id);
            }
          } else {
            // It's already text content
            introContent.push(item);
          }
        }
        
        // If we couldn't resolve any IDs to content, try to find thoughts by tag
        if (introContent.length === 0) {
          const introThoughts = sermon.thoughts?.filter(t => 
            t.tags?.some(tag => 
              tag.toLowerCase() === "вступление" || 
              tag.toLowerCase() === "introduction" || 
              tag.toLowerCase() === "вступ"
            ) && !usedThoughtIds.has(t.id)
          ) || [];
          
          introContent = introThoughts.map(t => {
            usedThoughtIds.add(t.id);
            return t.text;
          });
        }
        
        if (introContent.length > 0) {
          sermonContent += "\n" + introContent.join("\n");
        }
      }
      
      // For main part
      if (sermon.structure.main && sermon.structure.main.length > 0) {
        sermonContent += "\n\nMain Part:";
        let mainContent: string[] = [];
        
        // First try to resolve IDs to actual thoughts
        for (const item of sermon.structure.main) {
          // Check if item is a UUID
          if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            const thought = thoughtsById.get(item);
            if (thought && thought.text) {
              mainContent.push(thought.text);
              usedThoughtIds.add(thought.id);
            }
          } else {
            // It's already text content
            mainContent.push(item);
          }
        }
        
        // If we couldn't resolve any IDs to content, try to find thoughts by tag
        if (mainContent.length === 0) {
          const mainThoughts = sermon.thoughts?.filter(t => 
            t.tags?.some(tag => 
              tag.toLowerCase() === "основная часть" || 
              tag.toLowerCase() === "main part" || 
              tag.toLowerCase() === "основна частина"
            ) && !usedThoughtIds.has(t.id)
          ) || [];
          
          mainContent = mainThoughts.map(t => {
            usedThoughtIds.add(t.id);
            return t.text;
          });
        }
        
        if (mainContent.length > 0) {
          sermonContent += "\n" + mainContent.join("\n");
        }
      }
      
      // For conclusion
      if (sermon.structure.conclusion && sermon.structure.conclusion.length > 0) {
        sermonContent += "\n\nConclusion:";
        let conclusionContent: string[] = [];
        
        // First try to resolve IDs to actual thoughts
        for (const item of sermon.structure.conclusion) {
          // Check if item is a UUID
          if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            const thought = thoughtsById.get(item);
            if (thought && thought.text) {
              conclusionContent.push(thought.text);
              usedThoughtIds.add(thought.id);
            }
          } else {
            // It's already text content
            conclusionContent.push(item);
          }
        }
        
        // If we couldn't resolve any IDs to content, try to find thoughts by tag
        if (conclusionContent.length === 0) {
          const conclusionThoughts = sermon.thoughts?.filter(t => 
            t.tags?.some(tag => 
              tag.toLowerCase() === "заключение" || 
              tag.toLowerCase() === "conclusion" || 
              tag.toLowerCase() === "закінчення" || 
              tag.toLowerCase() === "заключення"
            ) && !usedThoughtIds.has(t.id)
          ) || [];
          
          conclusionContent = conclusionThoughts.map(t => {
            usedThoughtIds.add(t.id);
            return t.text;
          });
        }
        
        if (conclusionContent.length > 0) {
          sermonContent += "\n" + conclusionContent.join("\n");
        }
      }
    }
    
    // If we don't have meaningful content after all this, use a fallback message
    if (sermonContent.trim().length < 30) {
      console.log("Minimal sermon content detected, using fallback");
      sermonContent = `This sermon with title "${sermon.title}" and reference "${sermon.verse}" appears to be in early stages of development with minimal content.`;
    }

    // Extract already covered themes and ideas through semantic analysis
    console.log(`Analyzing sermon content for themes in "${sermon.title || 'Untitled sermon'}"`);
    
    // Track runtime for analytics
    const startTime = Date.now();
    
    // Prepare sermon context
    const sermonContext = `
      Title: ${sermon.title || "Untitled Sermon"}
      Scripture: ${sermon.verse || "No verse provided"}
      
      Content:
      ${sermonContent}
    `;
    
    // Log content size for debugging and optimization
    console.log(`Content size: ${sermonContent.length} characters`);
    
    const userMessage = `
      Analyze this sermon and provide insights to help understand the current direction while also exploring biblical perspectives:
      
      Sermon Title: ${sermon.title}
      Scripture Verse: ${sermon.verse}
      
      Sermon Content:
      ${sermonContent}
      
      Based on this sermon content, please provide:
      
      1. TOPICS (10): Identify the main topics and themes already present in the sermon. These should reflect the current direction of the sermon to help the preacher see where their thoughts are moving, serving as a first draft of a sermon plan.
      
      2. RELATED VERSES (10): Provide 10 Bible verses that connect to the sermon's themes. Include both verses that support the existing sermon direction and verses that offer new biblical perspectives on the same themes. For each verse, explain its relevance to the sermon.
      
      3. RESEARCH DIRECTIONS (10): Suggest 10 areas for further biblical exploration that might enrich the sermon:
         - Highlight different interpretations of the biblical text being discussed
         - Suggest historical or cultural context of the biblical passage that could add depth
         - Propose connections to other biblical narratives or teachings that relate to the theme
         - Recommend exploring theological concepts in the text from different angles
         - Suggest how the biblical passage applies to different life situations or contexts
         - Identify related biblical themes that could expand the sermon's impact
         - Propose ways to connect the biblical text to contemporary challenges
         - Suggest exploring how different biblical characters approached similar situations
         - Recommend looking at how different church traditions have interpreted this passage
         - Propose rhetorical or communication approaches from biblical examples
         
      IMPORTANT: Your goal is to help the preacher understand their current direction while also exploring the richness of biblical perspectives on their topic. The Bible is multifaceted (многогранна) and can be viewed from different angles - help the preacher explore these facets while staying true to the biblical text. Respond in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
    `;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for insights:", userMessage);
    }
    
    // Call OpenAI API to generate insights
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies, hermeneutics, exegesis, and sermon preparation. Your task is to analyze sermon content and provide insights that both clarify the current direction and explore biblical perspectives. The Bible is multifaceted (многогранна) and can be viewed from different angles - help the preacher explore these facets while staying true to the biblical text. First, thoroughly analyze the sermon to recognize themes and concepts already present. Then, suggest ways to explore these themes from different biblical perspectives. Respond with a JSON object containing 'topics' (array of strings), 'relatedVerses' (array of objects with 'reference' and 'relevance' fields), and 'possibleDirections' (array of objects with 'area' and 'suggestion' fields). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content. This language matching is CRITICAL - if the sermon is in Ukrainian, your entire response must be in Ukrainian, if it's in Russian, respond entirely in Russian, etc."
        },
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
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
      
      // Debug logging to understand tone analysis (if available)
      if (isDebugMode && result.toneAnalysis) {
        console.log("DEBUG MODE: Detected sermon tone:", result.toneAnalysis);
      }
    } catch (jsonError) {
      console.error("generateSermonInsights: JSON parsing error:", jsonError);
      throw new Error("Invalid JSON structure from OpenAI");
    }
    
    // Transform the new structured format back to the expected format
    let topics = [];
    let relatedVerses = [];
    let possibleDirections = [];
    
    // Handle topics (simple array of strings)
    if (Array.isArray(result.topics)) {
      topics = result.topics.slice(0, 10); // Limit to 10 items
    }
    
    // Handle related verses (transform objects to strings)
    if (Array.isArray(result.relatedVerses)) {
      relatedVerses = result.relatedVerses.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.reference && item.relevance) {
          return `${item.reference} - ${item.relevance}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Handle possible directions (transform objects to strings)
    if (Array.isArray(result.possibleDirections)) {
      possibleDirections = result.possibleDirections.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.area && item.suggestion) {
          return `${item.area}: ${item.suggestion}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Validate the response has at least partial data
    if (!Array.isArray(topics) || !Array.isArray(relatedVerses) || !Array.isArray(possibleDirections)) {
      console.error("generateSermonInsights: Invalid JSON structure received", result);
      
      // Create fallback values if needed
      topics = topics || [`Key themes from ${sermon.title || "this sermon"}`];
      relatedVerses = relatedVerses || [`Verses related to ${sermon.verse || "the main scripture"}`];
      possibleDirections = possibleDirections || ["Consider the historical context of this passage"];
    }
    
    return {
      topics,
      relatedVerses,
      possibleDirections
    };
  } catch (error) {
    console.error("generateSermonInsights: OpenAI API Error:", error);
    return null;
  }
} 

/**
 * Generate only topics for a sermon using OpenAI
 * @param sermon The sermon to generate topics for
 * @returns Generated topics array or empty array if failed
 */
export async function generateSermonTopics(sermon: Sermon): Promise<string[]> {
  try {
    console.log(`Starting topics generation for sermon: ${sermon.title}`);
    
    // Extract content from the sermon to analyze
    let sermonContent = "";
    
    // Extract text from thoughts
    if (sermon.thoughts && sermon.thoughts.length > 0) {
      const meaningfulThoughts = sermon.thoughts
        .filter(t => t.text && t.text.trim().length > 10)
        .map(t => {
          if (t.tags && t.tags.length > 0) {
            return `[${t.tags.join(', ')}] ${t.text}`;
          }
          return t.text;
        });
      
      sermonContent = meaningfulThoughts.join("\n\n");
    }
    
    // Add content from sermon structure if available
    if (sermon.structure) {
      // Add intro content
      if (sermon.structure.introduction && sermon.structure.introduction.length > 0) {
        sermonContent += "\n\nIntroduction:\n" + sermon.structure.introduction.join("\n");
      }
      
      // Add main content
      if (sermon.structure.main && sermon.structure.main.length > 0) {
        sermonContent += "\n\nMain Part:\n" + sermon.structure.main.join("\n");
      }
      
      // Add conclusion content
      if (sermon.structure.conclusion && sermon.structure.conclusion.length > 0) {
        sermonContent += "\n\nConclusion:\n" + sermon.structure.conclusion.join("\n");
      }
    }
    
    // Prepare the sermon context
    const sermonContext = `
      Title: ${sermon.title || "Untitled Sermon"}
      Scripture: ${sermon.verse || "No verse provided"}
      
      Content:
      ${sermonContent}
    `;
    
    const userMessage = `
      Analyze this sermon and provide ONLY the main topics and themes:
      
      Sermon Title: ${sermon.title}
      Scripture Verse: ${sermon.verse}
      
      Sermon Content:
      ${sermonContent}
      
      Based on this sermon content, please provide:
      
      10 TOPICS: Identify the main topics and themes already present in the sermon. These should reflect the current direction of the sermon to help the preacher see where their thoughts are moving, serving as a first draft of a sermon plan.
      
      IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
    `;
    
    // Call OpenAI API to generate topics
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies. Your task is to analyze sermon content and identify the main topics and themes present. Respond with a JSON object containing 'topics' (array of strings). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for topics:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateSermonTopics: JSON parsing error:", jsonError);
      return [];
    }
    
    // Return the topics array
    if (Array.isArray(result.topics)) {
      return result.topics.slice(0, 10); // Limit to 10 items
    }
    
    // Fallback if no topics found
    return [`Key themes from ${sermon.title || "this sermon"}`];
  } catch (error) {
    console.error("generateSermonTopics: OpenAI API Error:", error);
    return [];
  }
} 

/**
 * Generate only related verses for a sermon using OpenAI
 * @param sermon The sermon to generate related verses for
 * @returns Generated related verses array or empty array if failed
 */
export async function generateSermonVerses(sermon: Sermon): Promise<string[]> {
  try {
    console.log(`Starting related verses generation for sermon: ${sermon.title}`);
    
    // Extract content from the sermon to analyze
    let sermonContent = "";
    
    // Extract text from thoughts
    if (sermon.thoughts && sermon.thoughts.length > 0) {
      const meaningfulThoughts = sermon.thoughts
        .filter(t => t.text && t.text.trim().length > 10)
        .map(t => {
          if (t.tags && t.tags.length > 0) {
            return `[${t.tags.join(', ')}] ${t.text}`;
          }
          return t.text;
        });
      
      sermonContent = meaningfulThoughts.join("\n\n");
    }
    
    // Add content from sermon structure if available
    if (sermon.structure) {
      // Add intro content
      if (sermon.structure.introduction && sermon.structure.introduction.length > 0) {
        sermonContent += "\n\nIntroduction:\n" + sermon.structure.introduction.join("\n");
      }
      
      // Add main content
      if (sermon.structure.main && sermon.structure.main.length > 0) {
        sermonContent += "\n\nMain Part:\n" + sermon.structure.main.join("\n");
      }
      
      // Add conclusion content
      if (sermon.structure.conclusion && sermon.structure.conclusion.length > 0) {
        sermonContent += "\n\nConclusion:\n" + sermon.structure.conclusion.join("\n");
      }
    }
    
    // Prepare the sermon context
    const sermonContext = `
      Title: ${sermon.title || "Untitled Sermon"}
      Scripture: ${sermon.verse || "No verse provided"}
      
      Content:
      ${sermonContent}
    `;
    
    const userMessage = `
      Analyze this sermon and provide ONLY related Bible verses:
      
      Sermon Title: ${sermon.title}
      Scripture Verse: ${sermon.verse}
      
      Sermon Content:
      ${sermonContent}
      
      Based on this sermon content, please provide:
      
      10 RELATED VERSES: Provide 10 Bible verses that connect to the sermon's themes. Include both verses that support the existing sermon direction and verses that offer new biblical perspectives on the same themes. For each verse, explain its relevance to the sermon.
      
      IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
    `;
    
    // Call OpenAI API to generate related verses
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies. Your task is to analyze sermon content and identify related Bible verses. Respond with a JSON object containing 'relatedVerses' (array of objects with 'reference' and 'relevance' fields). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for related verses:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateSermonVerses: JSON parsing error:", jsonError);
      return [];
    }
    
    // Transform and return the related verses
    if (Array.isArray(result.relatedVerses)) {
      return result.relatedVerses.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.reference && item.relevance) {
          return `${item.reference} - ${item.relevance}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Fallback if no related verses found
    return [`Verses related to ${sermon.verse || "the main scripture"}`];
  } catch (error) {
    console.error("generateSermonVerses: OpenAI API Error:", error);
    return [];
  }
} 

/**
 * Generate only possible directions for a sermon using OpenAI
 * @param sermon The sermon to generate possible directions for
 * @returns Generated possible directions array or empty array if failed
 */
export async function generateSermonDirections(sermon: Sermon): Promise<string[]> {
  try {
    console.log(`Starting possible directions generation for sermon: ${sermon.title}`);
    
    // Extract content from the sermon to analyze
    let sermonContent = "";
    
    // Extract text from thoughts
    if (sermon.thoughts && sermon.thoughts.length > 0) {
      const meaningfulThoughts = sermon.thoughts
        .filter(t => t.text && t.text.trim().length > 10)
        .map(t => {
          if (t.tags && t.tags.length > 0) {
            return `[${t.tags.join(', ')}] ${t.text}`;
          }
          return t.text;
        });
      
      sermonContent = meaningfulThoughts.join("\n\n");
    }
    
    // Add content from sermon structure if available
    if (sermon.structure) {
      // Add intro content
      if (sermon.structure.introduction && sermon.structure.introduction.length > 0) {
        sermonContent += "\n\nIntroduction:\n" + sermon.structure.introduction.join("\n");
      }
      
      // Add main content
      if (sermon.structure.main && sermon.structure.main.length > 0) {
        sermonContent += "\n\nMain Part:\n" + sermon.structure.main.join("\n");
      }
      
      // Add conclusion content
      if (sermon.structure.conclusion && sermon.structure.conclusion.length > 0) {
        sermonContent += "\n\nConclusion:\n" + sermon.structure.conclusion.join("\n");
      }
    }
    
    // Prepare the sermon context
    const sermonContext = `
      Title: ${sermon.title || "Untitled Sermon"}
      Scripture: ${sermon.verse || "No verse provided"}
      
      Content:
      ${sermonContent}
    `;
    
    const userMessage = `
      Analyze this sermon and provide ONLY research directions:
      
      Sermon Title: ${sermon.title}
      Scripture Verse: ${sermon.verse}
      
      Sermon Content:
      ${sermonContent}
      
      Based on this sermon content, please provide:
      
      10 RESEARCH DIRECTIONS: Suggest 10 areas for further biblical exploration that might enrich the sermon:
         - Highlight different interpretations of the biblical text being discussed
         - Suggest historical or cultural context of the biblical passage that could add depth
         - Propose connections to other biblical narratives or teachings that relate to the theme
         - Recommend exploring theological concepts in the text from different angles
         - Suggest how the biblical passage applies to different life situations or contexts
         - Identify related biblical themes that could expand the sermon's impact
         - Propose ways to connect the biblical text to contemporary challenges
         - Suggest exploring how different biblical characters approached similar situations
         - Recommend looking at how different church traditions have interpreted this passage
         - Propose rhetorical or communication approaches from biblical examples
      
      IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
    `;
    
    // Call OpenAI API to generate possible directions
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies. Your task is to analyze sermon content and suggest possible directions for further exploration. Respond with a JSON object containing 'possibleDirections' (array of objects with 'area' and 'suggestion' fields). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for possible directions:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateSermonDirections: JSON parsing error:", jsonError);
      return [];
    }
    
    // Transform and return the possible directions
    if (Array.isArray(result.possibleDirections)) {
      return result.possibleDirections.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.area && item.suggestion) {
          return `${item.area}: ${item.suggestion}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Fallback if no possible directions found
    return ["Consider the historical context of this passage"];
  } catch (error) {
    console.error("generateSermonDirections: OpenAI API Error:", error);
    return [];
  }
} 
