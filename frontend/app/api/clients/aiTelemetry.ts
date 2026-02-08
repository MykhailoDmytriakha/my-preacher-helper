import { randomUUID, createHash } from "crypto";

import { logger } from "./openAIHelpers";
import { detectDominantLanguage, PromptBlueprint } from "./promptBuilder";

export type StructuredTelemetryStatus = "success" | "refusal" | "error" | "invalid_response";

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

export interface StructuredTelemetryEvent {
  eventId: string;
  correlationId: string;
  timestamp: string;
  joinPoint: "callWithStructuredOutput";
  provider: "OPENAI" | "GEMINI";
  model: string;
  formatName: string;
  promptName: string;
  promptVersion: string;
  structured: true;
  latencyMs: number;
  status: StructuredTelemetryStatus;
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

export interface StructuredTelemetryEventInput {
  provider: "OPENAI" | "GEMINI";
  model: string;
  formatName: string;
  promptBlueprint: PromptBlueprint;
  logContext?: Record<string, unknown>;
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

function captureText(content: string): CapturedText {
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
  const outputText = toSafeString(parsedOutput);
  if (!outputText.trim()) return null;
  return detectDominantLanguage(outputText);
}

export function buildStructuredTelemetryEvent(input: StructuredTelemetryEventInput): StructuredTelemetryEvent {
  const eventId = randomUUID();
  const correlationId = inferCorrelationId(input.logContext);
  const systemPrompt = captureText(input.promptBlueprint.systemPrompt);
  const userMessage = captureText(input.promptBlueprint.userMessage);
  const parsedOutput = input.parsedOutput === undefined ? null : captureText(toSafeString(input.parsedOutput));
  const rawMessage = input.rawMessage === undefined ? null : captureText(toSafeString(input.rawMessage));

  return {
    eventId,
    correlationId,
    timestamp: new Date().toISOString(),
    joinPoint: "callWithStructuredOutput",
    provider: input.provider,
    model: input.model,
    formatName: input.formatName,
    promptName: input.promptBlueprint.promptName,
    promptVersion: input.promptBlueprint.promptVersion,
    structured: true,
    latencyMs: Math.round(input.latencyMs),
    status: input.status,
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

async function persistStructuredTelemetryEvent(event: StructuredTelemetryEvent): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    if (!hasWarnedMissingFirebaseServiceAccount) {
      logger.warn(
        "StructuredTelemetry",
        "FIREBASE_SERVICE_ACCOUNT is not configured; AI telemetry persistence is disabled."
      );
      hasWarnedMissingFirebaseServiceAccount = true;
    }
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
  const event = buildStructuredTelemetryEvent(input);
  void persistStructuredTelemetryEvent(event);
}

