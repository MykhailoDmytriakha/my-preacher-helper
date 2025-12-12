/**
 * Structured Output Implementation for Thought Generation
 * 
 * This module provides a clean implementation of thought generation
 * using OpenAI's structured output feature. It replaces the complex
 * XML-based approach with type-safe Zod schemas.
 * 
 * Benefits:
 * - No manual JSON parsing (~100 lines of code eliminated)
 * - Type-safe responses
 * - Automatic validation
 * - Cleaner, more maintainable code
 */
import { thoughtSystemPrompt, createThoughtUserMessage } from "@/config/prompts";
import { ThoughtResponseSchema, ThoughtResponse } from "@/config/schemas/zod";
import { Sermon } from "@/models/models";

import { logger } from "./openAIHelpers";
import { callWithStructuredOutput, StructuredOutputResult } from "./structuredOutput";

const isDebugMode = process.env.DEBUG_MODE === 'true';

/**
 * Result structure for generateThought operation.
 * Matches the existing interface for backwards compatibility.
 */
export interface GenerateThoughtResult {
  originalText: string;
  formattedText: string | null;
  tags: string[] | null;
  meaningSuccessfullyPreserved: boolean;
}

/**
 * Options for thought generation.
 */
interface GenerateThoughtOptions {
  /** Force a specific tag to be applied (overrides AI suggestion) */
  forceTag?: string | null;
  /** Maximum retry attempts for meaning preservation */
  maxRetries?: number;
}

/**
 * Generate a thought from audio transcription or text using structured output.
 * 
 * This function processes transcription text and returns a formatted thought
 * with appropriate tags. It uses retry logic to ensure meaning is preserved.
 * 
 * @param content - The transcription text to process
 * @param sermon - The sermon context for the thought
 * @param availableTags - List of available tags to choose from
 * @param options - Additional options for generation
 * @returns Processed thought with formatted text and tags
 * 
 * @example
 * ```typescript
 * const result = await generateThoughtStructured(
 *   "Бог есть любовь...",
 *   sermon,
 *   ["Вступление", "Основная часть"],
 *   { forceTag: "Основная часть" }
 * );
 * 
 * if (result.meaningSuccessfullyPreserved) {
 *   console.log(result.formattedText);
 * }
 * ```
 */
export async function generateThoughtStructured(
  content: string,
  sermon: Sermon,
  availableTags: string[] = [],
  options: GenerateThoughtOptions = {}
): Promise<GenerateThoughtResult> {
  const { forceTag = null, maxRetries = 3 } = options;
  let attempts = 0;

  // Create user message with sermon context
  const userMessage = createThoughtUserMessage(
    content, 
    sermon, 
    availableTags, 
    sermon.thoughts
  );

  if (isDebugMode) {
    logger.debug('GenerateThoughtStructured', "Starting generation", {
      contentPreview: content.substring(0, 300) + (content.length > 300 ? '...' : ''),
      availableTags,
      forceTag,
    });
  }

  while (attempts < maxRetries) {
    attempts++;
    logger.info('GenerateThoughtStructured', `Attempt ${attempts}/${maxRetries}`);

    try {
      // Make structured output call
      const result: StructuredOutputResult<ThoughtResponse> = await callWithStructuredOutput(
        thoughtSystemPrompt,
        userMessage,
        ThoughtResponseSchema,
        {
          formatName: "thought",
          logContext: {
            sermonTitle: sermon.title,
            contentLength: content.length,
            attempt: attempts,
          }
        }
      );

      // Handle refusal
      if (result.refusal) {
        logger.warn('GenerateThoughtStructured', `Model refused: ${result.refusal}`);
        return createFailureResult(content);
      }

      // Handle error
      if (result.error || !result.data) {
        logger.error('GenerateThoughtStructured', `No data received`, result.error);
        return createFailureResult(content);
      }

      const response = result.data;

      // Validate response structure
      if (!isValidResponse(response)) {
        logger.warn('GenerateThoughtStructured', `Invalid response structure`, response);
        return createFailureResult(content);
      }

      // Check meaning preservation
      if (response.meaningPreserved) {
        logger.success('GenerateThoughtStructured', `Success on attempt ${attempts}. Meaning preserved.`);
        
        // Apply force tag if provided
        const finalTags = forceTag ? [forceTag] : response.tags;
        
        if (forceTag) {
          logger.info('GenerateThoughtStructured', 
            `Force tag "${forceTag}" applied. Original tags: [${response.tags.join(", ")}]`);
        }

        return {
          originalText: response.originalText,
          formattedText: response.formattedText,
          tags: finalTags,
          meaningSuccessfullyPreserved: true,
        };
      } else {
        // Meaning not preserved - retry
        logger.warn('GenerateThoughtStructured', 
          `Attempt ${attempts} failed: AI indicated meaning not preserved. Retrying...`);
        
        // Delay before retry
        if (attempts < maxRetries) {
          await delay(500 * attempts);
        }
      }

    } catch (error) {
      logger.error('GenerateThoughtStructured', `Attempt ${attempts} failed with error`, error);
      return createFailureResult(content);
    }
  }

  // All retries exhausted
  logger.error('GenerateThoughtStructured', 
    "Failed to generate thought with preserved meaning after all retries.");
  return createFailureResult(content);
}

/**
 * Check if the response has valid structure.
 */
function isValidResponse(response: ThoughtResponse): boolean {
  return (
    typeof response.originalText === "string" &&
    typeof response.formattedText === "string" &&
    response.formattedText.trim() !== '' &&
    Array.isArray(response.tags) &&
    typeof response.meaningPreserved === "boolean"
  );
}

/**
 * Create a failure result.
 */
function createFailureResult(originalContent: string): GenerateThoughtResult {
  return {
    originalText: originalContent,
    formattedText: null,
    tags: null,
    meaningSuccessfullyPreserved: false,
  };
}

/**
 * Delay helper for retry logic.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

