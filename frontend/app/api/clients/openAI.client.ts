import 'openai/shims/node';
import OpenAI from "openai";
import { Insights, Item, OutlinePoint, Sermon, VerseWithRelevance, DirectionSuggestion, Plan, BrainstormSuggestion } from "@/models/models";
import { 
  thoughtSystemPrompt, createThoughtUserMessage,
  insightsSystemPrompt, createInsightsUserMessage,
  createSortingUserMessage,
  topicsSystemPrompt, createTopicsUserMessage,
  versesSystemPrompt, createVersesUserMessage,
  directionsSystemPrompt, createDirectionsUserMessage,
  planSystemPrompt, createPlanUserMessage, createThoughtsPlanUserMessage,
  brainstormSystemPrompt, createBrainstormUserMessage
} from "@/config/prompts";
import {
  thoughtFunctionSchema,
  sortingFunctionSchema,
  insightsFunctionSchema,
  topicsFunctionSchema,
  versesFunctionSchema,
  directionsFunctionSchema,
  planFunctionSchema,
  brainstormFunctionSchema
} from "@/config/schemas";
import { extractSermonContent, formatDuration, logger, extractSectionContent } from "./openAIHelpers";

// const isTestEnvironment = process.env.NODE_ENV === 'test';

const audioModel = process.env.OPENAI_AUDIO_MODEL as string;
const gptModel = process.env.OPENAI_GPT_MODEL as string; // This should be 'o1-mini'
const geminiModel = process.env.GEMINI_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Allow browser environment during tests
  dangerouslyAllowBrowser: true,
});

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  // Allow browser environment during tests
  dangerouslyAllowBrowser: true,
});

const aiModel = process.env.AI_MODEL_TO_USE === 'GEMINI' ? geminiModel : gptModel;
const aiAPI = process.env.AI_MODEL_TO_USE === 'GEMINI' ? gemini : openai;

// Create XML function definition for Claude/Gemini-style prompts using JSON Schema
// Correctly interprets the function.parameters JSON Schema and asks the model
// to return an arguments object that CONFORMS to that schema (not the schema itself).
function createXmlFunctionDefinition(functionSchema: Record<string, unknown>): string {
  const schema = functionSchema.function as Record<string, unknown>;
  const parametersSchema = schema.parameters as Record<string, unknown>;

  // parametersSchema follows JSON Schema: { type: 'object', properties: { ... }, required: [...] }
  const properties = (parametersSchema && (parametersSchema as any).properties) || {};

  let xmlDefinition = `
<function name="${schema.name as string}">
  <parameters>`;

  // List each top-level argument (actual properties of the JSON Schema)
  for (const [propName, propSchema] of Object.entries(properties as Record<string, any>)) {
    const p = propSchema as Record<string, unknown>;
    xmlDefinition += `
    <parameter name="${propName}" type="${(p.type as string) || 'object'}">
      ${(p.description as string) || ''}
    </parameter>`;
  }

  xmlDefinition += `
  </parameters>
</function>

Your response should be structured as follows:

<function_call name="${schema.name as string}">
<arguments>
{
`;

  // Provide an arguments template for each property
  for (const [propName, propSchema] of Object.entries(properties as Record<string, any>)) {
    const p = propSchema as Record<string, unknown>;
    const t = (p.type as string) || 'object';
    if (t === 'array') {
      xmlDefinition += `  "${propName}": [],\n`;
    } else if (t === 'object') {
      xmlDefinition += `  "${propName}": {},\n`;
    } else if (t === 'boolean') {
      xmlDefinition += `  "${propName}": false,\n`;
    } else if (t === 'number' || t === 'integer') {
      xmlDefinition += `  "${propName}": 0,\n`;
    } else {
      // default to string
      xmlDefinition += `  "${propName}": "",\n`;
    }
  }

  // Remove the last trailing comma
  xmlDefinition = xmlDefinition.replace(/,\n$/, '\n');

  xmlDefinition += `}
</arguments>
</function_call>

Only return the JSON arguments object that matches the schema inside <arguments>.
Do not include the JSON Schema itself inside <arguments>. The response MUST be valid JSON.`;

  return xmlDefinition;
}

// Helper function to extract structured data (like JSON) when returned within the main response content
// Handles formats often seen with models like Claude or Gemini when not using strict tool/function calls
// Tries parsing from <arguments> tags, JSON markdown blocks, and raw JSON objects.

function cleanPotentiallyInvalidJsonString(jsonString: string): string {
  // Attempt to fix unescaped quotes within strings
  // This regex finds typical JSON string values and escapes unescaped quotes within them
  try {
    return jsonString.replace(/: *"((?:\\.|[^"\\])*)"/g, (match, group1) => {
      const cleanedGroup = group1.replace(/(?<!\\)"/g, '\\"');
      return `: "${cleanedGroup}"`;
    });
  } catch (e) {
     console.warn("JSON cleaning regex failed, using basic cleanup:", e);
     // Basic heuristic cleanup as fallback (less reliable)
     return jsonString.replace(/(?<!\\)"(?!\s*[:,\}\]])/g, '\\"');
  }
}

function extractStructuredResponseFromContent<T>(responseContent: string): T {
  try {
    // Zeroth try: If the whole content is valid JSON, parse it directly
    // This covers cases where the model returns plain JSON as the message content
    const trimmed = responseContent.trim();
    try {
      // Only attempt if it looks like a JSON object/array to avoid obvious failures
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return JSON.parse(trimmed) as T;
      }
    } catch (_) {
      // Ignore and continue with other extraction strategies
    }

    // First try: Extract JSON from within the <arguments> tags
    const argumentsMatch = responseContent.match(/<arguments>([\s\S]*?)<\/arguments>/);
    if (argumentsMatch && argumentsMatch[1]) {
      let jsonString = argumentsMatch[1].trim();
      // Clean the string before parsing
      jsonString = cleanPotentiallyInvalidJsonString(jsonString); 
      try {
        const parsed = JSON.parse(jsonString);
        // If the parsed content looks like a JSON Schema (e.g., has 'type' and/or 'properties'),
        // it's likely the model echoed the schema rather than actual arguments. In that case, fall through
        // to try other extraction methods (like a subsequent JSON block with real data).
        const looksLikeSchema = parsed && typeof parsed === 'object' && (
          (Object.prototype.hasOwnProperty.call(parsed, 'properties')) ||
          (Object.prototype.hasOwnProperty.call(parsed, 'type') && (parsed.type === 'object' || parsed.type === 'array'))
        );
        if (!looksLikeSchema) {
          return parsed as T;
        }
        console.warn('Detected schema-like content inside <arguments>; attempting alternative extraction for data.');
      } catch (parseError) {
        console.warn("Failed to parse cleaned JSON from <arguments>, trying other methods:", parseError);
        // Fall through if parsing still fails
      }
    } 
    
    // Second try: Look for a JSON object
    console.log("No <arguments> tags found or failed to parse, trying alternative extraction methods");
    
    // Try to extract JSON from code blocks
    // If multiple code blocks exist, try the last one first as it often contains the final data
    const codeBlockMatches = [...responseContent.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
    if (codeBlockMatches.length > 0) {
      let codeBlockContent = codeBlockMatches[codeBlockMatches.length - 1][1].trim();
      try {
        // Attempt to salvage truncated JSON (existing logic)
        const lastBrace = codeBlockContent.lastIndexOf('}');
        const lastBracket = codeBlockContent.lastIndexOf(']');
        const lastValidCharIndex = Math.max(lastBrace, lastBracket);

        if (lastValidCharIndex > -1) {
          let openBraces = 0;
          let openBrackets = 0;
          for(let i = 0; i <= lastValidCharIndex; i++) {
            if (codeBlockContent[i] === '{') openBraces++;
            else if (codeBlockContent[i] === '}') openBraces--;
            else if (codeBlockContent[i] === '[') openBrackets++;
            else if (codeBlockContent[i] === ']') openBrackets--;
          }
          if (openBraces >= 0 && openBrackets >= 0) {
              codeBlockContent = codeBlockContent.substring(0, lastValidCharIndex + 1);
          }
        }

        // Clean up the potentially truncated JSON string
        const cleanedJson = cleanPotentiallyInvalidJsonString(codeBlockContent) // Clean here
          .replace(/,\s*}/g, '}')
          .replace(/,\s*\]/g, ']');
        return JSON.parse(cleanedJson) as T;
      } catch (e) {
        console.log("Failed to parse JSON from potentially truncated code block, trying other methods:", e);
        // Fall through to try other extraction methods if parsing still fails
      }
    }
    
    // Try to extract any JSON object/array in the response
    // Prefer the largest balanced block rather than the smallest non-greedy match
    const jsonMatches = [...responseContent.matchAll(/\{[\s\S]*\}|\[[\s\S]*\]/g)];
    // Choose the longest match which is more likely to be the outer structure
    const jsonMatch = jsonMatches.length > 0 
      ? jsonMatches.reduce((longest, current) => (current[0].length > longest[0].length ? current : longest)) 
      : null;
    
    if (jsonMatch) {
      try {
        // Clean up the JSON string
        const jsonString = jsonMatch[0];
        const cleanedJson = cleanPotentiallyInvalidJsonString(jsonString) // Clean here
          .replace(/,\s*}/g, '}')
          .replace(/,\s*\]/g, ']');
        return JSON.parse(cleanedJson) as T;
      } catch (e) {
        console.log("Failed to parse JSON object, trying more specific extraction:", e);
      }
    }

    // Specific handling for known structures (outline, directions, sortedItems)
    // These might need cleaning too if they contain complex strings
    // ... (existing specific handling logic - potentially add cleaning here if needed) ...

    throw new Error("Could not find any valid structured data (JSON) in model response content after cleaning attempts");
  } catch (error) {
    // Ensure the error message reflects the broader scope
    console.error("Failed to parse structured data from model response content:", error);
    throw new Error("Invalid response format from AI model after cleaning attempts");
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
  apiCallFn: () => Promise<T>, 
  operationName: string, 
  requestData: Record<string, unknown>,
  inputInfo: Record<string, unknown>,
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
    
    let prettyResponse: unknown;
    
    // Handle different response formats based on the operation
    const responseObj = response as Record<string, unknown>;
    if (responseObj.choices && Array.isArray(responseObj.choices) && responseObj.choices[0] && typeof responseObj.choices[0] === 'object' && responseObj.choices[0] !== null) {
      const firstChoice = responseObj.choices[0] as Record<string, unknown>;
      if (firstChoice.message && typeof firstChoice.message === 'object' && firstChoice.message !== null) {
        const message = firstChoice.message as Record<string, unknown>;
        if (message.content) {
          // For content-based responses (Claude-style)
          prettyResponse = message.content;
        } else if (message.function_call && typeof message.function_call === 'object' && message.function_call !== null) {
          // For function call responses
          const functionCall = message.function_call as Record<string, unknown>;
          if (typeof functionCall.arguments === 'string') {
            prettyResponse = JSON.parse(functionCall.arguments);
          }
        }
      }
    } else if (responseObj.text) {
      // For transcription responses
      prettyResponse = responseObj.text;
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
  availableTags: string[] = [],
  forceTag?: string | null
): Promise<GenerateThoughtResult> {
  const MAX_RETRIES = 3;
  let attempts = 0;

  // Create user message, now passing sermon.thoughts
  const userMessage = createThoughtUserMessage(content, sermon, availableTags, sermon.thoughts);

  if (isDebugMode) {
    logger.debug('GenerateThought', "Starting generation for content", content.substring(0, 300) + (content.length > 300 ? '...' : ''));
    logger.debug('GenerateThought', "Available tags", availableTags);
    if (forceTag) {
      logger.debug('GenerateThought', "Force tag applied", forceTag);
    }
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
          
          // Apply force tag if provided
          let finalTags = result.tags;
          if (forceTag) {
            logger.info('GenerateThought', `Force tag "${forceTag}" applied. Overwriting tags: ${result.tags.join(", ")} -> [${forceTag}]`);
            finalTags = [forceTag];
          }
          
          return {
            originalText: result.originalText,
            formattedText: result.formattedText, // Renamed from 'text'
            tags: finalTags,
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
 * Generate a plan by organizing sermon thoughts into introduction, main, and conclusion
 * @param sermon The sermon to analyze
 * @returns ThoughtsPlan object with structured plan
 */
export async function generateThoughtsPlan(sermon: Sermon): Promise<{ introduction: string; main: string; conclusion: string } | null> {
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createThoughtsPlanUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating thoughts plan for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${planSystemPrompt}\n\n${createXmlFunctionDefinition(planFunctionSchema)}`;
    
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
      'Generate Thoughts Plan',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ introduction: string; main: string; conclusion: string }>(response);
    return result || null;
  } catch (error) {
    console.error("ERROR: Failed to generate thoughts plan:", error);
    return null;
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
    sortedData.sortedItems.forEach((item: Record<string, unknown>, pos: number) => {
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
      .map((aiItem: Record<string, unknown>) => {
        if (aiItem && typeof aiItem.key === 'string') {
          const itemKey = aiItem.key.trim();
          
          // Store the outline point assignment if available
          if (itemsMapByKey[itemKey] && aiItem.outlinePoint && typeof aiItem.outlinePoint === 'string') {
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
                          (sermon.outline[section.toLowerCase() as keyof typeof sermon.outline] as unknown[]).length > 0
    };
    
    // Make API call
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Plan for Section',
      requestOptions,
      inputInfo
    );
    
    // Extract response - AI returns full plan structure
    const result = extractFunctionResponse<{ introduction: string; main: string; conclusion: string }>(response);
    
    // Debug: Log the extracted result
    console.log(`DEBUG: Extracted result for ${section}:`, JSON.stringify(result, null, 2));
    
    // Format response to match Plan interface - ensure all values are strings
    const plan: Plan = {
      introduction: { outline: result?.introduction || '' },
      main: { outline: result?.main || '' },
      conclusion: { outline: result?.conclusion || '' }
    };
    
    // Debug: Log the formatted plan
    console.log(`DEBUG: Formatted plan for ${section}:`, JSON.stringify(plan, null, 2));
    
    // Validate that all outline values are strings
    if (typeof plan.introduction.outline !== 'string' || 
        typeof plan.main.outline !== 'string' || 
        typeof plan.conclusion.outline !== 'string') {
      console.error('ERROR: Invalid plan structure - outline values must be strings');
      const emptyPlan: Plan = {
        introduction: { outline: '' },
        main: { outline: '' },
        conclusion: { outline: '' }
      };
      return { plan: emptyPlan, success: false };
    }
    
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
function normalizeDirectionSuggestions(directions: unknown[]): DirectionSuggestion[] {
  return directions.map((direction: unknown) => {
    const dir = direction as Record<string, unknown>;
    
    // If it already has area and suggestion, just return as is
    if (dir.area && dir.suggestion) {
      return dir as DirectionSuggestion;
    }
    
    // If it has title/description format, convert to area/suggestion
    if (dir.title && dir.description) {
      return {
        area: dir.title as string,
        suggestion: dir.description as string,
        // Keep examples if present
        ...(dir.examples ? { examples: dir.examples as string[] } : {})
      };
    }
    
    // For any other format, try to extract something usable
    return {
      area: (dir.area || dir.title || 'Research Direction') as string,
      suggestion: (dir.suggestion || dir.description || JSON.stringify(direction)) as string
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
 * @param keyFragments Array of key fragments to include in the prompt
 * @returns The generated content and success status
 */
export async function generatePlanPointContent(
  sermonTitle: string,
  sermonVerse: string,
  outlinePointText: string,
  relatedThoughtsTexts: string[],
  sectionName: string,
  keyFragments: string[] = []
): Promise<{ content: string; success: boolean }> {
  // Detect language - simple heuristic based on non-Latin characters
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermonTitle + sermonVerse);
  const detectedLanguage = hasNonLatinChars ? "non-English (likely Russian/Ukrainian)" : "English";
  
  if (isDebugMode) {
    console.log(`DEBUG: Detected sermon language: ${detectedLanguage}`);
    console.log(`DEBUG: Generating structured plan for outline point in ${sectionName} section`);
    if (keyFragments.length > 0) {
      console.log(`DEBUG: Including ${keyFragments.length} key fragments in the generation`);
    }
  }
  
  try {
    // Construct the prompt for generating a structured plan for the outline point
    const systemPrompt = `You are a sermon planning assistant specializing in creating memory-friendly outlines for preachers.

Your task is to generate a PREACHING-FRIENDLY plan for a specific point that can be quickly scanned during sermon delivery.

CRITICAL PRINCIPLES:
1. **INSTANT RECOGNITION**: Each point should be immediately recognizable and trigger memory recall
2. **MINIMAL WORDS, MAXIMUM MEANING**: Use concise, powerful phrases that capture the essence
3. **VISUAL SCANNING**: Structure for quick visual scanning during preaching
4. **MEMORY TRIGGERS**: Use keywords and phrases that instantly recall the full context
5. **ACTIONABLE FORMAT**: Each point should guide the preacher on what to say next

FORMAT REQUIREMENTS:
- Use **bold** for main concepts and key theological terms
- Use *italic* for Bible references and supporting details
- Use bullet points (*) for quick scanning
- Keep main points to 3-6 words maximum
- Use clear, memorable phrases that capture the essence
- Structure for logical flow that's easy to follow during preaching

MANDATORY BIBLE VERSE REQUIREMENT: 
CRITICAL: For every Bible reference mentioned, you MUST write out the COMPLETE TEXT of the verse(s) in the plan, not just the reference. 
Example: Instead of "Деян. 3:6", write "Деян. 3:6: «Серебра и золота нет у меня, а что имею, то даю тебе: во имя Иисуса Христа Назарея встань и ходи»"
The preacher must be able to read the full verse directly from the plan without opening a Bible.

LANGUAGE REQUIREMENT: Generate in the SAME LANGUAGE as the sermon content. DO NOT translate.

IMPORTANT: 
1. Always generate the plan in the SAME LANGUAGE as the input. Do not translate.
2. Focus ONLY on the specific outline point and its related thoughts.
3. Maintain the theological perspective from the original thoughts.
4. Do not add new theological content or Bible references that aren't in the provided thoughts.
5. Organize ideas in a logical sequence that will help with sermon delivery.
6. Include the most important key ideas from the provided thoughts.
7. Format the response using Markdown:
   - Use ### for main points (DO NOT include the outline point itself as a heading). Each ### heading MUST be a clear, practical, and descriptive title (3-6 words) that immediately tells the preacher what this section is about and how to use it in the sermon.
   - Use only a single level of bullet points (* ) for supporting details.
8. The sequence of the generated main points (###) and their corresponding bullet points MUST strictly follow the order of the input THOUGHT texts provided in the user message.
9. CRITICAL: Each main point should provide a clear theological insight or practical application, not just copy-paste from the original thoughts.
10. CRITICAL: Explain the connection between modern examples and biblical stories, showing how they illustrate the same spiritual principles.
11. CRITICAL: Focus on the deeper meaning and application, not just surface-level facts.
12. CRITICAL: Include ALL Bible verses and quotes COMPLETELY - do not abbreviate, summarize, or reference them partially. Every scripture reference must be written out in full.
${keyFragments.length > 0 ? '13. NATURALLY integrate the provided key fragments into your response as supporting details, NOT as the main content. Key fragments should complement and enhance the broader ideas from the thoughts, not dominate them.' : ''}

Your response should be a simple outline optimized for quick preaching reference.`;

    // Prepare the user message
    const userMessage = `Create a PREACHING-FRIENDLY plan for the following point in the ${sectionName.toUpperCase()} section that can be quickly scanned during sermon delivery:

SERMON TITLE: ${sermonTitle}
SCRIPTURE: ${sermonVerse}
OUTLINE POINT: "${outlinePointText}"

${keyFragments.length > 0 ? `==== SUPPORTING KEY FRAGMENTS ====
The following key fragments should be naturally integrated as supporting details to enhance the broader ideas:
${keyFragments.map(frag => `- "${frag}"`).join('\n')}
====================================

` : ''}
Based on these related thoughts (maintain this order in your plan):
${relatedThoughtsTexts.map((text, index) => `THOUGHT ${index + 1}: ${text}`).join('\n\n')}

CRITICAL REQUIREMENTS FOR PREACHING:

1. **MEMORY-FRIENDLY FORMAT**: 
   - Each main point should be 3-6 words maximum
   - Use **bold** for key concepts that trigger memory
   - Use *italic* for Bible references and supporting details
   - Create visual hierarchy for quick scanning

2. **INSTANT RECOGNITION**:
   - Every point should be immediately recognizable
   - Use memorable phrases that capture the essence
   - Include memory triggers that recall full context
   - Make each point actionable for the preacher

3. **QUICK SCANNING STRUCTURE**:
   - Use bullet points (*) for easy visual scanning
   - Keep subpoints to 1-2 words maximum
   - Use clear transitions between ideas
   - Structure for logical preaching flow

4. **PREACHING OPTIMIZATION**:
   - Focus on what the preacher needs to SAY
   - Include key theological terms in **bold**
   - Highlight Bible verses in *italic*
   - Use action-oriented language

MANDATORY BIBLE VERSE REQUIREMENT: 
CRITICAL: For every Bible reference mentioned, you MUST write out the COMPLETE TEXT of the verse(s) in the plan, not just the reference. 
Example: Instead of "Деян. 3:6", write "Деян. 3:6: «Серебра и золота нет у меня, а что имею, то даю тебе: во имя Иисуса Христа Назарея встань и ходи»"
The preacher must be able to read the full verse directly from the plan without opening a Bible.

THOUGHT FLOW REQUIREMENT:
Create a logical flow of thought development, showing how one idea naturally flows into the next. Each point should build upon the previous one, creating a smooth narrative progression rather than just a list of disconnected points.

LANGUAGE REQUIREMENT: Generate in the SAME LANGUAGE as the sermon content. DO NOT translate.

IMPORTANT INSTRUCTIONS:
1. Generate the plan in the ${hasNonLatinChars ? 'same non-English' : 'English'} language as the input.
2. Provide only main points (###) and a single level of bullet points (* ) - DO NOT create a deeply nested hierarchy.
3. Keep it concise - I need only the high-level structure, not detailed development.
4. Identify just 2-4 key points that support the outline point, grouped logically under headings.
5. Include only brief notes on illustrations or examples where essential.
6. Add scripture references in *italic* and key theological concepts in **bold**.
7. Make sure this plan fits within the ${sectionName} section of a sermon.
8. DO NOT include the outline point itself ("${outlinePointText}") as a heading or title in your response.
9. CRITICAL: Each main point heading (###) MUST be a clear, practical, and descriptive title (3-6 words) that immediately tells the preacher what this section is about and how to use it in the sermon. The title should be actionable and specific.
10. CRITICAL: The order of the main points (###) and their content in your plan MUST strictly follow the order of the provided THOUGHTS above.
11. CRITICAL: Focus on theological insights and practical applications, not just copying facts.
12. CRITICAL: Explain how modern examples connect to biblical principles and spiritual truths.
13. CRITICAL: Emphasize the deeper meaning and spiritual significance of each example.
14. CRITICAL: Include ALL Bible verses and quotes COMPLETELY - do not abbreviate, summarize, or reference them partially. Every scripture reference must be written out in full.
${keyFragments.length > 0 ? '15. CRITICAL: Integrate key fragments naturally as supporting details, not as main content. They should complement the broader ideas from the thoughts.' : ''}

FORMAT EXAMPLE:
## **Main Concept** 
*Supporting detail or Bible reference*

* Key subpoint
* Another subpoint

FINAL CHECK: Each point should be scannable in under 2 seconds and immediately trigger the full context for the preacher.`;

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
      keyFragmentsCount: keyFragments.length,
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

/**
 * Generate outline points for a section based on sermon content
 * @param sermon The sermon to analyze
 * @param section The section to generate outline points for (introduction, main, conclusion)
 * @returns Array of generated outline points and success status
 */
export async function generateOutlinePoints(sermon: Sermon, section: string): Promise<{ outlinePoints: OutlinePoint[]; success: boolean }> {
  // Extract only the content for the requested section
  const sectionContent = extractSectionContent(sermon, section);
  
  // Detect language - simple heuristic based on non-Latin characters
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermon.title + sermon.verse);
  const detectedLanguage = hasNonLatinChars ? "non-English (likely Russian/Ukrainian)" : "English";
  
  if (isDebugMode) {
    console.log(`DEBUG: Detected sermon language: ${detectedLanguage}`);
    console.log(`DEBUG: Generating outline points for ${section} section`);
  }
  
  try {
    // For Claude models
    const systemPrompt = `You are a helpful assistant for sermon preparation.

Your task is to generate a list of outline points for the ${section} section of a sermon, based on the content provided.

IMPORTANT:
1. Always generate the outline points in the SAME LANGUAGE as the input. Do not translate.
2. Generate 3-5 clear, concise outline points that capture the key themes and ideas in the provided content.
3. Each outline point should be a short phrase, not a complete sentence (10 words or less is ideal).
4. The outline points should flow logically and build on each other.
5. For the introduction section, focus on points that introduce the sermon theme and capture attention.
6. For the main section, focus on the key theological points and arguments.
7. For the conclusion section, focus on application points and closing thoughts.
8. DO NOT include numbering or bullet points in your response, just the text of each point.
9. Return EXACTLY 3-5 points, with each point on its own line.
10. Maintain the theological perspective from the original content.`;

    // Create user message
    const userMessage = `Please generate 3-5 outline points for the ${section.toUpperCase()} section of my sermon based on the following content:

SERMON TITLE: ${sermon.title}
SCRIPTURE: ${sermon.verse}

SECTION CONTENT:
${sectionContent}

Generate each outline point as a short, clear phrase (not a complete sentence). Make each point build logically on the previous ones.
Keep the outline points in the ${hasNonLatinChars ? 'same non-English' : 'English'} language as the input.
DO NOT include numbers or bullets, just the text of each point on separate lines.
DO NOT explain your choices, just provide the 3-5 outline points.`;

    // Prepare request options
    const requestOptions = {
      model: aiModel,
      messages: createMessagesArray(systemPrompt, userMessage)
    };
    
    // Log operation info
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      section,
      contentLength: sectionContent.length,
      detectedLanguage
    };
    
    // Make API call
    const response = await withOpenAILogging<OpenAI.Chat.ChatCompletion>(
      () => aiAPI.chat.completions.create(requestOptions),
      'Generate Outline Points',
      requestOptions,
      inputInfo
    );
    
    // Extract the content from the response
    const content = response.choices[0]?.message?.content?.trim() || "";
    
    if (!content) {
      return { outlinePoints: [], success: false };
    }
    
    // Convert the content into outline points (one per line)
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const outlinePoints: OutlinePoint[] = lines.map(line => ({
      id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: line.trim()
    }));
    
    return { outlinePoints, success: outlinePoints.length > 0 };
  } catch (error) {
    console.error(`ERROR: Failed to generate outline points for ${section} section:`, error);
    return { outlinePoints: [], success: false };
  }
}

/**
 * Generate a brainstorm suggestion for a sermon to help overcome mental blocks
 * @param sermon The sermon to generate brainstorm suggestion for
 * @returns A single brainstorm suggestion
 */
export async function generateBrainstormSuggestion(sermon: Sermon): Promise<BrainstormSuggestion | null> {
  // Extract sermon content using our helper function
  const sermonContent = extractSermonContent(sermon);
  const userMessage = createBrainstormUserMessage(sermon, sermonContent);
  
  if (isDebugMode) {
    console.log("DEBUG: Generating brainstorm suggestion for sermon:", sermon.id);
  }
  
  try {
    // For Claude models
    const xmlFunctionPrompt = `${brainstormSystemPrompt}\n\n${createXmlFunctionDefinition(brainstormFunctionSchema)}`;
    
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
      'Generate Brainstorm Suggestion',
      requestOptions,
      inputInfo
    );
    
    const result = extractFunctionResponse<{ suggestion: BrainstormSuggestion }>(response);
    
    // Add an ID to the suggestion and normalize the type to lowercase
    const suggestion: BrainstormSuggestion = {
      ...result.suggestion,
      type: result.suggestion.type.toLowerCase() as BrainstormSuggestion['type'],
      id: `bs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    return suggestion;
  } catch (error) {
    console.error("ERROR: Failed to generate brainstorm suggestion:", error);
    return null;
  }
} 
