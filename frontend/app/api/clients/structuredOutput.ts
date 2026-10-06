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
import { emitStructuredTelemetryEvent, openStructuredTelemetryEvent, TokenUsage } from "./aiTelemetry";
import { logger, formatDuration } from "./openAIHelpers";
import { buildSimplePromptBlueprint, PromptBlueprint } from "./promptBuilder";

import type { ErrorDisposition } from "./ai/providerAdapters";
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
  /**
   * Per-request transport overrides. The SDK defaults are `maxRetries: 2` and a 10-minute
   * timeout — both longer than the 60s serverless wall, so a stalled provider takes the
   * whole function down with no JSON body. Callers that run behind that wall should pass
   * a deadline under it and `maxRetries: 0`. Omitted => unchanged SDK behaviour.
   */
  requestOptions?: { timeout?: number; maxRetries?: number };
}

async function executeStructuredTarget<T extends z.ZodType>(
  target: ModelTarget,
  {
    systemPrompt,
    userMessage,
    schema,
    formatName,
    requestOptions,
  }: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
    formatName: string;
    requestOptions?: { timeout?: number; maxRetries?: number };
  }
) {
  const client = providerAdapters[target.providerId].client;
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const params = {
    model: target.modelId,
    messages,
    response_format: zodResponseFormat(schema, formatName),
  };

  // Callers without transport overrides keep the exact previous call shape — no second
  // argument at all — so nothing else in the app changes behaviour because of this option.
  return requestOptions
    ? client.beta.chat.completions.parse(params, requestOptions)
    : client.beta.chat.completions.parse(params);
}

/**
 * A PASSING HICCUP IS RETRIED ONCE, BY WHOEVER OWNS THE RETRIES
 * (BUG-20260905-ai-chain-never-retries-same-model).
 *
 * The SDK retries a 429, a 5xx or a timeout twice by itself, so a caller that leaves it alone needs
 * nothing more here. A caller behind the 60 s serverless wall switches that off (`maxRetries: 0`)
 * and sets its own deadline — and got no retry at all: a second of provider trouble cost the person
 * the whole run. For such a caller, once the chain has no next target, a `retrySameProvider`
 * verdict earns one more try on the same model after a short pause, inside what is left of the
 * SAME deadline and only when enough of it is left for a real answer. Moving on to a next target
 * is unchanged.
 */
const SAME_TARGET_RETRY_PAUSE_MS = 500;
const SAME_TARGET_RETRY_MIN_BUDGET_MS = 10_000;
/** Under this much left of the caller's deadline a request is not sent: no model could answer in time. */
const DISPATCH_MIN_BUDGET_MS = 2_000;

/**
 * The caller's deadline ran out before the chain could finish: refused before the platform wall, in
 * the words the routes already read as a timeout ("timed out"), so they answer with their own 504.
 */
export class ChainDeadlineError extends Error {
  readonly cause?: unknown;
  constructor(stage: string, cause?: unknown) {
    super(`AI call timed out: the deadline ran out ${stage}`);
    this.name = 'ChainDeadlineError';
    this.cause = cause;
  }
}

type RequestOptions = StructuredOutputOptions['requestOptions'];

/**
 * ONE DEADLINE FOR THE WHOLE CHAIN (BUG-20261003-ai-chain-deadline-not-whole-chain). The caller owns
 * retries when it switched the SDK's off and set its own deadline; that deadline is the whole call's —
 * reading the plan, every model, a fallback, a retry — counted from the moment the call starts, so
 * the chain answers or refuses before the 60 s platform wall instead of being killed by it.
 */
function ownChainDeadline(requestOptions: RequestOptions): number | null {
  return requestOptions?.maxRetries === 0 && typeof requestOptions.timeout === 'number'
    ? performance.now() + requestOptions.timeout
    : null;
}

/**
 * Preparation work (reading the plan, choosing the models) is started only while the deadline lasts
 * and waited for only until it runs out; work that loses the race still has its outcome handled.
 */
async function withinChainDeadline<T>(start: () => Promise<T>, chainDeadline: number | null, stage: string): Promise<T> {
  if (chainDeadline === null) return start();
  const left = chainDeadline - performance.now();
  if (left <= 0) throw new ChainDeadlineError(stage);
  const work = start();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ChainDeadlineError(stage)), left); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Every attempt gets only what is left of the caller's deadline — whole milliseconds, as the SDK requires. */
function requestOptionsForAttempt(requestOptions: RequestOptions, chainDeadline: number | null): RequestOptions {
  return chainDeadline !== null
    ? { ...requestOptions, timeout: Math.max(1, Math.floor(chainDeadline - performance.now())) }
    : requestOptions;
}

async function runWithFallback<TResult>(
  targets: readonly [ModelTarget, ...ModelTarget[]],
  execute: (target: ModelTarget, isSameTargetRetry: boolean) => Promise<TResult>,
  onAttempt: (target: ModelTarget) => void,
  // Only the LAST target's error survives the chain, so without this every earlier
  // failure vanished: a run that reported `401` from the last fallback said nothing
  // about why the PRIMARY model — the one actually chosen for the job — refused. The
  // reported error is the tail of the chain, never its cause.
  onFailure: (report: {
    target: ModelTarget;
    error: unknown;
    disposition: ErrorDisposition;
    attempt: number;
    willTryNext: boolean;
    willRetrySameTarget: boolean;
  }) => void,
  /** When the caller owns retries: the moment its own deadline runs out, on the `performance.now()` clock. */
  retryDeadline: number | null,
  index = 0,
  isSameTargetRetry = false
): Promise<TResult> {
  const target = targets[index] as ModelTarget;
  // A request is not sent with no time left for its answer: the chain refuses before the wall instead.
  if (retryDeadline !== null && retryDeadline - performance.now() < DISPATCH_MIN_BUDGET_MS) {
    throw new ChainDeadlineError('before a model could be asked');
  }
  onAttempt(target);

  try {
    return await execute(target, isSameTargetRetry);
  } catch (error) {
    const disposition = providerAdapters[target.providerId].classifyError(error);
    const hasNext = disposition !== 'terminal' && index < targets.length - 1;
    // A next model inherits what is left of the deadline, not a fresh one — sent while any real time is left.
    const canTryNext = hasNext && (retryDeadline === null || retryDeadline - performance.now() >= DISPATCH_MIN_BUDGET_MS);
    const budgetLeftMs = retryDeadline === null ? 0 : retryDeadline - performance.now() - SAME_TARGET_RETRY_PAUSE_MS;
    const willRetrySameTarget = !hasNext && !isSameTargetRetry
      && disposition === 'retrySameProvider' && budgetLeftMs >= SAME_TARGET_RETRY_MIN_BUDGET_MS;
    onFailure({ target, error, disposition, attempt: index + 1, willTryNext: canTryNext, willRetrySameTarget });
    if (willRetrySameTarget) {
      await new Promise((resolve) => setTimeout(resolve, SAME_TARGET_RETRY_PAUSE_MS));
      // A late timer can eat the budget the check above counted on.
      if (retryDeadline === null || retryDeadline - performance.now() < SAME_TARGET_RETRY_MIN_BUDGET_MS) throw error;
      return runWithFallback(targets, execute, onAttempt, onFailure, retryDeadline, index, true);
    }
    if (canTryNext) return runWithFallback(targets, execute, onAttempt, onFailure, retryDeadline, index + 1);
    // Recovery stopped only because the deadline ran out: said as the timeout it is.
    if (hasNext) throw new ChainDeadlineError('before the next model could be asked', error);
    throw error;
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
  // Counted from here: reading the plan and the opening telemetry spend the same deadline as the models.
  const chainDeadline = ownChainDeadline(options.requestOptions);
  // Объявлено вне try: ветка ошибки обязана дописать ТУ ЖЕ карточку, а не создать
  // вторую. Остаётся null, если падение случилось раньше отметки входа.
  let telemetryEventId: string | null = null;
  let intendedTarget: ModelTarget | null = null;

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
      const userId = options.userId;
      const entitlement = await withinChainDeadline(() => getUserEntitlementServerSide(userId, {
        includeTextPreference: true,
      }), chainDeadline, 'while reading the plan');
      if (!isUsageAdmitted(options.usageAdmission, options.userId, 'ai')) {
        assertAiUsageAvailable(entitlement, now);
      }
      targets = await withinChainDeadline(() => resolveUserTextTargets(entitlement, {
        // Legacy fields remain a fallback for existing user documents.
        providerId: entitlement.preferredText?.providerId ?? entitlement.preferredProviderId,
        modelId: entitlement.preferredText?.modelId ?? entitlement.preferredModelId,
      }, now), chainDeadline, 'while choosing the models');
      consumeSuccessfulAiCall = () => consumeAiUsage(options.userId as string, now);
    }

    // Турникет, отметка на ВХОДЕ: пишется до вызова модели, поэтому уцелеет,
    // даже если функцию убьёт потолок maxDuration. Запись, оставшаяся в состоянии
    // `started`, и есть тот вызов, который не вернулся. Ждём её намеренно —
    // fire-and-forget не успел бы отправиться из умирающего процесса.
    intendedTarget = targets[0];
    // Counted in the deadline but not cut by it: a raced opening that lands late would leave a record
    // stuck at `started` beside the error one (BUG-20261006-ai-call-outlives-the-wall).
    telemetryEventId = await openStructuredTelemetryEvent({
      provider: intendedTarget.providerId.toUpperCase(),
      model: intendedTarget.modelId,
      formatName,
      promptBlueprint,
      logContext,
    });

    const completion = await runWithFallback(
      targets,
      (target) => executeStructuredTarget(target, {
        systemPrompt: promptBlueprint.systemPrompt,
        userMessage: promptBlueprint.userMessage,
        schema,
        formatName,
        requestOptions: requestOptionsForAttempt(options.requestOptions, chainDeadline),
      }),
      (target) => {
        executionState.target = target;
        logger.info(operationName, `Starting structured output call using model: ${target.modelId}`);
      },
      ({ target, error, disposition, attempt, willTryNext, willRetrySameTarget }) => {
        const status = (error as { status?: unknown })?.status;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          operationName,
          `Attempt ${attempt}/${targets.length} failed on ${target.providerId}:${target.modelId}`,
          {
            status: status ?? null,
            disposition,
            willTryNext,
            willRetrySameTarget,
            reason: reason.slice(0, 300),
          }
        );
      },
      chainDeadline
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
        eventId: telemetryEventId,
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
        eventId: telemetryEventId,
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
      eventId: telemetryEventId,
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
    // Цель могла не успеть выбраться — тогда берём намеренную. Иначе открытая
    // карточка зависла бы в `started` при живой, известной ошибке, и «не вернулся»
    // перестало бы отличаться от «упал с ответом».
    const failedTarget = executionState.target ?? intendedTarget;
    if (failedTarget) {
      emitStructuredTelemetryEvent({
        provider: failedTarget.providerId.toUpperCase(),
        model: failedTarget.modelId,
        formatName,
        promptBlueprint,
        logContext,
        eventId: telemetryEventId,
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
