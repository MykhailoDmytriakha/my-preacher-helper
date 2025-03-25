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
import {
  thoughtFunctionSchema,
  sortingFunctionSchema,
  insightsFunctionSchema,
  topicsFunctionSchema,
  versesFunctionSchema,
  directionsFunctionSchema
} from "@/config/schemas";
import { extractSermonContent, parseAIResponse, logOperationTiming, formatDuration, logger } from "./openAIHelpers";

const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string; // This should be 'o1-mini'
const geminiModel = process.env.GEMINI_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const aiModel = process.env.AI_MODEL_TO_USE === 'GEMINI' ? geminiModel : gptModel;
const aiAPI = process.env.AI_MODEL_TO_USE === 'GEMINI' ? gemini : openai;

// Create XML function definition for Claude models
function createXmlFunctionDefinition(functionSchema: any): string {
  const schema = functionSchema.function;
  const parameters = schema.parameters.properties;
  
  let xmlDefinition = `
<function name="${schema.name}">
  <parameters>`;
  
  // Add each parameter
  for (const [paramName, paramSchema] of Object.entries(parameters)) {
    const param = paramSchema as any;
    xmlDefinition += `
    <parameter name="${paramName}" type="${param.type}">
      ${param.description || ''}
    </parameter>`;
  }
  
  xmlDefinition += `
  </parameters>
</function>

Your response should be structured as follows:

<function_call name="${schema.name}">
<arguments>
{
`;

  // Add a template for each parameter
  for (const [paramName, paramSchema] of Object.entries(parameters)) {
    const param = paramSchema as any;
    if (param.type === "array") {
      xmlDefinition += `  "${paramName}": [],\n`;
    } else if (param.type === "object") {
      xmlDefinition += `  "${paramName}": {},\n`;
    } else {
      xmlDefinition += `  "${paramName}": "",\n`;
    }
  }

  xmlDefinition += `}
</arguments>
</function_call>

The response MUST be valid JSON within the <arguments> tags.`;

  return xmlDefinition;
}

// Helper function to extract data from Claude's response
function extractClaudeFunctionResponse<T>(responseContent: string): T {
  try {
    // First try: Extract JSON from within the <arguments> tags
    const argumentsMatch = responseContent.match(/<arguments>([\s\S]*?)<\/arguments>/);
    if (argumentsMatch && argumentsMatch[1]) {
      const jsonString = argumentsMatch[1].trim();
      return JSON.parse(jsonString) as T;
    } 
    
    // Second try: Look for a JSON object
    console.log("No <arguments> tags found, trying alternative extraction methods");
    
    // Try to extract JSON from code blocks
    const codeBlockMatch = responseContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        // Clean up the JSON string first
        const cleanedJson = codeBlockMatch[1].trim()
          .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
          .replace(/,\s*\]/g, ']'); // Remove trailing commas in arrays
        return JSON.parse(cleanedJson) as T;
      } catch (e) {
        console.log("Failed to parse JSON from code block, trying other methods:", e);
      }
    }
    
    // Try to extract any JSON object in the response
    const jsonRegex = /\{[\s\S]*\}/;
    const jsonMatch = responseContent.match(jsonRegex);
    
    if (jsonMatch) {
      try {
        // Clean up the JSON string
        const cleanedJson = jsonMatch[0]
          .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
          .replace(/,\s*\]/g, ']'); // Remove trailing commas in arrays
        return JSON.parse(cleanedJson) as T;
      } catch (e) {
        console.log("Failed to parse JSON object, trying more specific extraction:", e);
      }
    }

    // For Gemini model responses handling DirectionSuggestion format specifically
    if (responseContent.includes("\"directions\":")) {
      try {
        // Try to clean up the JSON by finding the directions array and parsing it
        const directionsMatch = responseContent.match(/"directions"\s*:\s*\[([\s\S]*?)\]\s*}/);
        if (directionsMatch) {
          const cleanedJson = `{"directions": [${directionsMatch[1]}]}`;
          return JSON.parse(cleanedJson) as T;
        }
      } catch (e) {
        console.log("Failed to extract directions array", e);
      }
    }
    
    // For Gemini model responses handling sortedItems format specifically
    if (responseContent.includes("\"sortedItems\":")) {
      try {
        // Try to clean up the JSON by finding the sortedItems array and parsing it
        const sortedItemsMatch = responseContent.match(/"sortedItems"\s*:\s*\[([\s\S]*?)\](?:\s*})?/);
        if (sortedItemsMatch) {
          // Clean up the array content to ensure it's valid JSON
          const cleanedArrayContent = sortedItemsMatch[1].trim()
            .replace(/,\s*$/, ''); // Remove trailing comma at the end of array
          
          const cleanedJson = `{"sortedItems": [${cleanedArrayContent}]}`;
          return JSON.parse(cleanedJson) as T;
        }
      } catch (e) {
        console.log("Failed to extract sortedItems array:", e);
      }
    }
    
    throw new Error("Could not find any valid JSON object in model response");
  } catch (error) {
    console.error("Failed to parse function response from Claude model:", error);
    throw new Error("Invalid response format from AI model");
  }
}

// Helper function to extract function response
function extractFunctionResponse<T>(response: OpenAI.Chat.ChatCompletion): T {
  // For Claude models, extract from content
  if (response.choices[0].message.content) {
    return extractClaudeFunctionResponse<T>(response.choices[0].message.content);
  }
  
  throw new Error("No function call found in the response");
}

// Helper function to create messages array
function createMessagesArray(systemPrompt: string, userContent: string): Array<OpenAI.ChatCompletionMessageParam> {
  // Since o1-mini doesn't support system messages, include system content as part of user message
  return [
    { role: "user", content: `${systemPrompt}\n\n${userContent}` }
  ];
}

/**
 * Wraps OpenAI API calls with enhanced logging and timing
 * @param apiCallFn The actual API call function
 * @param operationName Name of the operation for logging
 * @param requestData Data being sent to OpenAI
 * @param inputInfo Additional context information
 * @param options Optional configuration for logging behavior
 * @returns The API call result
 */
async function withOpenAILogging<T>(
  apiCallFn: () => Promise<any>, 
  operationName: string, 
  requestData: any,
  inputInfo: any,
  options: {
    logFullResponse?: boolean,
    logMaxLength?: number
  } = {}
): Promise<T> {
  // Default options
  const {
    logFullResponse = false,
    logMaxLength = 2000
  } = options;
  
  logger.info(operationName, "Starting operation");
  logger.info(operationName, "Input info", inputInfo);
  
  // Truncate request data logging if it's too large
  const requestStr = JSON.stringify(requestData, null, 2);
  if (requestStr.length > logMaxLength && !logFullResponse) {
    logger.info(operationName, `Request data (truncated to ${logMaxLength} chars)`, requestStr.substring(0, logMaxLength) + '...');
  } else {
    logger.info(operationName, "Request data", requestData);
  }
  
  const startTime = performance.now();
  
  try {
    const response = await apiCallFn();
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);
    
    logger.success(operationName, `Completed in ${formattedDuration}`);
    
    // Truncate response logging if it's too large
    const responseStr = JSON.stringify(response, null, 2);
    if (responseStr.length > logMaxLength && !logFullResponse) {
      logger.info(operationName, `Raw response (truncated to ${logMaxLength} chars)`, responseStr.substring(0, logMaxLength) + '...');
    } else {
      logger.info(operationName, "Raw response", response);
    }
    
    let prettyResponse: any;
    
    // Handle different response formats based on the operation
    if (response.choices && response.choices[0]?.message) {
      if (response.choices[0].message.content) {
        // For content-based responses (Claude-style)
        prettyResponse = response.choices[0].message.content;
      } else if (response.choices[0].message.function_call) {
        // For function call responses
        prettyResponse = JSON.parse(response.choices[0].message.function_call.arguments);
      }
    } else if (response.text) {
      // For transcription responses
      prettyResponse = response.text;
    } else {
      // Default case
      prettyResponse = response;
    }
    
    // Truncate pretty response logging if it's too large
    const prettyStr = JSON.stringify(prettyResponse, null, 2);
    if (prettyStr.length > logMaxLength && !logFullResponse) {
      logger.info(operationName, `Pretty response (truncated to ${logMaxLength} chars)`, prettyStr.substring(0, logMaxLength) + '...');
    } else {
      logger.info(operationName, "Pretty response", prettyResponse);
    }
    
    return response;
  } catch (error) {
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);
    
    logger.error(operationName, `Failed after ${formattedDuration}`, error);
    throw error;
  }
}

// ===== API Functions =====

export async function createTranscription(file: File): Promise<string> {
  try {
    const inputInfo = {
      filename: file.name,
      fileSize: file.size,
      fileType: file.type
    };
    
    const requestData = {
      model: audioModel,
      file: 'Audio file content (binary data not shown in logs)'
    };
    
    const result = await withOpenAILogging<OpenAI.Audio.Transcription>(
      () => openai.audio.transcriptions.create({
        file,
        model: audioModel,
      }), 
      'Transcription',
      requestData,
      inputInfo
    );
    
    return result.text;
  } catch (error) {
    console.error("Error transcribing file:", error);
    throw error;
  }
}

// Generate a single thought from audio transcription or text
export async function generateThought(
  content: string, 
  sermon: Sermon,
  availableTags: string[] = []
): Promise<{ text: string; tags: string[] }> {
  // Create user message with the input format the LLM expects
  const userMessage = createThoughtUserMessage(content, sermon, availableTags);
  
  if (isDebugMode) {
    logger.debug('GenerateThought', "Generating thought for content", content.substring(0, 300) + (content.length > 300 ? '...' : ''));
    logger.debug('GenerateThought', "With available tags", availableTags);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${thoughtSystemPrompt}\n\n${createXmlFunctionDefinition(thoughtFunctionSchema)}`;
    
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
      sermonTitle: sermon.title,
      availableTags
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Thought',
      requestOptions,
      inputInfo
    );

    const result = extractFunctionResponse<{ text: string; tags: string[] }>(response);

    if (typeof result.text !== "string" || !Array.isArray(result.tags)) {
      logger.error('GenerateThought', "Invalid response structure received", result);
      throw new Error("Invalid response structure from OpenAI");
    }

    const labelWidth = 16;
    logger.success('GenerateThought', "Thought generated successfully");
    logger.info('GenerateThought', `Text: ${result.text.substring(0, 60)}${result.text.length > 60 ? "..." : ""}`);
    logger.info('GenerateThought', `Tags: ${result.tags.join(", ")}`);

    return result;
  } catch (error) {
    logger.error('GenerateThought', "Error generating thought", error);
    throw error;
  }
}

/**
 * Sort items within a column using AI
 * @param columnId - ID of the column containing the items
 * @param items - Array of items to sort
 * @param sermon - The sermon context
 * @param outlinePoints - Optional outline points to guide the sorting.
 * @returns A promise that resolves to the sorted list of items.
 */
export async function sortItemsWithAI(columnId: string, items: Item[], sermon: Sermon, outlinePoints: OutlinePoint[] = []): Promise<Item[]> {
  try {
    // Create a map for quick lookup by ID
    const itemsMapByKey: Record<string, Item> = {};
    items.forEach(item => {
      // Add the item to lookup maps, using just the first 4 chars of the ID as key
      const shortKey = item.id.slice(0, 4);
      itemsMapByKey[shortKey] = item;
    });

    // Log the mapping for debugging
    if (isDebugMode) {
      console.log("Sort AI: Item key to ID mapping:");
      Object.entries(itemsMapByKey).forEach(([key, item]) => {
        console.log(`  ${key} -> ${item.id.slice(0, 8)}`);
      });
    }
    
    // Create user message for the AI model
    const userMessage = createSortingUserMessage(columnId, items, sermon, outlinePoints);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for sorting:", userMessage);
    }
    
    // For Claude models (o1-mini), use XML tags for function-like behavior
    const xmlFunctionPrompt = createXmlFunctionDefinition(sortingFunctionSchema);
    
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      columnId,
      itemCount: items.length,
      sermonTitle: sermon.title,
      outlinePointCount: outlinePoints.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Sort Items',
      requestOptions,
      inputInfo
    );
    
    // Extract the response
    let sortedData: { sortedItems: Array<{key: string, outlinePoint?: string, content?: string}> };
    
    try {
      const content = response.choices[0].message.content || '';
      sortedData = extractClaudeFunctionResponse(content);
    } catch (error) {
      console.error("Failed to parse function response from model:", error);
      throw new Error("Invalid response format from AI model");
    }

    // Log original item order for comparison
    if (isDebugMode) {
      console.log("DEBUG: Original item ordering:");
      items.forEach((item, index) => {
        console.log(`  [${index}] ${item.id.slice(0, 4)}: "${item.content.substring(0, 30)}..."`);
      });
    }
    
    // Validate and extract keys from the AI response
    if (!sortedData.sortedItems || !Array.isArray(sortedData.sortedItems)) {
      console.error("Invalid response format from AI:", sortedData);
      return items; // Return original order if malformed
    }
    
    const extractedKeys: string[] = [];
    sortedData.sortedItems.forEach((item: any, pos: number) => {
      if (item && typeof item.key === 'string') {
        extractedKeys.push(item.key);
        if (isDebugMode) {
          console.log(`  [${pos}] ${item.key}: ${item.outlinePoint || 'no outline'} - ${item.content || 'no preview'}`);
        }
      }
    });
    
    // Grouping by outline points if in debug mode
    if (isDebugMode && sortedData.sortedItems.length > 0) {
      const groupedByOutline: Record<string, Array<{key: string, content: string}>> = {};
      const includedKeys = new Set<string>();
      
      sortedData.sortedItems.forEach((item: {key: string, outlinePoint?: string, content?: string}) => {
        if (item && typeof item.key === 'string') {
          includedKeys.add(item.key);
          const outlineKey = item.outlinePoint || 'unassigned';
          if (!groupedByOutline[outlineKey]) {
            groupedByOutline[outlineKey] = [];
          }
          groupedByOutline[outlineKey].push({
            key: item.key,
            content: item.content || 'no preview'
          });
        }
      });
      
      console.log("DEBUG: Items grouped by outline points:");
      Object.entries(groupedByOutline).forEach(([outline, items]) => {
        console.log(`  [${outline}] (${items.length} items):`);
        items.forEach(item => {
          console.log(`    - ${item.key}: ${item.content}`);
        });
      });
    }
    
    // Create a map to store AI-assigned outline points for each item
    const outlinePointAssignments: Record<string, string> = {};
    
    // Extract and validate keys from the AI response
    const aiSortedKeys = sortedData.sortedItems
      .map((aiItem: any) => {
        if (aiItem && typeof aiItem.key === 'string') {
          let itemKey: string = aiItem.key;
          if (!itemsMapByKey[itemKey] && itemKey.length > 4) {
            // Attempt to correct the key by taking the last 4 characters
            const correctedKey = itemKey.substring(itemKey.length - 4);
            if (itemsMapByKey[correctedKey]) {
              console.log(`DEBUG: Corrected AI key ${itemKey} to ${correctedKey}`);
              itemKey = correctedKey;
            }
          }
          
          // Store the outline point assignment if available
          if (itemsMapByKey[itemKey] && aiItem.outlinePoint) {
            outlinePointAssignments[itemKey] = aiItem.outlinePoint;
            if (isDebugMode) {
              console.log(`DEBUG: Assigned outline point "${aiItem.outlinePoint}" to item ${itemKey}`);
            }
          }
          
          return itemsMapByKey[itemKey] ? itemKey : null;
        }
        return null;
      })
      .filter((key: string | null): key is string => key !== null);
    
    // Create a new array with the sorted items
    const sortedItems: Item[] = aiSortedKeys.map((key: string) => {
      const item = itemsMapByKey[key];
      
      // Find matching outline point ID based on the AI-assigned outline text
      if (outlinePointAssignments[key] && outlinePoints.length > 0) {
        const aiAssignedOutlineText = outlinePointAssignments[key];
        
        // First try exact match
        let matchingOutlinePoint = outlinePoints.find(op => 
          op.text.toLowerCase() === aiAssignedOutlineText.toLowerCase()
        );
        
        // If no exact match, try substring matching
        if (!matchingOutlinePoint) {
          matchingOutlinePoint = outlinePoints.find(op => 
            op.text.toLowerCase().includes(aiAssignedOutlineText.toLowerCase()) ||
            aiAssignedOutlineText.toLowerCase().includes(op.text.toLowerCase())
          );
        }
        
        // If still no match, try fuzzy matching
        if (!matchingOutlinePoint && outlinePoints.length > 0) {
          // Find the closest match based on word overlap
          const aiWords = new Set(aiAssignedOutlineText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          
          let bestMatchScore = 0;
          let bestMatch: OutlinePoint | undefined;
          
          for (const op of outlinePoints) {
            const opWords = new Set(op.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
            let matchScore = 0;
            
            // Count word overlaps
            for (const word of aiWords) {
              if (opWords.has(word)) matchScore++;
            }
            
            if (matchScore > bestMatchScore) {
              bestMatchScore = matchScore;
              bestMatch = op;
            }
          }
          
          // Only use if we have some word overlap
          if (bestMatchScore > 0) {
            matchingOutlinePoint = bestMatch;
          }
        }
        
        if (matchingOutlinePoint) {
          // Create a new item with the assigned outline point
          if (isDebugMode) {
            console.log(`DEBUG: Successfully matched "${aiAssignedOutlineText}" to outline point "${matchingOutlinePoint.text}" (${matchingOutlinePoint.id})`);
          }
          
          // No need for section mapping since we don't want to show the section name
          return {
            ...item,
            outlinePointId: matchingOutlinePoint.id,
            outlinePoint: {
              text: matchingOutlinePoint.text,
              section: ''  // Empty string instead of section name
            }
          };
        } else {
          if (isDebugMode) {
            console.log(`DEBUG: Could not match "${aiAssignedOutlineText}" to any outline point`);
          }
        }
      }
      
      return item;
    });
    
    // Check if all items were included in the sorted result
    const missingSortedKeys = Object.keys(itemsMapByKey).filter(key => !aiSortedKeys.includes(key));
    if (missingSortedKeys.length > 0) {
      console.log(`DEBUG: ${missingSortedKeys.length} items were missing in the AI sorted order, appending them to the end`);
      missingSortedKeys.forEach(key => {
        sortedItems.push(itemsMapByKey[key]);
      });
    }
    
    return sortedItems;
  } catch (error) {
    console.error("Error in sortItemsWithAI:", error);
    throw error;
  }
}

/**
 * Normalizes direction suggestions to a consistent format
 * regardless of whether they come from Gemini or Claude model
 * @param directions The raw direction suggestions from AI
 * @returns Normalized direction suggestions
 */
function normalizeDirectionSuggestions(directions: any[]): DirectionSuggestion[] {
  return directions.map(direction => {
    // If it already has area and suggestion, just return as is
    if (direction.area && direction.suggestion) {
      return direction;
    }
    
    // If it has title/description format, convert to area/suggestion
    if (direction.title && direction.description) {
      return {
        area: direction.title,
        suggestion: direction.description,
        // Keep examples if present
        ...(direction.examples ? { examples: direction.examples } : {})
      };
    }
    
    // For any other format, try to extract something usable
    return {
      area: direction.area || direction.title || 'Research Direction',
      suggestion: direction.suggestion || direction.description || JSON.stringify(direction)
    };
  });
}

/**
 * Generate direction suggestions for a sermon
 * @param sermon The sermon to analyze
 * @returns Array of direction suggestion objects
 */
export async function generateSermonDirections(sermon: Sermon): Promise<DirectionSuggestion[] | null> {
  // Extract sermon content using our helper function
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createDirectionsUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating direction suggestions for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${directionsSystemPrompt}\n\n${createXmlFunctionDefinition(directionsFunctionSchema)}`;
    
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Sermon Directions',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ directions: DirectionSuggestion[] }>(response);
    
    // Normalize the directions before returning
    const normalizedDirections = normalizeDirectionSuggestions(result.directions || []);
    return normalizedDirections.length ? normalizedDirections : null;
  } catch (error) {
    console.error("ERROR: Failed to generate sermon direction suggestions:", error);
    return null;
  }
}

export async function generateDirectionSuggestions(sermon: Sermon): Promise<DirectionSuggestion[]> {
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createDirectionsUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating direction suggestions for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${directionsSystemPrompt}\n\n${createXmlFunctionDefinition(directionsFunctionSchema)}`;
    
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Direction Suggestions',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ directions: DirectionSuggestion[] }>(response);
    
    // Normalize the directions before returning
    const normalizedDirections = normalizeDirectionSuggestions(result.directions || []);
    return normalizedDirections;
  } catch (error) {
    console.error("ERROR: Failed to generate sermon direction suggestions:", error);
    return [];
  }
} 
