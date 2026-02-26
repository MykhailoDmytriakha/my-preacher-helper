import 'openai/shims/node';
import OpenAI from "openai";

import {
  sortingSystemPrompt,
  createSortingUserMessage,
  directionsSystemPrompt, createDirectionsUserMessage,
  planSystemPrompt, createPlanUserMessage
} from "@/config/prompts";
import {
  DirectionsResponseSchema,
  PlanPointContentResponseSchema,
  PlanSectionResponseSchema,
  SortingResponseSchema,
} from "@/config/schemas/zod";
import { Insights, ThoughtInStructure, SermonPoint, Sermon, VerseWithRelevance, DirectionSuggestion, SermonContent, BrainstormSuggestion, SectionHints } from "@/models/models";
import { validateAudioBlob, createAudioFile, logAudioInfo, hasKnownIssues } from "@/utils/audioFormatUtils";

import { extractSermonContent, formatDuration, logger, extractSectionContent } from "./openAIHelpers";
import { buildPromptBlueprint, buildSimplePromptBlueprint } from "./promptBuilder";
import {
  generateSermonInsightsStructured,
  generateSermonTopicsStructured,
  generateSectionHintsStructured,
  generateSermonVersesStructured,
  generateSermonPointsStructured,
  generateBrainstormSuggestionStructured
} from "./sermon.structured";
import { callWithStructuredOutput } from "./structuredOutput";
import { generateThoughtStructured, type GenerateThoughtResult } from "./thought.structured";

import type { PlanContext, PlanStyle } from "./planTypes";

export type { PlanContext, PlanStyle } from "./planTypes";


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

const aiModel = process.env.AI_MODEL_TO_USE === 'GEMINI' ? geminiModel : gptModel;

function logPayload(
  operationName: string,
  label: string,
  payload: unknown,
  logFullResponse: boolean,
  logMaxLength: number
) {
  const payloadStr = JSON.stringify(payload, null, 2);
  if (payloadStr.length > logMaxLength && !logFullResponse) {
    logger.info(operationName, `${label} (truncated to ${logMaxLength} chars)`, payloadStr.substring(0, logMaxLength) + '...');
    return;
  }
  logger.info(operationName, label, payload);
}

function extractPrettyResponse(response: unknown): unknown {
  const responseObj = response as Record<string, unknown>;
  if (responseObj.choices && Array.isArray(responseObj.choices) && responseObj.choices[0] && typeof responseObj.choices[0] === 'object' && responseObj.choices[0] !== null) {
    const firstChoice = responseObj.choices[0] as Record<string, unknown>;
    if (firstChoice.message && typeof firstChoice.message === 'object' && firstChoice.message !== null) {
      const message = firstChoice.message as Record<string, unknown>;
      if (message.content) {
        return message.content;
      }
      if (message.function_call && typeof message.function_call === 'object' && message.function_call !== null) {
        const functionCall = message.function_call as Record<string, unknown>;
        if (typeof functionCall.arguments === 'string') {
          return JSON.parse(functionCall.arguments);
        }
      }
    }
    return undefined;
  }
  if (responseObj.text) {
    return responseObj.text;
  }
  return response;
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

  logPayload(operationName, "Request data", requestData, logFullResponse, logMaxLength);

  const startTime = performance.now();

  try {
    const response = await apiCallFn();
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);

    logger.success(operationName, `Completed in ${formattedDuration}`);

    logPayload(operationName, "Raw response", response, logFullResponse, logMaxLength);

    const prettyResponse = extractPrettyResponse(response);
    logPayload(operationName, "Pretty response", prettyResponse, logFullResponse, logMaxLength);

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

export async function createTranscription(file: File | Blob): Promise<string> {
  // Validate audio blob using utility
  const validation = validateAudioBlob(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid audio file');
  }

  // Log audio information for debugging (async now)
  await logAudioInfo(file, 'Transcription Input');

  // Check for known format issues and attempt conversion if needed
  if (hasKnownIssues(file.type)) {
    console.warn(`⚠️ Audio format ${file.type} has known compatibility issues with OpenAI`);
    console.warn(`⚠️ Note: Automatic conversion not yet implemented. File will be sent as-is.`);
    console.warn(`⚠️ If transcription fails, this format incompatibility may be the cause.`);

    // TODO: Implement audio conversion here
    // For now, we proceed with the original file but log the warning
    // Future: Convert WebM+Opus to MP3 using Web Audio API or ffmpeg.wasm
  }

  let fileToSend: File;

  if (file instanceof File) {
    fileToSend = file;
  } else {
    // Convert Blob to File with proper naming
    fileToSend = createAudioFile(file);
  }

  const inputInfo = {
    filename: fileToSend.name,
    fileSize: fileToSend.size,
    fileType: fileToSend.type,
    hasKnownIssues: hasKnownIssues(fileToSend.type)
  };

  const requestData = {
    model: audioModel,
    file: 'Audio file content (binary data not shown in logs)'
  };

  try {
    const result = await withOpenAILogging<OpenAI.Audio.Transcription>(
      () => openai.audio.transcriptions.create({
        file: fileToSend,
        model: audioModel,
      }),
      'Transcription',
      requestData,
      inputInfo
    );

    console.log(`✅ Transcription successful: ${result.text.substring(0, 100)}${result.text.length > 100 ? '...' : ''}`);

    return result.text;
  } catch (error) {
    console.error("❌ Error transcribing file:", error);

    // Enhanced error logging for debugging
    if (error instanceof Error) {
      console.error("Error details:", {
        message: error.message,
        name: error.name,
        fileType: fileToSend.type,
        fileSize: fileToSend.size,
        fileName: fileToSend.name,
        hasKnownIssues: hasKnownIssues(fileToSend.type)
      });

      // Add context to error message
      if (hasKnownIssues(fileToSend.type)) {
        throw new Error(`${error.message} (Note: ${fileToSend.type} format may have compatibility issues)`);
      }
    }

    throw error;
  }
}

/**
 * Backward-compatible wrapper around the structured implementation.
 * Kept to avoid breaking imports while removing legacy chat completion calls.
 */
export async function generateThought(
  content: string,
  sermon: Sermon,
  availableTags: string[] = [],
  forceTag?: string | null
): Promise<GenerateThoughtResult> {
  return generateThoughtStructured(content, sermon, availableTags, { forceTag });
}

/**
 * Generate insights for a sermon
 * @param sermon The sermon to analyze
 * @returns Insights object with mainIdea, keyPoints, suggestedOutline, audienceTakeaways
 */
export async function generateSermonInsights(sermon: Sermon): Promise<Insights | null> {
  return generateSermonInsightsStructured(sermon);
}

/**
 * Generate topics for a sermon
 * @param sermon The sermon to analyze
 * @returns Array of topic strings
 */
export async function generateSermonTopics(sermon: Sermon): Promise<string[]> {
  return generateSermonTopicsStructured(sermon);
}

/**
 * Generate a plan by organizing sermon thoughts into introduction, main, and conclusion
 * @param sermon The sermon to analyze
 * @returns SectionHints object with structured plan
 */
export async function generateSectionHints(sermon: Sermon): Promise<SectionHints | null> {
  return generateSectionHintsStructured(sermon);
}

/**
 * Generate Bible verse suggestions for a sermon
 * @param sermon The sermon to analyze
 * @returns Array of verse objects with reference and relevance
 */
export async function generateSermonVerses(sermon: Sermon): Promise<VerseWithRelevance[]> {
  return generateSermonVersesStructured(sermon);
}

type SortedItemResponse = { key: string; outlinePoint?: string; content?: string };

function buildItemsMap(items: ThoughtInStructure[]): {
  itemsMapByKey: Record<string, ThoughtInStructure>;
  itemsWithExistingSermonPoints: Record<string, string>;
} {
  const itemsMapByKey: Record<string, ThoughtInStructure> = {};
  const itemsWithExistingSermonPoints: Record<string, string> = {};

  items.forEach(item => {
    const shortKey = item.id.slice(0, 4);
    itemsMapByKey[shortKey] = item;

    if (item.outlinePointId) {
      itemsWithExistingSermonPoints[shortKey] = item.outlinePointId;
    }
  });

  return { itemsMapByKey, itemsWithExistingSermonPoints };
}

function logItemKeyMapping(itemsMapByKey: Record<string, ThoughtInStructure>) {
  if (!isDebugMode) return;

  console.log("Sort AI: Item key to ID mapping:");
  Object.entries(itemsMapByKey).forEach(([key, item]) => {
    console.log(`  ${key} -> ${item.id.slice(0, 8)}`);
  });
}

function logOriginalItemOrdering(items: ThoughtInStructure[]) {
  if (!isDebugMode) return;

  console.log("DEBUG: Original item ordering:");
  items.forEach((item, index) => {
    console.log(`  [${index}] ${item.id.slice(0, 4)}: "${item.content.substring(0, 30)}..."`);
  });
}

function extractSortedKeysAndAssignments(
  sortedItems: SortedItemResponse[],
  itemsMapByKey: Record<string, ThoughtInStructure>
): { aiSortedKeys: string[]; outlinePointAssignments: Record<string, string> } {
  const extractedKeys: string[] = [];
  sortedItems.forEach((item, pos) => {
    if (item && typeof item.key === 'string') {
      extractedKeys.push(item.key);
      if (isDebugMode) {
        console.log(`DEBUG: AI sorted item [${pos}]: ${item.key}`);
      }
    }
  });

  const outlinePointAssignments: Record<string, string> = {};
  const aiSortedKeys = sortedItems
    .map((aiItem: SortedItemResponse) => {
      if (aiItem && typeof aiItem.key === 'string') {
        const itemKey = aiItem.key.trim();

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

  return { aiSortedKeys, outlinePointAssignments };
}

function findMatchingOutlinePoint(aiAssignedOutlineText: string, outlinePoints: SermonPoint[]): SermonPoint | undefined {
  if (outlinePoints.length === 0) {
    return undefined;
  }

  const normalizedAssignment = aiAssignedOutlineText.toLowerCase();

  let matchingSermonPoint = outlinePoints.find(op =>
    op.text.toLowerCase() === normalizedAssignment
  );

  if (!matchingSermonPoint) {
    matchingSermonPoint = outlinePoints.find(op =>
      op.text.toLowerCase().includes(normalizedAssignment) ||
      normalizedAssignment.includes(op.text.toLowerCase())
    );
  }

  if (!matchingSermonPoint) {
    const aiWords = new Set(normalizedAssignment.split(/\s+/).filter(word => word.length > 3));
    let bestMatchScore = 0;
    let bestMatch: SermonPoint | undefined;

    for (const op of outlinePoints) {
      const opWords = new Set(op.text.toLowerCase().split(/\s+/).filter(word => word.length > 3));
      let matchScore = 0;

      for (const word of aiWords) {
        if (opWords.has(word)) matchScore++;
      }

      if (matchScore > bestMatchScore) {
        bestMatchScore = matchScore;
        bestMatch = op;
      }
    }

    if (bestMatchScore > 0) {
      matchingSermonPoint = bestMatch;
    }
  }

  return matchingSermonPoint;
}

function buildSortedItem(
  key: string,
  itemsMapByKey: Record<string, ThoughtInStructure>,
  itemsWithExistingSermonPoints: Record<string, string>,
  outlinePointAssignments: Record<string, string>,
  outlinePoints: SermonPoint[]
): ThoughtInStructure {
  const item = itemsMapByKey[key];

  if (itemsWithExistingSermonPoints[key]) {
    if (isDebugMode) {
      console.log(`DEBUG: Preserving existing outline point for item ${key}`);
    }
    return item;
  }

  const aiAssignedOutlineText = outlinePointAssignments[key];
  if (aiAssignedOutlineText && outlinePoints.length > 0) {
    const matchingSermonPoint = findMatchingOutlinePoint(aiAssignedOutlineText, outlinePoints);

    if (matchingSermonPoint) {
      if (isDebugMode) {
        console.log(`DEBUG: Successfully matched "${aiAssignedOutlineText}" to outline point "${matchingSermonPoint.text}" (${matchingSermonPoint.id})`);
      }

      return {
        ...item,
        outlinePointId: matchingSermonPoint.id,
        outlinePoint: {
          text: matchingSermonPoint.text,
          section: ''
        }
      };
    }

    if (isDebugMode) {
      console.log(`DEBUG: Could not match "${aiAssignedOutlineText}" to any outline point`);
    }
  }

  return item;
}

function appendMissingSortedItems(
  sortedItems: ThoughtInStructure[],
  itemsMapByKey: Record<string, ThoughtInStructure>,
  aiSortedKeys: string[]
) {
  const missingSortedKeys = Object.keys(itemsMapByKey).filter(key => !aiSortedKeys.includes(key));
  if (missingSortedKeys.length > 0) {
    console.log(`DEBUG: ${missingSortedKeys.length} items were missing in the AI sorted order, appending them to the end`);
    missingSortedKeys.forEach(key => {
      sortedItems.push(itemsMapByKey[key]);
    });
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
export async function sortItemsWithAI(columnId: string, items: ThoughtInStructure[], sermon: Sermon, outlinePoints: SermonPoint[] = []): Promise<ThoughtInStructure[]> {
  try {
    // Create a map for quick lookup by ID
    const { itemsMapByKey, itemsWithExistingSermonPoints } = buildItemsMap(items);
    logItemKeyMapping(itemsMapByKey);

    // Create user message for the AI model
    const userMessage = createSortingUserMessage(columnId, items, sermon, outlinePoints);

    if (isDebugMode) {
      console.log("DEBUG MODE: User message for sorting:", userMessage);
    }

    const inputInfo = {
      columnId,
      itemCount: items.length,
      sermonTitle: sermon.title,
      outlinePointCount: outlinePoints.length
    };
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sort_items",
      promptVersion: "v1",
      systemPrompt: sortingSystemPrompt,
      userMessage,
      context: inputInfo,
    });

    const result = await callWithStructuredOutput(
      promptBlueprint.systemPrompt,
      promptBlueprint.userMessage,
      SortingResponseSchema,
      {
        formatName: 'sort_items',
        model: aiModel,
        promptBlueprint,
        logContext: inputInfo,
      }
    );

    if (!result.success || !result.data) {
      throw result.error || new Error(result.refusal || 'Failed to get sorting response');
    }

    const sortedData = result.data;

    // Log original item order for comparison
    logOriginalItemOrdering(items);

    const { aiSortedKeys, outlinePointAssignments } = extractSortedKeysAndAssignments(sortedData.sortedItems, itemsMapByKey);

    // Create a new array with the sorted items
    const sortedItems: ThoughtInStructure[] = aiSortedKeys.map((key: string) => {
      return buildSortedItem(
        key,
        itemsMapByKey,
        itemsWithExistingSermonPoints,
        outlinePointAssignments,
        outlinePoints
      );
    });

    // Check if all items were included in the sorted result
    appendMissingSortedItems(sortedItems, itemsMapByKey, aiSortedKeys);

    return sortedItems;
  } catch (error) {
    console.error("Error in sortItemsWithAI:", error);
    throw error;
  }
}

/**
 * Generate a plan for a sermon
 * @param sermon The sermon to analyze
 * @param style Optional style for the plan generation (default: 'memory')
 * @returns SermonContent object with introduction, main, and conclusion, plus success flag
 */
export async function generatePlanForSection(sermon: Sermon, section: string, style: PlanStyle = 'memory'): Promise<{ plan: SermonContent, success: boolean }> {
  // Extract only the content for the requested section
  const sectionContent = extractSectionContent(sermon, section);

  // Detect language - simple heuristic based on non-Latin characters
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermon.title + sermon.verse);
  const detectedLanguage = hasNonLatinChars ? "non-English (likely Russian/Ukrainian)" : "English";

  if (isDebugMode) {
    console.log(`DEBUG: Detected sermon language: ${detectedLanguage}`);
    console.log(`DEBUG: Generating plan for ${section} section`);
    console.log(`DEBUG: Style=${style}`);

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
    const styleInstructions = getStyleInstructions(style);
    const blocksInstructions = getStructuredBlocksInstructions();

    // Create user message
    const userMessage = createPlanUserMessage(sermon, section, sectionContent);

    // Log operation info
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      section,
      contentLength: sectionContent.length,
      detectedLanguage,
      style,
      hasOutlineStructure: sermon.outline &&
        sermon.outline[section.toLowerCase() as keyof typeof sermon.outline] &&
        (sermon.outline[section.toLowerCase() as keyof typeof sermon.outline] as unknown[]).length > 0
    };
    const promptBlueprint = buildPromptBlueprint({
      promptName: "plan_for_section",
      promptVersion: "v1",
      expectedLanguage: detectedLanguage,
      context: inputInfo,
      systemBlocks: [
        { blockId: "plan_for_section.system.base", category: "task", content: planSystemPrompt },
        { blockId: `plan_for_section.system.style.${style}`, category: "style", content: styleInstructions },
        { blockId: "plan_for_section.system.structured_blocks", category: "format", content: blocksInstructions },
      ],
      userBlocks: [
        { blockId: "plan_for_section.user.request", category: "context", content: userMessage },
      ],
    });

    const result = await callWithStructuredOutput(
      promptBlueprint.systemPrompt,
      promptBlueprint.userMessage,
      PlanSectionResponseSchema,
      {
        formatName: "plan_for_section",
        model: aiModel,
        promptBlueprint,
        logContext: inputInfo,
      }
    );

    if (!result.success || !result.data) {
      throw result.error || new Error(result.refusal || 'Failed to generate plan for section');
    }

    if (isDebugMode) {
      console.log(`DEBUG: Extracted result for ${section}:`, JSON.stringify(result.data, null, 2));
    }

    // Format response to match SermonContent interface - ensure all values are strings
    const plan: SermonContent = {
      introduction: { outline: result.data.introduction || '' },
      main: { outline: result.data.main || '' },
      conclusion: { outline: result.data.conclusion || '' }
    };

    if (isDebugMode) {
      console.log(`DEBUG: Formatted plan for ${section}:`, JSON.stringify(plan, null, 2));
    }

    // Validate that all outline values are strings
    if (typeof plan.introduction.outline !== 'string' ||
      typeof plan.main.outline !== 'string' ||
      typeof plan.conclusion.outline !== 'string') {
      console.error('ERROR: Invalid plan structure - outline values must be strings');
      const emptyPlan: SermonContent = {
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
    const emptyPlan: SermonContent = {
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
    const inputInfo = {
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      contentLength: sermonContent.length
    };
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon_directions",
      promptVersion: "v1",
      systemPrompt: directionsSystemPrompt,
      userMessage,
      context: inputInfo,
    });

    const result = await callWithStructuredOutput(
      promptBlueprint.systemPrompt,
      promptBlueprint.userMessage,
      DirectionsResponseSchema,
      {
        formatName: "sermon_directions",
        model: aiModel,
        promptBlueprint,
        logContext: inputInfo,
      }
    );

    if (!result.success || !result.data) {
      return [];
    }

    // Normalize the directions before returning
    const normalizedDirections = normalizeDirectionSuggestions(result.data.directions || []);
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
function getStyleInstructions(style: PlanStyle): string {
  switch (style) {
    case 'narrative':
      return `STYLE: NARRATIVE FLOW
- Focus on the story and connection between ideas. 
- You may use complete sentences if they enhance the flow.
- Ensure smooth transitions between points.
- Tone should be engaging and storytelling-oriented.
- Length: Main points can be slightly longer (up to 8-10 words) if needed for narrative flow.`;
    case 'exegetical':
      return `STYLE: EXEGETICAL DEEP DIVE
- Focus on theological accuracy and scriptural depth.
- Use precise theological terminology where appropriate.
- Highlight Greek/Hebrew nuances if present in thoughts.
- Structure should reflect the logical argument of the text.
- Length: Main points can be descriptive (up to 8-10 words).`;
    case 'memory':
    default:
      return `STYLE: MEMORY HOOKS (Default)
- Focus on short, punchy phrases that stick in the mind.
- STRICT LIMIT: Main points MUST be 3-6 words maximum.
- Use alliteration or parallel structure if possible.
- Optimized for quick glancing while preaching.`;
  }
}

function getStructuredBlocksInstructions(): string {
  return `STRUCTURED BLOCKS:
You may include special content blocks if the THOUGHTS contain them. Format them exactly as follows on their own line:
- [Illustration: ...summary of illustration...]
- [Application: ...practical application...]
- [Question: ...engaging question...]
- [Quote: ...quote text - Author...]
- [Definition: ...term definition...]

Use these blocks ONLY if the content is explicitly present in the input THOUGHTS. Do not invent illustrations or quotes.`;
}

interface PlanPointLanguageInfo {
  detectedLanguage: string;
  hasNonLatinChars: boolean;
  isCyrillic: boolean;
  languageDirective: string;
  formatExample: string;
  languageRequirementLabel: string;
}

function getPlanPointLanguageInfo(
  relatedThoughtsTexts: string[],
  sermonTitle: string,
  sermonVerse: string
): PlanPointLanguageInfo {
  const languageProbe = `${relatedThoughtsTexts.join(' ')} ${sermonTitle || ''} ${sermonVerse || ''}`;
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(languageProbe);
  const isCyrillic = /[\u0400-\u04FF]/.test(languageProbe);
  const detectedLanguage = isCyrillic
    ? "Cyrillic (likely Russian/Ukrainian)"
    : (hasNonLatinChars ? "non-English" : "English");

  const languageDirective = isCyrillic
    ? `OUTPUT LANGUAGE: Use only Cyrillic characters. Keep the entire response in the exact same language as the THOUGHTS (e.g., Russian/Ukrainian). Do NOT use any Latin letters in headings or bullets.`
    : `OUTPUT LANGUAGE: Use English consistently.`;

  const formatExample = isCyrillic
    ? `### **Краткий, ясный заголовок**
*Короткая поддерживающая деталь*
[Illustration: История о рыбаке]

* Подпункт (1–2 слова)
* Другой подпункт`
    : `### **Main Concept** 
*Supporting detail or Bible verse*
[Application: Challenge to the congregation]

* Key subpoint
* Another subpoint`;

  const languageRequirementLabel = isCyrillic
    ? 'same Cyrillic language as the THOUGHTS (no Latin letters)'
    : (hasNonLatinChars ? 'same non-English language' : 'English');

  return {
    detectedLanguage,
    hasNonLatinChars,
    isCyrillic,
    languageDirective,
    formatExample,
    languageRequirementLabel
  };
}

function buildPlanPointSystemPrompt(options: {
  style: PlanStyle;
  languageDirective: string;
  keyFragments: string[];
  context?: PlanContext;
}): string {
  const { style, languageDirective, keyFragments, context } = options;

  return `You are a sermon planning assistant specializing in creating memory-friendly outlines for preachers.

Your task is to generate a PREACHING-FRIENDLY plan for a specific point that can be quickly scanned during sermon delivery.

CRITICAL PRINCIPLES:
1. **INSTANT RECOGNITION**: Each point should be immediately recognizable and trigger memory recall
2. **MINIMAL WORDS, MAXIMUM MEANING**: Use concise, powerful phrases that capture the essence
3. **VISUAL SCANNING**: Structure for quick visual scanning during preaching
4. **MEMORY TRIGGERS**: Use keywords and phrases that instantly recall the full context
5. **ACTIONABLE FORMAT**: Each point should guide the preacher on what to say next

FORMAT REQUIREMENTS:
- Use **bold** SPARINGLY: maximum 1-2 words per bullet that are the single most important trigger. If a bullet has no clear standout word — use no bold at all. Do NOT bold every keyword.
- DO NOT use **bold** inside ### headings — headings are already visually prominent and bold inside them breaks markdown rendering.
- Use *italic* for Bible references and supporting details
- Use bullet points (*) for quick scanning
- Keep main points to 3-6 words maximum (unless Style permits otherwise)
- STRICT: Maximum 3 bullet points per ### block. If a thought has more content, distill to the 3 most critical memory triggers. One bullet = one trigger. If it needs more than 5 words — cut it.

${getStyleInstructions(style)}

${getStructuredBlocksInstructions()}

BIBLE VERSE REQUIREMENT:
For every Bible reference explicitly present in the THOUGHTS: write the verse text inline.
- If the verse is SHORT (≤ 2 sentences): write the complete text.
- If the verse is LONG (> 2 sentences): write the first sentence + "..." + the key final clause + reference. The preacher must be able to scan it in 3 seconds while speaking.
Allowed sources: ONLY the THOUGHTS for this outline point, the OUTLINE POINT TEXT, and provided KEY FRAGMENTS.
Treat SERMON TITLE and SCRIPTURE as context only. Do NOT quote or introduce content from them unless the exact Bible reference also appears in the THOUGHTS or in the OUTLINE POINT TEXT.

LANGUAGE REQUIREMENT: Generate in the SAME LANGUAGE as the provided THOUGHTS. DO NOT translate.
${languageDirective}

IMPORTANT:
1. Always generate the plan in the SAME LANGUAGE as the THOUGHTS text. Do not translate.
2. Focus ONLY on the specific outline point and its related thoughts.
3. Maintain the theological perspective and vocabulary from the original thoughts.
4. STRICT: Do not add new theological content, ideas, names, facts or Bible references that are not explicitly present in the THOUGHTS or the OUTLINE POINT TEXT. If something is missing, OMIT it.
5. Organize ideas in a logical sequence that will help with sermon delivery.
6. Include only the key ideas that come directly from the THOUGHTS.
7. Format the response using Markdown:
   - Use ### for main points (DO NOT include the outline point itself as a heading). Each ### heading must be an ACTION SIGNAL or KEY IDEA — a short phrase that tells the preacher WHAT TO SAY OR DO NEXT (e.g. "Задать вопрос", "Иллюстрация: аэродинамика"). NOT a description of the theme. NEVER repeat or paraphrase the outlinePointText in a heading.
   - Use only a single level of bullet points (* ) for supporting details.
8. The sequence of the generated main points (###) and their corresponding bullet points MUST strictly follow the order of the input THOUGHT texts provided in the user message.
9. STRICT: Create EXACTLY the same number of main points (###) as the number of THOUGHTS provided (one heading per thought, in order). Do not add extra headings.
10. STRICT: Bullet points must paraphrase or quote phrases from the corresponding THOUGHT and/or provided key fragments. Do not introduce new subpoints that are not grounded in that THOUGHT.
11. CRITICAL: Explain connections and applications only if they are already present in the THOUGHTS.
12. CRITICAL: Include Bible verses ONLY IF they are explicitly present in the THOUGHTS. Do not invent new references.
${keyFragments.length > 0 ? '13. NATURALLY integrate the provided key fragments into your response as supporting details, NOT as the main content. Key fragments should complement and enhance the broader ideas from the thoughts, not dominate them.' : ''}
${context?.previousPoint ? `14. Context Connection: Ensure the opening of this point flows naturally from the previous point context provided.` : ''}

Your response should be a simple outline optimized for quick preaching reference.`;
}

function buildPlanPointUserMessage(options: {
  sermonTitle: string;
  sermonVerse: string;
  outlinePointText: string;
  relatedThoughtsTexts: string[];
  sectionName: string;
  keyFragments: string[];
  context?: PlanContext;
  formatExample: string;
  languageRequirementLabel: string;
  isCyrillic: boolean;
}): string {
  const {
    sermonTitle,
    sermonVerse,
    outlinePointText,
    relatedThoughtsTexts,
    sectionName,
    keyFragments,
    context,
    formatExample,
    languageRequirementLabel,
    isCyrillic
  } = options;

  return `Create a PREACHING-FRIENDLY plan for the following point in the ${sectionName.toUpperCase()} section that can be quickly scanned during sermon delivery:

SERMON TITLE: ${sermonTitle}
SCRIPTURE (TEXT BANK — use only when the same reference appears in THOUGHTS or OUTLINE POINT): ${sermonVerse}

${context?.previousPoint ? `PREVIOUS POINT (Context Only): "${context.previousPoint.text}"` : ''}
OUTLINE POINT: "${outlinePointText}"
${context?.nextPoint ? `NEXT POINT (Context Only): "${context.nextPoint.text}"` : ''}

${keyFragments.length > 0 ? `==== SUPPORTING KEY FRAGMENTS ====
The following key fragments should be naturally integrated as supporting details to enhance the broader ideas:
${keyFragments.map(frag => `- "${frag}"`).join('\n')}
====================================

` : ''}Based on these related thoughts (maintain this order in your plan):
${relatedThoughtsTexts.map((text, index) => `THOUGHT ${index + 1}: ${text}`).join('\n\n')}

CRITICAL REQUIREMENTS FOR PREACHING:

1. **MEMORY-FRIENDLY FORMAT**: 
   - Each main point should be short and catchy
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
   - ThoughtsBySection for logical preaching flow

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
${context?.previousPoint ? `Specifically, ensure the first thought connects smoothly with the previous point "${context.previousPoint.text}".` : ''}

LANGUAGE REQUIREMENT: Generate in the SAME LANGUAGE as the THOUGHTS. DO NOT translate.
${isCyrillic ? 'For Cyrillic languages, absolutely do not use Latin letters anywhere in the output.' : ''}

IMPORTANT INSTRUCTIONS:
1. Generate the plan in the ${languageRequirementLabel} detected from the THOUGHTS.
2. Provide only main points (###) and a single level of bullet points (* ) - DO NOT create a deeply nested hierarchy.
3. Keep it concise - only high-level structure, not detailed development.
4. Create exactly ${relatedThoughtsTexts.length} main headings (###) — one per THOUGHT in the same order. No extra headings.
5. Bullet points must be derived from the same THOUGHT’s text or key fragments. Do not invent new content.
6. Add scripture references in *italic* and key theological concepts in **bold**, but only if they already exist in the THOUGHTS or the OUTLINE POINT TEXT.
7. Make sure this plan fits within the ${sectionName} section of a sermon.
8. DO NOT include the outline point itself ("${outlinePointText}") as a heading or title in your response.
9. CRITICAL: Each main point heading (###) MUST be a clear, practical, and descriptive title that immediately tells the preacher what this section is about.
10. CRITICAL: The order of the main points (###) and their content in your plan MUST strictly follow the order of the provided THOUGHTS above.
11. STRICT: Do not add examples, claims, or Bible verses that were not mentioned in the THOUGHTS.
12. If any content would require invention, write nothing for that part instead of inventing.
13. Ensure every bullet can be traced back to wording in THOUGHTS or key fragments.
${keyFragments.length > 0 ? '14. CRITICAL: Integrate key fragments naturally as supporting details, not as main content. They should complement the broader ideas from the thoughts.' : ''}

FORMAT EXAMPLE:
${formatExample}

FINAL CHECK: Each point should be scannable in under 2 seconds and immediately trigger the full context for the preacher.`;
}

function trimPlanPointHeadings(
  content: string,
  thoughtsCount: number,
  keyFragmentsCount: number
): string {
  try {
    const maxHeadings = keyFragmentsCount > 0 ? Number.MAX_SAFE_INTEGER : thoughtsCount;
    let headingCount = 0;
    const lines = content.split(/\r?\n/);
    const kept: string[] = [];
    let keepingBlock = true;

    for (const line of lines) {
      if (/^###\s/.test(line.trim())) {
        headingCount += 1;
        if (headingCount <= maxHeadings) {
          keepingBlock = true;
          kept.push(line);
        } else {
          keepingBlock = false;
        }
        continue;
      }

      if (keepingBlock) kept.push(line);
    }

    return kept.join("\n");
  } catch {
    return content;
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
 * @param context Optional context about adjacent points to improve flow
 * @param style Optional style for the plan generation (default: 'memory')
 * @returns The generated content and success status
 */
export async function generatePlanPointContent(
  sermonTitle: string,
  sermonVerse: string,
  outlinePointText: string,
  relatedThoughtsTexts: string[],
  sectionName: string,
  keyFragments: string[] = [],
  context?: PlanContext,
  style: PlanStyle = 'memory'
): Promise<{ content: string; success: boolean }> {
  // Detect language — base primarily on THOUGHTS text to avoid
  // generating a different language than the thoughts themselves
  const languageInfo = getPlanPointLanguageInfo(relatedThoughtsTexts, sermonTitle, sermonVerse);

  if (isDebugMode) {
    console.log(`DEBUG: Detected sermon language: ${languageInfo.detectedLanguage}`);
    console.log(`DEBUG: Generating structured plan for outline point in ${sectionName} section`);
    console.log(`DEBUG: Style=${style}`);
    if (keyFragments.length > 0) {
      console.log(`DEBUG: Including ${keyFragments.length} key fragments in the generation`);
    }
    if (context) {
      console.log(`DEBUG: context provided: prev=${!!context.previousPoint}, next=${!!context.nextPoint}`);
    }
  }

  try {
    // Construct the prompt for generating a structured plan for the outline point
    // Provide a language-specific directive and example to avoid mixed-language outputs
    const systemPrompt = buildPlanPointSystemPrompt({
      style,
      languageDirective: languageInfo.languageDirective,
      keyFragments,
      context
    });

    // Prepare the user message
    const userMessage = buildPlanPointUserMessage({
      sermonTitle,
      sermonVerse,
      outlinePointText,
      relatedThoughtsTexts,
      sectionName,
      keyFragments,
      context,
      formatExample: languageInfo.formatExample,
      languageRequirementLabel: languageInfo.languageRequirementLabel,
      isCyrillic: languageInfo.isCyrillic
    });

    // Log operation info
    const inputInfo = {
      sermonTitle,
      sermonVerse,
      outlinePointText,
      sectionName,
      thoughtsCount: relatedThoughtsTexts.length,
      keyFragmentsCount: keyFragments.length,
      detectedLanguage: languageInfo.detectedLanguage,
      hasContext: !!context,
      style
    };
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "plan_point_content",
      promptVersion: "v2",
      expectedLanguage: languageInfo.isCyrillic ? "ru" : "en",
      systemPrompt,
      userMessage,
      context: inputInfo,
    });

    const result = await callWithStructuredOutput(
      promptBlueprint.systemPrompt,
      promptBlueprint.userMessage,
      PlanPointContentResponseSchema,
      {
        formatName: "plan_point_content",
        model: aiModel,
        promptBlueprint,
        logContext: inputInfo,
      }
    );

    if (!result.success || !result.data) {
      return { content: "", success: false };
    }

    let content = result.data.content.trim();

    // Post-process: limit the number of main headings (###) to the number of THOUGHTS
    // But if key fragments are present, allow more headings as AI may need them for better structure
    content = trimPlanPointHeadings(content, relatedThoughtsTexts.length, keyFragments.length);

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
export async function generateSermonPoints(sermon: Sermon, section: string): Promise<{ outlinePoints: SermonPoint[]; success: boolean }> {
  return generateSermonPointsStructured(sermon, section);
}

/**
 * Generate a brainstorm suggestion for a sermon to help overcome mental blocks
 * @param sermon The sermon to generate brainstorm suggestion for
 * @returns A single brainstorm suggestion
 */
export async function generateBrainstormSuggestion(sermon: Sermon): Promise<BrainstormSuggestion | null> {
  return generateBrainstormSuggestionStructured(sermon);
} 
