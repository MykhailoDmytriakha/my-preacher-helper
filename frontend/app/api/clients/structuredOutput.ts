/**
 * Structured Output Utility Module
 * 
 * Provides a clean interface for AI calls using OpenAI's structured output feature.
 * This eliminates the need for manual JSON parsing and validation.
 * 
 * Benefits:
 * - Type-safe responses via Zod schemas
 * - Automatic validation
 * - Clean error handling
 * - Works with both OpenAI and Gemini models
 */
import 'openai/shims/node';
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { logger, formatDuration } from "./openAIHelpers";

// Environment configuration
const gptModel = process.env.OPENAI_GPT_MODEL as string;
const geminiModel = process.env.GEMINI_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// Initialize Gemini client (OpenAI-compatible)
const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  dangerouslyAllowBrowser: true,
});

// Select model and client based on configuration
const aiModel = process.env.AI_MODEL_TO_USE === 'GEMINI' ? geminiModel : gptModel;
const aiAPI = process.env.AI_MODEL_TO_USE === 'GEMINI' ? gemini : openai;

/**
 * Result type for structured output calls.
 * Contains either the parsed data or error information.
 */
export interface StructuredOutputResult<T> {
  success: boolean;
  data: T | null;
  refusal: string | null;
  error: Error | null;
}

/**
 * Options for structured output API calls.
 */
export interface StructuredOutputOptions {
  /** Name for the response format (used in logging) */
  formatName: string;
  /** Additional context for logging */
  logContext?: Record<string, unknown>;
}

/**
 * Make an AI call with structured output.
 * 
 * Uses OpenAI's beta.chat.completions.parse() method which guarantees
 * the response matches the provided Zod schema.
 * 
 * @param systemPrompt - The system instruction for the AI
 * @param userMessage - The user message/content to process
 * @param schema - Zod schema defining the expected response structure
 * @param options - Configuration options for the call
 * @returns Typed result with parsed data or error info
 * 
 * @example
 * ```typescript
 * const result = await callWithStructuredOutput(
 *   "Process the transcription...",
 *   userContent,
 *   ThoughtResponseSchema,
 *   { formatName: "thought" }
 * );
 * 
 * if (result.success && result.data) {
 *   console.log(result.data.formattedText);
 * }
 * ```
 */
export async function callWithStructuredOutput<T extends z.ZodType>(
  systemPrompt: string,
  userMessage: string,
  schema: T,
  options: StructuredOutputOptions
): Promise<StructuredOutputResult<z.infer<T>>> {
  const { formatName, logContext = {} } = options;
  const operationName = `StructuredOutput:${formatName}`;

  logger.info(operationName, "Starting structured output call");
  
  if (isDebugMode) {
    logger.debug(operationName, "Input context", logContext);
  }

  const startTime = performance.now();

  try {
    // Combine system and user messages
    // Note: Some models don't support separate system messages
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: `${systemPrompt}\n\n${userMessage}` }
    ];

    // Make API call with structured output
    const completion = await aiAPI.beta.chat.completions.parse({
      model: aiModel,
      messages,
      response_format: zodResponseFormat(schema, formatName),
    });

    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);

    // Check for refusal (model declined to respond)
    const message = completion.choices[0]?.message;
    
    if (message?.refusal) {
      logger.warn(operationName, `Model refused to respond after ${formattedDuration}`, {
        refusal: message.refusal
      });
      
      return {
        success: false,
        data: null,
        refusal: message.refusal,
        error: null,
      };
    }

    // Get parsed response
    const parsed = message?.parsed;
    
    if (!parsed) {
      logger.error(operationName, `No parsed data in response after ${formattedDuration}`);
      
      return {
        success: false,
        data: null,
        refusal: null,
        error: new Error("No parsed data in response"),
      };
    }

    logger.success(operationName, `Completed in ${formattedDuration}`);
    
    if (isDebugMode) {
      logger.debug(operationName, "Parsed response", parsed);
    }

    return {
      success: true,
      data: parsed,
      refusal: null,
      error: null,
    };

  } catch (error) {
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);

    logger.error(operationName, `Failed after ${formattedDuration}`, error);

    return {
      success: false,
      data: null,
      refusal: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Get the current AI model being used.
 * Useful for logging and debugging.
 */
export function getCurrentAIModel(): string {
  return aiModel;
}

/**
 * Get the current AI provider.
 */
export function getCurrentAIProvider(): 'GEMINI' | 'OPENAI' {
  return process.env.AI_MODEL_TO_USE === 'GEMINI' ? 'GEMINI' : 'OPENAI';
}

