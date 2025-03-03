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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string; // This should be 'o1-mini'
const isDebugMode = process.env.DEBUG_MODE === 'true';

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
    const jsonRegex = /\{[\s\S]*?\}/;
    const jsonMatch = responseContent.match(jsonRegex);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    } 
    
    throw new Error("Could not find any JSON object in model response");
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
    logMaxLength = 500
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
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
      sermonTitle: sermon.title,
      availableTags
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
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
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      columnId,
      itemCount: items.length,
      sermonTitle: sermon.title,
      outlinePointCount: outlinePoints.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
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
          return itemsMapByKey[itemKey] ? itemKey : null;
        }
        return null;
      })
      .filter((key: string | null): key is string => key !== null);
    
    // Create a new array with the sorted items
    const sortedItems: Item[] = aiSortedKeys.map((key: string) => itemsMapByKey[key]);
    
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
 * Generate insights for a sermon
 * @param sermon The sermon to analyze
 * @returns Insights object with mainIdea, keyPoints, suggestedOutline, audienceTakeaways
 */
export async function generateSermonInsights(sermon: Sermon): Promise<Insights | null> {
  // Extract sermon content using our helper function
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createInsightsUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating insights for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${insightsSystemPrompt}\n\n${createXmlFunctionDefinition(insightsFunctionSchema)}`;
    
    const requestOptions = {
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
      'Generate Sermon Insights',
      requestOptions,
      inputInfo
    );
    
    return extractFunctionResponse<Insights>(response);
  } catch (error) {
    console.error("ERROR: Failed to generate sermon insights:", error);
    return null;
  }
}

/**
 * Generate topics for a sermon
 * @param sermon The sermon to analyze
 * @returns Array of topic strings
 */
export async function generateSermonTopics(sermon: Sermon): Promise<string[]> {
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createTopicsUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating topics for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${topicsSystemPrompt}\n\n${createXmlFunctionDefinition(topicsFunctionSchema)}`;
    
    const requestOptions = {
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
      'Generate Sermon Topics',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ topics: string[] }>(response);
    return result.topics || [];
  } catch (error) {
    console.error("ERROR: Failed to generate sermon topics:", error);
    return [];
  }
}

/**
 * Generate Bible verse suggestions for a sermon
 * @param sermon The sermon to analyze
 * @returns Array of verse objects with reference and relevance
 */
export async function generateSermonVerses(sermon: Sermon): Promise<VerseWithRelevance[]> {
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createVersesUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating verse suggestions for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${versesSystemPrompt}\n\n${createXmlFunctionDefinition(versesFunctionSchema)}`;
    
    const requestOptions = {
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
      'Generate Sermon Verses',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ verses: VerseWithRelevance[] }>(response);
    return result.verses || [];
  } catch (error) {
    console.error("ERROR: Failed to generate sermon verses:", error);
    return [];
  }
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
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
      'Generate Sermon Directions',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ directions: DirectionSuggestion[] }>(response);
    return result.directions || null;
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
      model: gptModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => openai.chat.completions.create(requestOptions),
      'Generate Direction Suggestions',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ directions: DirectionSuggestion[] }>(response);
    return result.directions || [];
  } catch (error) {
    console.error("ERROR: Failed to generate sermon direction suggestions:", error);
    return [];
  }
} 
