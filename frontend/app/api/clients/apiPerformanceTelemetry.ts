import { randomUUID } from "crypto";

import { logger } from "./openAIHelpers";

export type ApiPerformanceStatus = "success" | "error";

export interface ApiPerformancePhase {
  name: string;
  status: ApiPerformanceStatus;
  durationMs: number;
  metadata: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface ApiPerformanceTelemetryEvent {
  eventId: string;
  correlationId: string;
  timestamp: string;
  route: string;
  method: string;
  operation: string;
  status: ApiPerformanceStatus;
  httpStatus: number;
  durationMs: number;
  phases: ApiPerformancePhase[];
  context: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface ApiPerformanceTelemetryEventInput {
  route: string;
  method: string;
  operation: string;
  status: ApiPerformanceStatus;
  httpStatus: number;
  durationMs: number;
  phases?: ApiPerformancePhase[];
  context?: Record<string, unknown> | null;
  correlationId?: string | null;
  errorMessage?: string | null;
}

interface ApiPerformanceTrackerInput {
  route: string;
  method: string;
  operation: string;
  correlationId?: string | null;
  context?: Record<string, unknown> | null;
}

interface ApiPerformanceTrackerEmitInput {
  status: ApiPerformanceStatus;
  httpStatus: number;
  context?: Record<string, unknown> | null;
  errorMessage?: string | null;
  error?: unknown;
}

const PERFORMANCE_COLLECTION = process.env.API_PERFORMANCE_TELEMETRY_COLLECTION || "api_performance_telemetry";

let hasWarnedMissingFirebaseServiceAccount = false;

function roundDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return 0;
  }
  return Math.max(0, Math.round(durationMs));
}

function getErrorMessage(error: unknown, fallback: string | null = null): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[max-depth]";
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeTelemetryValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      const sanitizedValue = sanitizeTelemetryValue(nestedValue, depth + 1);
      if (sanitizedValue !== undefined) {
        sanitized[key] = sanitizedValue;
      }
    });
    return sanitized;
  }
  return String(value);
}

function sanitizeTelemetryRecord(value?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  const sanitized = sanitizeTelemetryValue(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return null;
  }
  const record = sanitized as Record<string, unknown>;
  return Object.keys(record).length > 0 ? record : null;
}

function buildPhase(params: {
  name: string;
  status: ApiPerformanceStatus;
  durationMs: number;
  metadata?: Record<string, unknown> | null;
  error?: unknown;
}): ApiPerformancePhase {
  return {
    name: params.name,
    status: params.status,
    durationMs: roundDurationMs(params.durationMs),
    metadata: sanitizeTelemetryRecord(params.metadata),
    errorMessage: getErrorMessage(params.error),
  };
}

export function buildApiPerformanceTelemetryEvent(
  input: ApiPerformanceTelemetryEventInput
): ApiPerformanceTelemetryEvent {
  return {
    eventId: randomUUID(),
    correlationId: input.correlationId?.trim() || randomUUID(),
    timestamp: new Date().toISOString(),
    route: input.route,
    method: input.method,
    operation: input.operation,
    status: input.status,
    httpStatus: input.httpStatus,
    durationMs: roundDurationMs(input.durationMs),
    phases: input.phases || [],
    context: sanitizeTelemetryRecord(input.context),
    errorMessage: input.errorMessage || null,
  };
}

async function persistApiPerformanceTelemetryEvent(event: ApiPerformanceTelemetryEvent): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    if (!hasWarnedMissingFirebaseServiceAccount) {
      logger.warn(
        "ApiPerformanceTelemetry",
        "FIREBASE_SERVICE_ACCOUNT is not configured; API performance telemetry persistence is disabled."
      );
      hasWarnedMissingFirebaseServiceAccount = true;
    }
    return;
  }

  try {
    const { adminDb, FieldValue } = await import("@/config/firebaseAdminConfig");
    await adminDb.collection(PERFORMANCE_COLLECTION).doc(event.eventId).set({
      ...event,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("ApiPerformanceTelemetry", "Failed to persist API performance telemetry event", error);
  }
}

export function emitApiPerformanceTelemetryEvent(input: ApiPerformanceTelemetryEventInput): ApiPerformanceTelemetryEvent {
  const event = buildApiPerformanceTelemetryEvent(input);
  void persistApiPerformanceTelemetryEvent(event);
  return event;
}

export function createApiPerformanceTracker(input: ApiPerformanceTrackerInput) {
  const startedAt = performance.now();
  const correlationId = input.correlationId?.trim() || randomUUID();
  const phases: ApiPerformancePhase[] = [];
  const context: Record<string, unknown> = { ...(input.context || {}) };
  let emittedEvent: ApiPerformanceTelemetryEvent | null = null;

  return {
    correlationId,

    addContext(nextContext: Record<string, unknown> | null | undefined) {
      if (!nextContext) {
        return;
      }
      Object.assign(context, nextContext);
    },

    async timePhase<T>(
      name: string,
      action: () => Promise<T> | T,
      metadata?: Record<string, unknown> | null
    ): Promise<T> {
      const phaseStartedAt = performance.now();
      try {
        const result = await action();
        phases.push(buildPhase({
          name,
          status: "success",
          durationMs: performance.now() - phaseStartedAt,
          metadata,
        }));
        return result;
      } catch (error) {
        phases.push(buildPhase({
          name,
          status: "error",
          durationMs: performance.now() - phaseStartedAt,
          metadata,
          error,
        }));
        throw error;
      }
    },

    emit(eventInput: ApiPerformanceTrackerEmitInput): ApiPerformanceTelemetryEvent {
      if (emittedEvent) {
        return emittedEvent;
      }

      const errorMessage = eventInput.errorMessage || getErrorMessage(eventInput.error);
      emittedEvent = emitApiPerformanceTelemetryEvent({
        route: input.route,
        method: input.method,
        operation: input.operation,
        correlationId,
        status: eventInput.status,
        httpStatus: eventInput.httpStatus,
        durationMs: performance.now() - startedAt,
        phases: [...phases],
        context: {
          ...context,
          ...(eventInput.context || {}),
        },
        errorMessage,
      });
      return emittedEvent;
    },
  };
}
