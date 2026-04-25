import {
  buildApiPerformanceTelemetryEvent,
  createApiPerformanceTracker,
  emitApiPerformanceTelemetryEvent,
} from "@clients/apiPerformanceTelemetry";

describe("apiPerformanceTelemetry", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds endpoint performance events with sanitized context", () => {
    const event = buildApiPerformanceTelemetryEvent({
      route: "/api/thoughts",
      method: "POST",
      operation: "thought_audio_create",
      status: "success",
      httpStatus: 200,
      durationMs: 1234.6,
      correlationId: "corr-1",
      context: {
        sermonId: "sermon-1",
        audioSizeBytes: 2048,
        omitted: undefined,
        nested: {
          keep: true,
          drop: undefined,
        },
        unsupported: () => undefined,
      },
      phases: [
        {
          name: "transcribe_audio",
          status: "success",
          durationMs: 900,
          metadata: { audioType: "audio/webm" },
          errorMessage: null,
        },
      ],
    });

    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.correlationId).toBe("corr-1");
    expect(event.route).toBe("/api/thoughts");
    expect(event.operation).toBe("thought_audio_create");
    expect(event.durationMs).toBe(1235);
    expect(event.context).toEqual({
      sermonId: "sermon-1",
      audioSizeBytes: 2048,
      nested: {
        keep: true,
      },
    });
    expect(event.phases[0]).toEqual(expect.objectContaining({
      name: "transcribe_audio",
      durationMs: 900,
    }));
  });

  it("sanitizes edge-case metadata and clamps invalid durations", () => {
    const event = buildApiPerformanceTelemetryEvent({
      route: "/api/thoughts",
      method: "POST",
      operation: "thought_audio_create",
      status: "error",
      httpStatus: 500,
      durationMs: Number.NaN,
      context: {
        nil: null,
        bool: false,
        infinite: Infinity,
        big: BigInt(7),
        date: new Date("2026-04-25T10:00:00.000Z"),
        list: [1, undefined, () => undefined, Symbol("skip"), { ok: "yes" }],
        deep: { a: { b: { c: { d: { e: { f: "too deep" } } } } } },
        empty: {},
      },
    });

    expect(event.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.durationMs).toBe(0);
    expect(event.phases).toEqual([]);
    expect(event.errorMessage).toBeNull();
    expect(event.context).toEqual({
      nil: null,
      bool: false,
      infinite: "Infinity",
      big: "7",
      date: "2026-04-25T10:00:00.000Z",
      list: [1, { ok: "yes" }],
      deep: { a: { b: { c: { d: { e: "[max-depth]" } } } } },
      empty: {},
    });
  });

  it("tracks phase timings and emits a total duration", async () => {
    jest.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(110)
      .mockReturnValueOnce(260)
      .mockReturnValueOnce(405);

    const tracker = createApiPerformanceTracker({
      route: "/api/thoughts/transcribe",
      method: "POST",
      operation: "thought_audio_transcribe_polish",
      correlationId: "request-1",
      context: { audioPresent: true },
    });

    const result = await tracker.timePhase(
      "transcribe_audio",
      async () => "raw text",
      { audioSizeBytes: 1024 }
    );
    tracker.addContext({ transcriptionLength: result.length });

    const event = tracker.emit({
      status: "success",
      httpStatus: 200,
      context: { polishSuccess: true },
    });

    expect(result).toBe("raw text");
    expect(event.correlationId).toBe("request-1");
    expect(event.durationMs).toBe(305);
    expect(event.phases).toEqual([
      expect.objectContaining({
        name: "transcribe_audio",
        status: "success",
        durationMs: 150,
        metadata: { audioSizeBytes: 1024 },
      }),
    ]);
    expect(event.context).toEqual({
      audioPresent: true,
      transcriptionLength: 8,
      polishSuccess: true,
    });
  });

  it("records failed phases and rethrows the original error", async () => {
    jest.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35)
      .mockReturnValueOnce(40);

    const tracker = createApiPerformanceTracker({
      route: "/api/thoughts",
      method: "POST",
      operation: "thought_audio_create",
    });
    const error = new Error("provider timeout");

    await expect(tracker.timePhase("generate_thought", async () => {
      throw error;
    })).rejects.toThrow("provider timeout");

    const event = tracker.emit({
      status: "error",
      httpStatus: 500,
      error,
    });

    expect(event.status).toBe("error");
    expect(event.errorMessage).toBe("provider timeout");
    expect(event.phases).toEqual([
      expect.objectContaining({
        name: "generate_thought",
        status: "error",
        durationMs: 25,
        errorMessage: "provider timeout",
      }),
    ]);
  });

  it("emits only once and prefers explicit error messages", () => {
    jest.spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35);

    const tracker = createApiPerformanceTracker({
      route: "/api/studies/transcribe",
      method: "POST",
      operation: "study_audio_transcribe_polish",
    });

    tracker.addContext(null);
    const firstEvent = tracker.emit({
      status: "error",
      httpStatus: 500,
      errorMessage: "explicit route error",
      error: new Error("provider error"),
    });
    const secondEvent = tracker.emit({
      status: "success",
      httpStatus: 200,
    });

    expect(secondEvent).toBe(firstEvent);
    expect(firstEvent.durationMs).toBe(25);
    expect(firstEvent.errorMessage).toBe("explicit route error");
  });

  it("does not throw when emitting telemetry in test environment", () => {
    expect(() => {
      emitApiPerformanceTelemetryEvent({
        route: "/api/thoughts",
        method: "POST",
        operation: "thought_audio_create",
        status: "success",
        httpStatus: 200,
        durationMs: 42,
      });
    }).not.toThrow();
  });
});
