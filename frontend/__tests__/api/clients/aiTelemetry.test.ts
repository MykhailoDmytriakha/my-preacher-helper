/** @jest-environment node */

jest.mock('server-only', () => ({}), { virtual: true });

import {
  buildStructuredTelemetryEvent,
  buildStructuredTelemetryOpenRecord,
  emitStructuredTelemetryEvent,
  openStructuredTelemetryEvent,
} from "@clients/aiTelemetry.server";
import { buildSimplePromptBlueprint } from "@clients/promptBuilder";

const mockTelemetryDoc = jest.fn();

jest.mock("@/config/firebaseAdminConfig", () => ({
  adminDb: { collection: () => ({ doc: mockTelemetryDoc }) },
  FieldValue: { serverTimestamp: () => "server timestamp" },
}));

describe("aiTelemetry.server", () => {
  it("builds structured telemetry event with prompt metadata and hashes", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon.insights.all",
      promptVersion: "v3",
      expectedLanguage: "ru",
      systemPrompt: "System prompt body",
      userMessage: "User prompt body",
      context: { sermonId: "sermon-1" },
    });

    const event = buildStructuredTelemetryEvent({
      provider: "OPENAI",
      model: "gpt-4o-mini",
      formatName: "sermon_insights",
      promptBlueprint,
      logContext: { requestId: "req-123" },
      latencyMs: 1240.7,
      status: "success",
      parsedOutput: { topics: ["Hope"] },
      rawMessage: [{ type: "text", text: "ok" }],
    });

    expect(event.provider).toBe("OPENAI");
    expect(event.model).toBe("gpt-4o-mini");
    expect(event.correlationId).toBe("req-123");
    expect(event.promptName).toBe("sermon.insights.all");
    expect(event.promptVersion).toBe("v3");
    expect(event.structured).toBe(true);
    expect(event.latencyMs).toBe(1241);
    expect(event.status).toBe("success");
    expect(event.jsonStructureStatus).toBe("success");
    expect(event.qualityReview).toEqual(expect.objectContaining({
      quality: "unreviewed",
      keepAsExample: false,
    }));
    expect(event.request.systemPrompt.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.request.userMessage.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.response.parsedOutput?.value).toContain("Hope");
  });

  it("opens a turnstile record with the input captured and no outcome yet", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon.insights.section_hints",
      promptVersion: "v2",
      expectedLanguage: "ru",
      systemPrompt: "System prompt body",
      userMessage: "Whole sermon text",
      context: { sermonId: "sermon-9" },
    });

    const record = buildStructuredTelemetryOpenRecord({
      provider: "OPENAI",
      model: "gpt-5-mini",
      formatName: "section_hints",
      promptBlueprint,
      logContext: { requestId: "req-7" },
    });

    expect(record.phase).toBe("started");
    expect(record.startedAt).toEqual(expect.any(String));
    expect(record.timestamp).toBe(record.startedAt);
    expect(record.correlationId).toBe("req-7");
    expect(record.promptName).toBe("sermon.insights.section_hints");
    expect(record.promptVersion).toBe("v2");

    // Вход захвачен на ВХОДЕ: у убитого вызова останется то, что его убило.
    expect(record.request.userMessage.value).toContain("Whole sermon text");
    expect(record.request.systemPrompt.hash).toMatch(/^[a-f0-9]{64}$/);

    // Исхода ещё нет — статус ставится только вторым пиком.
    expect(record).not.toHaveProperty("status");
    expect(record).not.toHaveProperty("latencyMs");
    expect(record.language).toEqual({ expected: "ru", detectedOutput: null });
  });

  it("marks a record built in one shot as finished, without an entry stamp", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon.thoughts.transcript_polish",
      systemPrompt: "System",
      userMessage: "User",
    });

    const event = buildStructuredTelemetryEvent({
      provider: "OPENAI",
      model: "gpt-test",
      formatName: "thought",
      promptBlueprint,
      latencyMs: 100,
      status: "success",
      parsedOutput: { ok: true },
    });

    expect(event.phase).toBe("finished");
    expect(event.startedAt).toBeNull();
  });

  it("does not throw when emitting telemetry in test environment", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon.thoughts.transcript_polish",
      systemPrompt: "System",
      userMessage: "User",
    });

    expect(() => {
      emitStructuredTelemetryEvent({
        provider: "GEMINI",
        model: "gemini-2.0-flash",
        formatName: "thought",
        promptBlueprint,
        latencyMs: 42,
        status: "success",
        parsedOutput: { formattedText: "ok" },
      });
    }).not.toThrow();
  });

  it("does not infer English output when parsed output is missing", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon.conspect.point",
      promptVersion: "v3",
      expectedLanguage: "ru",
      systemPrompt: "System prompt",
      userMessage: "User message",
    });

    const event = buildStructuredTelemetryEvent({
      provider: "OPENROUTER",
      model: "openrouter-test-model",
      formatName: "plan_point_content",
      promptBlueprint,
      latencyMs: 120,
      status: "error",
      errorMessage: "429 status code (no body)",
    });

    expect(event.language.expected).toBe("ru");
    expect(event.provider).toBe("OPENROUTER");
    expect(event.language.detectedOutput).toBeNull();
  });
});

describe("structured telemetry persistence", () => {
  const promptBlueprint = buildSimplePromptBlueprint({
    promptName: "test",
    systemPrompt: "System",
    userMessage: "Original user text",
  });
  const request = { provider: "OPENAI", model: "intended", formatName: "test", promptBlueprint };
  let documents: Map<string, Record<string, unknown>>;
  let create: jest.Mock;
  let update: jest.Mock;

  beforeEach(() => {
    jest.replaceProperty(process, "env", {
      ...process.env,
      NODE_ENV: "production",
      FIREBASE_SERVICE_ACCOUNT: "mock only",
    });
    documents = new Map();
    create = jest.fn(async (id: string, data: Record<string, unknown>) => {
      if (documents.has(id)) throw Object.assign(new Error("Already exists"), { code: 6 });
      documents.set(id, data);
    });
    update = jest.fn(async (id: string, data: Record<string, unknown>) => {
      if (!documents.has(id)) throw Object.assign(new Error("Not found"), { code: 5 });
      documents.set(id, { ...documents.get(id), ...data });
    });
    mockTelemetryDoc.mockImplementation((id: string) => ({
      create: (data: Record<string, unknown>) => create(id, data),
      update: (data: Record<string, unknown>) => update(id, data),
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  const settle = (opening: ReturnType<typeof buildStructuredTelemetryOpenRecord>) =>
    emitStructuredTelemetryEvent({
      ...request,
      opening,
      model: "executed",
      status: "error",
      latencyMs: 45_000,
      errorMessage: "timed out",
    });

  it("creates a complete terminal record if its opening is still in flight", async () => {
    const opening = buildStructuredTelemetryOpenRecord(request);
    const persist = create.getMockImplementation()!;
    let finishOpening!: () => void;
    create.mockImplementationOnce(async (id, data) => {
      await new Promise<void>((resolve) => { finishOpening = resolve; });
      await persist(id, data);
    });
    const pendingOpening = openStructuredTelemetryEvent(opening);
    await new Promise<void>((resolve) => setImmediate(resolve));

    try {
      await settle(opening);
      expect(documents.get(opening.eventId)).toMatchObject({
        eventId: opening.eventId,
        correlationId: opening.correlationId,
        timestamp: opening.startedAt,
        phase: "finished",
        model: "executed",
        status: "error",
        request: { userMessage: { value: "Original user text" } },
        response: { errorMessage: "timed out" },
        settledAtServer: "server timestamp",
      });
    } finally {
      finishOpening();
      await pendingOpening;
    }

    expect(documents.size).toBe(1);
    expect(documents.get(opening.eventId)).toMatchObject({ phase: "finished", status: "error" });
  });

  it("updates only the outcome when the opening arrives between the terminal update and create", async () => {
    const opening = buildStructuredTelemetryOpenRecord(request);
    const review = { quality: "good", keepAsExample: true };
    const persist = create.getMockImplementation()!;
    create.mockImplementationOnce(async (id, data) => {
      await persist(id, { ...opening, qualityReview: review });
      await persist(id, data);
    });

    await settle(opening);

    expect(documents.size).toBe(1);
    expect(documents.get(opening.eventId)).toMatchObject({
      phase: "finished",
      status: "error",
      qualityReview: review,
    });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("keeps an opening write failure from failing the caller and can still save the outcome", async () => {
    const opening = buildStructuredTelemetryOpenRecord(request);
    create.mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { code: 14 }));

    await expect(openStructuredTelemetryEvent(opening)).resolves.toBeUndefined();
    await settle(opening);

    expect(documents.size).toBe(1);
    expect(documents.get(opening.eventId)).toMatchObject({ phase: "finished", status: "error" });
  });
});
