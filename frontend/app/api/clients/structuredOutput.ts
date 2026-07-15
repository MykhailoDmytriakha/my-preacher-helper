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

import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { isUsageCapReachedError } from "@/services/usageLimits";

import { providerAdapters } from "./ai/providerAdapters";
import { resolveStructuredTargets, type ModelTarget, type Workload } from "./ai/routing";
import { emitStructuredTelemetryEvent, TokenUsage } from "./aiTelemetry";
import { logger, formatDuration } from "./openAIHelpers";
import { buildSimplePromptBlueprint, PromptBlueprint } from "./promptBuilder";

import type { UsageAdmission } from '@/services/usageLimits.server';
import type OpenAI from "openai";

const isDebugMode = process.env.DEBUG_MODE === 'true';
const DEFAULT_STRUCTURED_WORKLOAD: Workload = 'structured.default';

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
  /** Optional model override */
  model?: string;
  /** Structured workload used to resolve the provider and default model */
  workload?: Workload;
  /** Optional explicit prompt name for analytics tracking */
  promptName?: string;
  /** Optional prompt version (default: v1) */
  promptVersion?: string;
  /** Optional expected language label for quality analysis */
  expectedLanguage?: string | null;
  /** Optional prebuilt prompt blueprint (modular prompt metadata) */
  promptBlueprint?: PromptBlueprint;
  /** Server-trusted owner used to resolve entitlement and TEXT model preferences */
  userId?: string;
  /** Request-scoped admission created by the owning route for a composite action. */
  usageAdmission?: UsageAdmission;
}

async function executeStructuredTarget<T extends z.ZodType>(
  target: ModelTarget,
  {
    systemPrompt,
    userMessage,
    schema,
    formatName,
  }: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
    formatName: string;
  }
) {
  const client = providerAdapters[target.providerId].client;
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  return client.beta.chat.completions.parse({
    model: target.modelId,
    messages,
    response_format: zodResponseFormat(schema, formatName),
  });
}

async function runWithFallback<TResult>(
  targets: readonly [ModelTarget, ...ModelTarget[]],
  execute: (target: ModelTarget) => Promise<TResult>,
  onAttempt: (target: ModelTarget) => void,
  index = 0
): Promise<TResult> {
  const target = targets[index] as ModelTarget;
  onAttempt(target);

  try {
    return await execute(target);
  } catch (error) {
    const disposition = providerAdapters[target.providerId].classifyError(error);
    const canTryNext = disposition !== 'terminal' && index < targets.length - 1;
    if (!canTryNext) throw error;
    return runWithFallback(targets, execute, onAttempt, index + 1);
  }
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
 *   { formatName: "thought", userId: trustedOwnerUid }
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
  const workload = options.workload ?? DEFAULT_STRUCTURED_WORKLOAD;
  const base = resolveStructuredTargets({ workload })[0];
  const legacyTarget: ModelTarget = {
    providerId: base.providerId,
    modelId: options.model || base.modelId,
  };
  const executionState: { target: ModelTarget | null } = { target: null };
  const promptBlueprint = options.promptBlueprint || buildSimplePromptBlueprint({
    promptName: options.promptName || formatName,
    promptVersion: options.promptVersion,
    expectedLanguage: options.expectedLanguage,
    context: logContext,
    systemPrompt,
    userMessage,
  });
  if (isDebugMode) {
    logger.debug(operationName, "Input context", logContext);
  }

  const startTime = performance.now();

  try {
    let targets: [ModelTarget, ...ModelTarget[]] = [legacyTarget];
    let consumeSuccessfulAiCall: (() => Promise<void>) | undefined;
    if (options.userId) {
      const [
        { getUserEntitlementServerSide },
        { resolveUserTextTargets },
        { assertAiUsageAvailable, consumeAiUsage, isUsageAdmitted },
      ] = await Promise.all([
        import('@/services/userEntitlement.server'),
        import('./ai/tierPolicy'),
        import('@/services/usageLimits.server'),
      ]);
      const now = new Date();
      const entitlement = await getUserEntitlementServerSide(options.userId, {
        includeTextPreference: true,
      });
      if (!isUsageAdmitted(options.usageAdmission, options.userId, 'ai')) {
        assertAiUsageAvailable(entitlement, now);
      }
      targets = await resolveUserTextTargets(entitlement, {
        // Legacy fields remain a fallback for existing user documents.
        providerId: entitlement.preferredText?.providerId ?? entitlement.preferredProviderId,
        modelId: entitlement.preferredText?.modelId ?? entitlement.preferredModelId,
      }, now);
      consumeSuccessfulAiCall = () => consumeAiUsage(options.userId as string, now);
    }

    const completion = await runWithFallback(
      targets,
      (target) => executeStructuredTarget(target, {
        systemPrompt: promptBlueprint.systemPrompt,
        userMessage: promptBlueprint.userMessage,
        schema,
        formatName,
      }),
      (target) => {
        executionState.target = target;
        logger.info(operationName, `Starting structured output call using model: ${target.modelId}`);
      }
    );
    const target = executionState.target;
    if (!target) throw new Error('Structured-output target was not executed');
    const model = target.modelId;
    const provider = target.providerId.toUpperCase();

    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);

    // Extract usage if available
    let usage: TokenUsage | null = null;

    if (completion.usage) {
      usage = {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      };

      logger.info(operationName, `Usage: ${usage.totalTokens} tokens (In: ${usage.promptTokens}, Out: ${usage.completionTokens})`);
    }

    // Check for refusal (model declined to respond)
    const message = completion.choices[0]?.message;

    if (message?.refusal) {
      logger.warn(operationName, `Model refused to respond after ${formattedDuration}`, {
        refusal: message.refusal
      });
      emitStructuredTelemetryEvent({
        provider,
        model,
        formatName,
        promptBlueprint,
        logContext,
        latencyMs: durationMs,
        status: "refusal",
        refusal: message.refusal,
        usage,
        rawMessage: message.content || null,
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
      emitStructuredTelemetryEvent({
        provider,
        model,
        formatName,
        promptBlueprint,
        logContext,
        latencyMs: durationMs,
        status: "invalid_response",
        rawMessage: message?.content || null,
        usage,
        errorMessage: "No parsed data in response",
      });

      return {
        success: false,
        data: null,
        refusal: null,
        error: new Error("No parsed data in response"),
      };
    }

    await consumeSuccessfulAiCall?.();

    logger.success(operationName, `Completed in ${formattedDuration}`);

    if (isDebugMode) {
      logger.debug(operationName, "Parsed response", parsed);
    }
    emitStructuredTelemetryEvent({
      provider,
      model,
      formatName,
      promptBlueprint,
      logContext,
      latencyMs: durationMs,
      status: "success",
      parsedOutput: parsed,
      usage,
      rawMessage: message?.content || null,
    });

    return {
      success: true,
      data: parsed,
      refusal: null,
      error: null,
    };

  } catch (error) {
    if (isUsageCapReachedError(error)) throw error;

    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const formattedDuration = formatDuration(durationMs);

    logger.error(operationName, `Failed after ${formattedDuration}`, error);
    if (executionState.target) {
      emitStructuredTelemetryEvent({
        provider: executionState.target.providerId.toUpperCase(),
        model: executionState.target.modelId,
        formatName,
        promptBlueprint,
        logContext,
        latencyMs: durationMs,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

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
  return resolveStructuredTargets({ workload: DEFAULT_STRUCTURED_WORKLOAD })[0].modelId;
}

/**
 * Get the current AI provider.
 */
export function getCurrentAIProvider(): string {
  return resolveStructuredTargets({ workload: DEFAULT_STRUCTURED_WORKLOAD })[0].providerId.toUpperCase();
}
