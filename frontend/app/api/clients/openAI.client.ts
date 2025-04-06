import OpenAI from "openai";
import { Insights, Item, OutlinePoint, Sermon, Thought, VerseWithRelevance, DirectionSuggestion, Plan } from "@/models/models";
import { v4 as uuidv4 } from 'uuid';
import { 
  thoughtSystemPrompt, createThoughtUserMessage,
  insightsSystemPrompt, createInsightsUserMessage,
  sortingSystemPrompt, createSortingUserMessage,
  topicsSystemPrompt, createTopicsUserMessage,
  versesSystemPrompt, createVersesUserMessage,
  directionsSystemPrompt, createDirectionsUserMessage,
  planSystemPrompt, createPlanUserMessage
} from "@/config/prompts";
import {
  thoughtFunctionSchema,
  sortingFunctionSchema,
  insightsFunctionSchema,
  topicsFunctionSchema,
  versesFunctionSchema,
  directionsFunctionSchema,
  planFunctionSchema
} from "@/config/schemas";
import { extractSermonContent, parseAIResponse, logOperationTiming, formatDuration, logger, extractSectionContent } from "./openAIHelpers";

const isTestEnvironment = process.env.NODE_ENV === 'test';

const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string; // This should be 'o1-mini'
const geminiModel = process.env.GEMINI_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Conditionally allow browser environment ONLY during tests
  ...(isTestEnvironment && { dangerouslyAllowBrowser: true }),
});

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  // Conditionally allow browser environment ONLY during tests
  ...(isTestEnvironment && { dangerouslyAllowBrowser: true }),
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
    } else if (param.type === "boolean") {
      xmlDefinition += `  "${paramName}": false,\n`;
    } else {
      xmlDefinition += `  "${paramName}": "",\n`;
    }
  }

  // Remove the last trailing comma
  xmlDefinition = xmlDefinition.replace(/,\n$/, '\n');

  xmlDefinition += `}
</arguments>
</function_call>

The response MUST be valid JSON within the <arguments> tags.`;

  return xmlDefinition;
}

// Helper function to extract structured data (like JSON) when returned within the main response content
// Handles formats often seen with models like Claude or Gemini when not using strict tool/function calls
// Tries parsing from <arguments> tags, JSON markdown blocks, and raw JSON objects.
function extractStructuredResponseFromContent<T>(responseContent: string): T {
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
      let codeBlockContent = codeBlockMatch[1].trim();
      try {
        // Attempt to salvage truncated JSON by finding the last valid brace/bracket
        const lastBrace = codeBlockContent.lastIndexOf('}');
        const lastBracket = codeBlockContent.lastIndexOf(']');
        const lastValidCharIndex = Math.max(lastBrace, lastBracket);

        if (lastValidCharIndex > -1) {
          // Ensure we don't cut off nested structures incorrectly, basic check
          // Count braces and brackets up to the potential cut-off point
          let openBraces = 0;
          let openBrackets = 0;
          for(let i = 0; i <= lastValidCharIndex; i++) {
            if (codeBlockContent[i] === '{') openBraces++;
            else if (codeBlockContent[i] === '}') openBraces--;
            else if (codeBlockContent[i] === '[') openBrackets++;
            else if (codeBlockContent[i] === ']') openBrackets--;
          }
          // Only truncate if it seems balanced or slightly off (due to potential cut)
          // This is heuristic and might not cover all edge cases perfectly
          if (openBraces >= 0 && openBrackets >= 0) {
              codeBlockContent = codeBlockContent.substring(0, lastValidCharIndex + 1);
          }
        }

        // Clean up the potentially truncated JSON string
        const cleanedJson = codeBlockContent
          .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
          .replace(/,\s*\]/g, ']'); // Remove trailing commas in arrays
        return JSON.parse(cleanedJson) as T;
      } catch (e) {
        console.log("Failed to parse JSON from potentially truncated code block, trying other methods:", e);
        // Fall through to try other extraction methods if parsing still fails
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

    // For Gemini model responses handling outline format specifically
    if (responseContent.includes("\"outline\":")) {
      try {
        // Try to clean up the JSON by finding the outline string and parsing it
        const outlineMatch = responseContent.match(/"outline"\s*:\s*"([^"]*?)"/);
        if (outlineMatch) {
          const cleanedJson = `{"outline": "${outlineMatch[1].replace(/"/g, '\\"')}"}`;
          return JSON.parse(cleanedJson) as T;
        }
        
        // Try with multiline string
        const multilineOutlineMatch = responseContent.match(/"outline"\s*:\s*"([\s\S]*?)"/);
        if (multilineOutlineMatch) {
          const cleanedOutline = multilineOutlineMatch[1].replace(/"/g, '\\"').replace(/\n/g, '\\n');
          const cleanedJson = `{"outline": "${cleanedOutline}"}`;
          return JSON.parse(cleanedJson) as T;
        }
        
        // Handle case where outline is a raw text block without quotes
        const rawOutlineMatch = responseContent.match(/"outline"\s*:\s*([^{}\[\],"]+)/);
        if (rawOutlineMatch) {
          const outlineContent = rawOutlineMatch[1].trim();
          const cleanedJson = `{"outline": "${outlineContent.replace(/"/g, '\\"')}"}`;
          return JSON.parse(cleanedJson) as T;
        }
        
        // Last resort - try to extract any content after "outline":
        const lastResortMatch = responseContent.match(/"outline"\s*:\s*([\s\S]+?)(?:,\s*"|\s*}|$)/);
        if (lastResortMatch) {
          let outlineContent = lastResortMatch[1].trim();
          
          // If it starts and ends with quotes, extract the content between
          if (outlineContent.startsWith('"') && outlineContent.endsWith('"')) {
            outlineContent = outlineContent.slice(1, -1);
          }
          
          // Clean the content
          const cleanedOutline = outlineContent.replace(/"/g, '\\"').replace(/\n/g, '\\n');
          const cleanedJson = `{"outline": "${cleanedOutline}"}`;
          
          try {
            return JSON.parse(cleanedJson) as T;
          } catch (e) {
            console.log("Failed to parse cleaned outline JSON", e);
          }
        }
      } catch (e) {
        console.log("Failed to extract outline string", e);
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
    
    throw new Error("Could not find any valid structured data (JSON) in model response content");
  } catch (error) {
    // Ensure the error message reflects the broader scope
    console.error("Failed to parse structured data from model response content:", error);
    throw new Error("Invalid response format from AI model");
  }
}

// Helper function to extract function response
function extractFunctionResponse<T>(response: OpenAI.Chat.ChatCompletion): T {
  // Check if the response contains structured data within the main content
  if (response.choices[0].message.content) {
    // Use the renamed function here
    return extractStructuredResponseFromContent<T>(response.choices[0].message.content);
  }
  
  // Add checks for standard OpenAI function/tool calls if needed in the future
  // else if (response.choices[0].message.function_call) { ... }
  // else if (response.choices[0].message.tool_calls) { ... }

  throw new Error("No structured data found in the response content or known function/tool call fields");
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
    logFullResponse = true,
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

// Define the new return structure
interface GenerateThoughtResult {
  originalText: string;
  formattedText: string | null; // Renamed from 'text'
  tags: string[] | null;
  meaningSuccessfullyPreserved: boolean;
}

// Generate a single thought from audio transcription or text, with retry logic
export async function generateThought(
  content: string,
  sermon: Sermon,
  availableTags: string[] = []
): Promise<GenerateThoughtResult> {
  const MAX_RETRIES = 3;
  let attempts = 0;

  // Create user message (remains the same)
  const userMessage = createThoughtUserMessage(content, sermon, availableTags);

  if (isDebugMode) {
    logger.debug('GenerateThought', "Starting generation for content", content.substring(0, 300) + (content.length > 300 ? '...' : ''));
    logger.debug('GenerateThought', "Available tags", availableTags);
  }

  while (attempts < MAX_RETRIES) {
    attempts++;
    logger.info('GenerateThought', `Attempt ${attempts}/${MAX_RETRIES}`);

    try {
      const xmlFunctionPrompt = `${thoughtSystemPrompt}\n\n${createXmlFunctionDefinition(thoughtFunctionSchema)}`;

      const requestOptions = {
        model: aiModel,
        messages: createMessagesArray(xmlFunctionPrompt, userMessage)
      };

      const inputInfo = {
        contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        sermonTitle: sermon.title,
        availableTags,
        attempt: attempts
      };

      const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
        () => aiAPI.chat.completions.create(requestOptions),
        'Generate Thought',
        requestOptions,
        inputInfo
      );

      // Define the expected structure including the new field
      interface ThoughtResponse {
        originalText: string;
        formattedText: string; // Renamed from 'text'
        tags: string[];
        meaningPreserved: boolean;
      }

      const result = extractFunctionResponse<ThoughtResponse>(response);

      // **Validation and Meaning Check**
      if (
        result &&
        typeof result.originalText === "string" &&
        typeof result.formattedText === "string" && // Renamed from 'text'
        result.formattedText.trim() !== '' && // Ensure formattedText is not empty
        Array.isArray(result.tags) &&
        typeof result.meaningPreserved === "boolean" 
      ) {
        if (result.meaningPreserved) {
          // Success! Meaning preserved according to AI
          logger.success('GenerateThought', `Success on attempt ${attempts}. Meaning preserved.`);
          logger.info('GenerateThought', `Original: ${result.originalText.substring(0, 60)}${result.originalText.length > 60 ? "..." : ""}`); // Log original
          logger.info('GenerateThought', `Formatted: ${result.formattedText.substring(0, 60)}${result.formattedText.length > 60 ? "..." : ""}`); // Log formatted
          logger.info('GenerateThought', `Tags: ${result.tags.join(", ")}`);
          return {
            originalText: result.originalText,
            formattedText: result.formattedText, // Renamed from 'text'
            tags: result.tags,
            meaningSuccessfullyPreserved: true,
          };
        } else {
          // Valid response, but AI indicated meaning was NOT preserved
          logger.warn('GenerateThought', `Attempt ${attempts} failed: AI indicated meaning not preserved. Retrying...`);
          // Continue to the next attempt
        }
      } else {
        // Invalid response structure
        logger.warn('GenerateThought', `Attempt ${attempts} failed: Invalid response structure received.`, result);
        // **Immediately return failure on invalid structure**
        return {
          originalText: content,
          formattedText: null,
          tags: null,
          meaningSuccessfullyPreserved: false,
        };
      }
    } catch (error) {
      // **Immediately return failure on any exception**
      logger.error('GenerateThought', `Attempt ${attempts} failed with error. Failing operation.`, error);
      return {
        originalText: content,
        formattedText: null,
        tags: null,
        meaningSuccessfullyPreserved: false,
      };
      // Removed retry logic from catch block
    }
    
    // If we reach here, it means meaningPreserved was false, add a delay before retrying
    if (attempts < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempts)); 
    }
  }

  // If loop finishes without success (all attempts had meaningPreserved: false)
  logger.error('GenerateThought', "Failed to generate thought with preserved meaning after all retries.");
  return {
    originalText: content, // Return original input content on failure
    formattedText: null,
    tags: null,
    meaningSuccessfullyPreserved: false,
  };
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
    const itemsWithExistingOutlinePoints: Record<string, string> = {}; // Store items that already have outlinePointId

    items.forEach(item => {
      // Add the item to lookup maps, using just the first 4 chars of the ID as key
      const shortKey = item.id.slice(0, 4);
      itemsMapByKey[shortKey] = item;
      
      // Remember which items already have an outline point assigned
      if (item.outlinePointId) {
        itemsWithExistingOutlinePoints[shortKey] = item.outlinePointId;
      }
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
      sortedData = extractStructuredResponseFromContent(content);
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
          console.log(`DEBUG: AI sorted item [${pos}]: ${item.key}`);
        }
      }
    });
    
    // Map of item keys to AI-suggested outline points
    const outlinePointAssignments: Record<string, string> = {};
    
    // Extract AI's suggestions
    const aiSortedKeys = sortedData.sortedItems
      .map((aiItem: any) => {
        if (aiItem && typeof aiItem.key === 'string') {
          const itemKey = aiItem.key.trim();
          
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
      
      // Check if this item already had an outline point assigned
      if (itemsWithExistingOutlinePoints[key]) {
        // Keep the existing outline point
        if (isDebugMode) {
          console.log(`DEBUG: Preserving existing outline point for item ${key}`);
        }
        return item;
      }
      
      // Find matching outline point ID based on the AI-assigned outline text for unassigned items
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
 * Generate a plan for a sermon
 * @param sermon The sermon to analyze
 * @returns Plan object with introduction, main, and conclusion, plus success flag
 */
export async function generatePlanForSection(sermon: Sermon, section: string): Promise<{ plan: Plan, success: boolean }> {
  // Extract only the content for the requested section
  const sectionContent = extractSectionContent(sermon, section);
  
  // Detect language - simple heuristic based on non-Latin characters
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermon.title + sermon.verse);
  const detectedLanguage = hasNonLatinChars ? "non-English (likely Russian/Ukrainian)" : "English";
  
  if (isDebugMode) {
    console.log(`DEBUG: Detected sermon language: ${detectedLanguage}`);
    console.log(`DEBUG: Generating plan for ${section} section`);
    
    // Log if outline structure exists for this section
    const sectionLower = section.toLowerCase();
    if (sermon.outline && sermon.outline[sectionLower as keyof typeof sermon.outline]) {
      const outlinePoints = sermon.outline[sectionLower as keyof typeof sermon.outline];
      console.log(`DEBUG: Found ${outlinePoints.length} outline points for ${section} section`);
    } else {
      console.log(`DEBUG: No outline points found for ${section} section`);
    }
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${planSystemPrompt}\n\n${createXmlFunctionDefinition(planFunctionSchema)}`;
    
    // Create user message
    const userMessage = createPlanUserMessage(sermon, section, sectionContent);
    
    // Prepare request options
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(xmlFunctionPrompt, userMessage)
    };
    
    // Log operation info
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      section,
      contentLength: sectionContent.length,
      detectedLanguage,
      hasOutlineStructure: sermon.outline && 
                          sermon.outline[section.toLowerCase() as keyof typeof sermon.outline] && 
                          (sermon.outline[section.toLowerCase() as keyof typeof sermon.outline] as any).length > 0
    };
    
    // Make API call
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Plan for Section',
      requestOptions,
      inputInfo
    );
    
    // Extract response
    const result = extractFunctionResponse<{ outline: string }>(response);
    
    // Format response to match Plan interface
    const sectionLower = section.toLowerCase();
    const plan: Plan = {
      introduction: { outline: '' },
      main: { outline: '' },
      conclusion: { outline: '' }
    };
    
    // Set the outline for the requested section
    plan[sectionLower as keyof Plan] = { outline: result.outline };
    
    return { plan, success: true };
  } catch (error) {
    console.error(`ERROR: Failed to generate plan for ${section} section:`, error);
    // Return empty plan structure on error, but indicate failure
    const emptyPlan: Plan = {
      introduction: { outline: '' },
      main: { outline: '' },
      conclusion: { outline: '' }
    };
    return { plan: emptyPlan, success: false };
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
    // Return the normalized directions (could be an empty array)
    return normalizedDirections;
  } catch (error) {
    console.error("ERROR: Failed to generate sermon direction suggestions:", error);
    // Return an empty array on error for consistent handling
    return [];
  }
}

/**
 * Generate plan content for a specific outline point based on related thoughts
 * @param sermonTitle The title of the sermon
 * @param sermonVerse The Bible verse for the sermon
 * @param outlinePointText The text of the outline point
 * @param relatedThoughtsTexts Array of texts from related thoughts
 * @param sectionName The section name (introduction, main, conclusion)
 * @returns The generated content and success status
 */
export async function generatePlanPointContent(
  sermonTitle: string,
  sermonVerse: string,
  outlinePointText: string,
  relatedThoughtsTexts: string[],
  sectionName: string
): Promise<{ content: string; success: boolean }> {
  // Detect language - simple heuristic based on non-Latin characters
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermonTitle + sermonVerse);
  const detectedLanguage = hasNonLatinChars ? "non-English (likely Russian/Ukrainian)" : "English";
  
  if (isDebugMode) {
    console.log(`DEBUG: Detected sermon language: ${detectedLanguage}`);
    console.log(`DEBUG: Generating structured plan for outline point in ${sectionName} section`);
  }
  
  try {
    // Construct the prompt for generating a structured plan for the outline point
    const systemPrompt = `You are a helpful assistant for sermon preparation.

Your task is to generate a simple outline plan for a specific point in a sermon, based ONLY on the thoughts provided.

IMPORTANT: 
1. Always generate the plan in the SAME LANGUAGE as the input. Do not translate.
2. Keep the plan simple with just main points and a single level of bullet points underneath.
3. DO NOT create deeply nested or highly detailed plans.
4. Focus ONLY on the specific outline point and its related thoughts.
5. Maintain the theological perspective from the original thoughts.
6. Do not add new theological content or Bible references that aren't in the provided thoughts.
7. Organize ideas in a logical sequence that will help with sermon delivery.
8. Include only the most important key ideas from the provided thoughts.
9. Format the response using Markdown:
   - Use ### for main points (DO NOT include the outline point itself as a heading)
   - Use only a single level of bullet points (* ) for supporting details

Your response should be a simple outline with just main points and their direct sub-points.`;

    // Prepare the user message
    const userMessage = `Please generate a simple, not-too-detailed plan outline for the following point in the ${sectionName.toUpperCase()} section of my sermon:

SERMON TITLE: ${sermonTitle}
SCRIPTURE: ${sermonVerse}
OUTLINE POINT: "${outlinePointText}"

Based on these related thoughts:
${relatedThoughtsTexts.map((text, index) => `THOUGHT ${index + 1}: ${text}`).join('\n\n')}

IMPORTANT INSTRUCTIONS:
1. Generate the plan in the ${hasNonLatinChars ? 'same non-English' : 'English'} language as the input.
2. Provide only main points and a single level of bullet points - DO NOT create a deeply nested hierarchy.
3. Keep it concise - I need only the high-level structure, not detailed development.
4. Identify just 2-4 key points that support the outline point.
5. Include only brief notes on illustrations or examples where essential.
6. Add scripture references in *italic* and key theological concepts in **bold**.
7. Make sure this plan fits within the ${sectionName} section of a sermon.
8. DO NOT include the outline point itself ("${outlinePointText}") as a heading or title in your response.

Format your response as a simple outline with just main points and their direct sub-points using Markdown. Do not write full paragraphs or create deeply nested points.`;

    // Prepare request options
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(systemPrompt, userMessage)
    };
    
    // Log operation info
    const inputInfo = {
      sermonTitle,
      sermonVerse,
      outlinePointText,
      sectionName,
      thoughtsCount: relatedThoughtsTexts.length,
      detectedLanguage
    };
    
    // Make API call
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Plan Point Structure',
      requestOptions,
      inputInfo
    );
    
    // Extract the content from the response
    const content = response.choices[0]?.message?.content?.trim() || "";
    
    return { content, success: content.length > 0 };
  } catch (error) {
    console.error(`ERROR: Failed to generate plan for outline point "${outlinePointText}":`, error);
    return { content: "", success: false };
  }
} 
