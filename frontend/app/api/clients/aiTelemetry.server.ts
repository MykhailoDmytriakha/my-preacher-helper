import { randomUUID, createHash } from "crypto";

import { resolveFirestoreWriteRefusal } from "@/api/errors/firestoreWriteRefusal.server";

import { logger } from "./openAIHelpers";
import { detectDominantLanguage, PromptBlueprint } from "./promptBuilder";

export type StructuredTelemetryStatus = "success" | "refusal" | "error" | "invalid_response";
/**
 * Турникет: запись отмечается на ВХОДЕ (до провайдера) и на ВЫХОДЕ (когда ответ
 * пришёл). Документ, застрявший в `started`, — это вызов, который не вернулся:
 * убит потолком `maxDuration`, упал процесс, оборвалась сеть. Без входной отметки
 * такие вызовы невидимы в принципе, потому что телеметрия пишется ПОСЛЕ ответа —
 * в базе оставались только уцелевшие, и любая доля «сколько не влезает в лимит»
 * была оценкой снизу.
 *
 * Одна запись в двух состояниях, а не две записи: сшивать пары не нужно, а случай
 * «выход без входа» невозможен по построению — обновлять нечего, если не открывали.
 */
export type TelemetryPhase = "started" | "finished";
export type TelemetryProvider = string;
export type TelemetryQuality = "unreviewed" | "good" | "bad" | "needs_review";
export type TelemetryResolutionStatus = "open" | "fixed" | "wont_fix";

export interface CapturedText {
  value: string;
  hash: string;
  length: number;
  truncated: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TelemetryQualityReview {
  quality: TelemetryQuality;
  reviewedAt: string | null;
  reviewedBy: string | null;
  issueTypes: string[];
  notes: string | null;
  expectedOutput: CapturedText | null;
  keepAsExample: boolean;
  resolutionStatus: TelemetryResolutionStatus | null;
  fixedInPromptVersion: string | null;
}

export interface StructuredTelemetryEvent {
  eventId: string;
  correlationId: string;
  timestamp: string;
  /** ISO-время отметки на входе. `null` у записей, созданных сразу завершёнными. */
  startedAt: string | null;
  phase: TelemetryPhase;
  joinPoint: "callWithStructuredOutput";
  provider: TelemetryProvider;
  model: string;
  formatName: string;
  promptName: string;
  promptVersion: string;
  structured: true;
  latencyMs: number;
  /** Backward-compatible transport/schema status. Prefer jsonStructureStatus in new code. */
  status: StructuredTelemetryStatus;
  jsonStructureStatus: StructuredTelemetryStatus;
  qualityReview: TelemetryQualityReview;
  language: {
    expected: string | null;
    detectedOutput: string | null;
  };
  usage: TokenUsage | null;
  request: {
    systemPrompt: CapturedText;
    userMessage: CapturedText;
    context: Record<string, unknown> | null;
    promptBlocks: PromptBlueprint["blocks"];
  };
  response: {
    refusal: string | null;
    parsedOutput: CapturedText | null;
    rawMessage: CapturedText | null;
    errorMessage: string | null;
  };
}

/** Что известно ДО вызова провайдера — этим открывается запись. */
export interface StructuredTelemetryOpenInput {
  /** Намеренная цель: какой провайдер/модель собираемся звать первым. */
  provider: TelemetryProvider;
  model: string;
  formatName: string;
  promptBlueprint: PromptBlueprint;
  logContext?: Record<string, unknown>;
}

export interface StructuredTelemetryEventInput {
  provider: TelemetryProvider;
  model: string;
  formatName: string;
  promptBlueprint: PromptBlueprint;
  logContext?: Record<string, unknown>;
  opening?: StructuredTelemetryOpening | null;
  latencyMs: number;
  status: StructuredTelemetryStatus;
  refusal?: string | null;
  parsedOutput?: unknown;
  rawMessage?: unknown;
  usage?: TokenUsage | null;
  errorMessage?: string | null;
}

const MAX_CAPTURED_TEXT = Number(process.env.AI_TELEMETRY_MAX_CAPTURE_CHARS || 20000);

let hasWarnedMissingFirebaseServiceAccount = false;

function toSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function toSafeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function captureTelemetryText(content: string): CapturedText {
  const normalized = content.replace(/\r\n/g, "\n");
  const truncated = normalized.length > MAX_CAPTURED_TEXT;
  const capturedValue = truncated ? `${normalized.slice(0, MAX_CAPTURED_TEXT)}...[truncated]` : normalized;

  return {
    value: capturedValue,
    hash: toSha256(normalized),
    length: normalized.length,
    truncated,
  };
}

export function createDefaultTelemetryQualityReview(): TelemetryQualityReview {
  return {
    quality: "unreviewed",
    reviewedAt: null,
    reviewedBy: null,
    issueTypes: [],
    notes: null,
    expectedOutput: null,
    keepAsExample: false,
    resolutionStatus: null,
    fixedInPromptVersion: null,
  };
}

function inferCorrelationId(logContext?: Record<string, unknown>): string {
  if (!logContext) return randomUUID();

  const maybeCorrelationId = logContext.correlationId;
  if (typeof maybeCorrelationId === "string" && maybeCorrelationId.trim().length > 0) {
    return maybeCorrelationId;
  }

  const maybeRequestId = logContext.requestId;
  if (typeof maybeRequestId === "string" && maybeRequestId.trim().length > 0) {
    return maybeRequestId;
  }

  const maybeTraceId = logContext.traceId;
  if (typeof maybeTraceId === "string" && maybeTraceId.trim().length > 0) {
    return maybeTraceId;
  }

  return randomUUID();
}

function detectOutputLanguage(parsedOutput: unknown): string | null {
  if (parsedOutput === undefined || parsedOutput === null) return null;
  const outputText = toSafeString(parsedOutput);
  if (!outputText.trim()) return null;
  return detectDominantLanguage(outputText);
}

function buildStructuredTelemetryOutcome(input: StructuredTelemetryEventInput) {
  return {
    phase: "finished" as const,
    provider: input.provider,
    model: input.model,
    latencyMs: Math.round(input.latencyMs),
    status: input.status,
    jsonStructureStatus: input.status,
    usage: input.usage || null,
    language: {
      expected: input.promptBlueprint.expectedLanguage,
      detectedOutput: detectOutputLanguage(input.parsedOutput),
    },
    response: {
      refusal: input.refusal || null,
      parsedOutput: input.parsedOutput === undefined ? null : captureTelemetryText(toSafeString(input.parsedOutput)),
      rawMessage: input.rawMessage === undefined ? null : captureTelemetryText(toSafeString(input.rawMessage)),
      errorMessage: input.errorMessage || null,
    },
  };
}

export function buildStructuredTelemetryEvent(input: StructuredTelemetryEventInput): StructuredTelemetryEvent {
  return {
    ...buildStructuredTelemetryOpenRecord(input),
    ...buildStructuredTelemetryOutcome(input),
    startedAt: null,
  };
}

type StructuredTelemetryOpening = Omit<
  StructuredTelemetryEvent, "latencyMs" | "status" | "jsonStructureStatus" | "usage" | "response"
>;

/**
 * Отметка на входе: всё, что известно до вызова модели. Текст промпта пишется
 * здесь, а не на выходе, — тогда у убитого вызова остаётся ВХОД, по которому
 * видно, что именно не влезло.
 */
export function buildStructuredTelemetryOpenRecord(
  input: StructuredTelemetryOpenInput
): StructuredTelemetryOpening {
  const startedAt = new Date().toISOString();

  return {
    eventId: randomUUID(),
    correlationId: inferCorrelationId(input.logContext),
    timestamp: startedAt,
    startedAt,
    phase: "started",
    joinPoint: "callWithStructuredOutput",
    provider: input.provider,
    model: input.model,
    formatName: input.formatName,
    promptName: input.promptBlueprint.promptName,
    promptVersion: input.promptBlueprint.promptVersion,
    structured: true,
    qualityReview: createDefaultTelemetryQualityReview(),
    language: {
      expected: input.promptBlueprint.expectedLanguage,
      detectedOutput: null,
    },
    request: {
      systemPrompt: captureTelemetryText(input.promptBlueprint.systemPrompt),
      userMessage: captureTelemetryText(input.promptBlueprint.userMessage),
      context: input.promptBlueprint.context || input.logContext || null,
      promptBlocks: input.promptBlueprint.blocks,
    },
  };
}

/** A late opening must never replace a record that already contains the outcome. */
export async function openStructuredTelemetryEvent(record: StructuredTelemetryOpening): Promise<void> {
  if (!canPersistStructuredTelemetry()) return;

  try {
    const { createAiPromptTelemetry } = await import("@/data-engine/aiOperations.server");
    await createAiPromptTelemetry(record.eventId, record);
  } catch (error) {
    if (resolveFirestoreWriteRefusal(error)?.code !== "already-exists") {
      logger.error("StructuredTelemetry", "Failed to open AI telemetry event", error);
    }
  }
}

async function settleStructuredTelemetryEvent(
  opening: StructuredTelemetryOpening,
  input: StructuredTelemetryEventInput
): Promise<void> {
  const outcome = buildStructuredTelemetryOutcome(input);
  const settledAt = new Date().toISOString();

  try {
    const { createAiPromptTelemetry, settleAiPromptTelemetry } = await import("@/data-engine/aiOperations.server");
    const settled = { ...outcome, settledAt };
    try {
      await settleAiPromptTelemetry(opening.eventId, settled);
    } catch (error) {
      if (resolveFirestoreWriteRefusal(error)?.code !== "not-found") throw error;
      // The opening may still be in flight. Either create the finished record now or
      // update just the outcome if the opening won in the meantime, preserving reviews.
      try {
        await createAiPromptTelemetry(opening.eventId, { ...opening, ...settled }, true);
      } catch (createError) {
        if (resolveFirestoreWriteRefusal(createError)?.code !== "already-exists") throw createError;
        await settleAiPromptTelemetry(opening.eventId, settled);
      }
    }
  } catch (error) {
    logger.error("StructuredTelemetry", "Failed to settle AI telemetry event", error);
  }
}

function warnMissingServiceAccountOnce(): void {
  if (hasWarnedMissingFirebaseServiceAccount) return;
  logger.warn(
    "StructuredTelemetry",
    "FIREBASE_SERVICE_ACCOUNT is not configured; AI telemetry persistence is disabled."
  );
  hasWarnedMissingFirebaseServiceAccount = true;
}

function canPersistStructuredTelemetry(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    warnMissingServiceAccountOnce();
    return false;
  }
  return true;
}

async function persistStructuredTelemetryEvent(event: StructuredTelemetryEvent): Promise<void> {
  try {
    const { createAiPromptTelemetry } = await import("@/data-engine/aiOperations.server");
    await createAiPromptTelemetry(event.eventId, event);
  } catch (error) {
    logger.error("StructuredTelemetry", "Failed to persist AI telemetry event", error);
  }
}

export async function emitStructuredTelemetryEvent(input: StructuredTelemetryEventInput): Promise<void> {
  if (!canPersistStructuredTelemetry()) return;

  if (input.opening) return settleStructuredTelemetryEvent(input.opening, input);

  const event = buildStructuredTelemetryEvent(input);
  return persistStructuredTelemetryEvent(event);
}
