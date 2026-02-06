import {
  buildStructuredTelemetryEvent,
  emitStructuredTelemetryEvent,
} from "@clients/aiTelemetry";
import { buildSimplePromptBlueprint } from "@clients/promptBuilder";

describe("aiTelemetry", () => {
  it("builds structured telemetry event with prompt metadata and hashes", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "sermon_insights",
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
    expect(event.promptName).toBe("sermon_insights");
    expect(event.promptVersion).toBe("v3");
    expect(event.structured).toBe(true);
    expect(event.latencyMs).toBe(1241);
    expect(event.request.systemPrompt.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.request.userMessage.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.response.parsedOutput?.value).toContain("Hope");
  });

  it("does not throw when emitting telemetry in test environment", () => {
    const promptBlueprint = buildSimplePromptBlueprint({
      promptName: "thought",
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
});

