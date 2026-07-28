import { randomUUID, createHash } from "crypto";

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
  /**
   * Идентификатор записи, открытой на входе. Есть — дописываем ЕЁ (та же карточка,
   * второй пик). Нет — запись создаётся сразу завершённой, как было до турникета.
   */
  eventId?: string | null;
  latencyMs: number;
  status: StructuredTelemetryStatus;
  refusal?: string | null;
  parsedOutput?: unknown;
  rawMessage?: unknown;
  usage?: TokenUsage | null;
  errorMessage?: string | null;
}

const TELEMETRY_COLLECTION = process.env.AI_TELEMETRY_COLLECTION || "ai_prompt_telemetry";
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

export function buildStructuredTelemetryEvent(input: StructuredTelemetryEventInput): StructuredTelemetryEvent {
  const eventId = randomUUID();
  const correlationId = inferCorrelationId(input.logContext);
  const systemPrompt = captureTelemetryText(input.promptBlueprint.systemPrompt);
  const userMessage = captureTelemetryText(input.promptBlueprint.userMessage);
  const parsedOutput = input.parsedOutput === undefined ? null : captureTelemetryText(toSafeString(input.parsedOutput));
  const rawMessage = input.rawMessage === undefined ? null : captureTelemetryText(toSafeString(input.rawMessage));

  return {
    eventId,
    correlationId,
    timestamp: new Date().toISOString(),
    startedAt: null,
    phase: "finished",
    joinPoint: "callWithStructuredOutput",
    provider: input.provider,
    model: input.model,
    formatName: input.formatName,
    promptName: input.promptBlueprint.promptName,
    promptVersion: input.promptBlueprint.promptVersion,
    structured: true,
    latencyMs: Math.round(input.latencyMs),
    status: input.status,
    jsonStructureStatus: input.status,
    qualityReview: createDefaultTelemetryQualityReview(),
    language: {
      expected: input.promptBlueprint.expectedLanguage,
      detectedOutput: detectOutputLanguage(input.parsedOutput),
    },
    usage: input.usage || null,
    request: {
      systemPrompt,
      userMessage,
      context: input.promptBlueprint.context || input.logContext || null,
      promptBlocks: input.promptBlueprint.blocks,
    },
    response: {
      refusal: input.refusal || null,
      parsedOutput,
      rawMessage,
      errorMessage: input.errorMessage || null,
    },
  };
}

/**
 * Отметка на входе: всё, что известно до вызова модели. Текст промпта пишется
 * здесь, а не на выходе, — тогда у убитого вызова остаётся ВХОД, по которому
 * видно, что именно не влезло.
 */
export function buildStructuredTelemetryOpenRecord(
  input: StructuredTelemetryOpenInput
): Omit<StructuredTelemetryEvent, "latencyMs" | "status" | "jsonStructureStatus" | "usage" | "response"> {
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

/**
 * Открывает запись и возвращает её id. `null` означает «отметить вход не удалось» —
 * и тогда вызов всё равно идёт дальше: измерение не имеет права ломать работу
 * человека, а запись просто создастся на выходе, как до турникета.
 */
export async function openStructuredTelemetryEvent(
  input: StructuredTelemetryOpenInput
): Promise<string | null> {
  if (process.env.NODE_ENV === "test") return null;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    warnMissingServiceAccountOnce();
    return null;
  }

  const record = buildStructuredTelemetryOpenRecord(input);

  try {
    const { adminDb, FieldValue } = await import("@/config/firebaseAdminConfig");
    await adminDb.collection(TELEMETRY_COLLECTION).doc(record.eventId).set({
      ...record,
      createdAt: FieldValue.serverTimestamp(),
    });
    return record.eventId;
  } catch (error) {
    logger.error("StructuredTelemetry", "Failed to open AI telemetry event", error);
    return null;
  }
}

/** Отметка на выходе: дописывается в ту же карточку, не создавая вторую. */
async function settleStructuredTelemetryEvent(
  eventId: string,
  input: StructuredTelemetryEventInput
): Promise<void> {
  const parsedOutput = input.parsedOutput === undefined ? null : captureTelemetryText(toSafeString(input.parsedOutput));
  const rawMessage = input.rawMessage === undefined ? null : captureTelemetryText(toSafeString(input.rawMessage));

  try {
    const { adminDb, FieldValue } = await import("@/config/firebaseAdminConfig");
    await adminDb.collection(TELEMETRY_COLLECTION).doc(eventId).set(
      {
        phase: "finished" satisfies TelemetryPhase,
        settledAt: new Date().toISOString(),
        // Провайдер и модель могли поменяться относительно намеренных: сработал fallback.
        provider: input.provider,
        model: input.model,
        latencyMs: Math.round(input.latencyMs),
        status: input.status,
        jsonStructureStatus: input.status,
        usage: input.usage || null,
        language: { detectedOutput: detectOutputLanguage(input.parsedOutput) },
        response: {
          refusal: input.refusal || null,
          parsedOutput,
          rawMessage,
          errorMessage: input.errorMessage || null,
        },
        settledAtServer: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
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

async function persistStructuredTelemetryEvent(event: StructuredTelemetryEvent): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    warnMissingServiceAccountOnce();
    return;
  }

  try {
    const { adminDb, FieldValue } = await import("@/config/firebaseAdminConfig");
    await adminDb.collection(TELEMETRY_COLLECTION).doc(event.eventId).set({
      ...event,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("StructuredTelemetry", "Failed to persist AI telemetry event", error);
  }
}

export function emitStructuredTelemetryEvent(input: StructuredTelemetryEventInput): void {
  if (process.env.NODE_ENV === "test") return;

  // Вход отмечен — дописываем ТУ ЖЕ карточку. Иначе поведение как до турникета:
  // запись создаётся сразу завершённой.
  if (input.eventId) {
    void settleStructuredTelemetryEvent(input.eventId, input);
    return;
  }

  const event = buildStructuredTelemetryEvent(input);
  void persistStructuredTelemetryEvent(event);
}
