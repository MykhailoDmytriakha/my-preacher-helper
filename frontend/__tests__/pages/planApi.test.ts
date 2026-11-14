import { generateNotePlanContent, generatePlanPointContent } from "@/(pages)/(private)/sermons/[id]/plan/planApi";
import { apiClient } from '@/utils/apiClient';

jest.mock('@/utils/queryKeys', () => ({ ...jest.requireActual('@/utils/queryKeys'),
  resolveOwnerUid: () => 'owner',
}));
jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({ ...jest.requireActual('@/utils/authenticatedRequest'),
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));

describe("planApi", () => {
  it('includes the selected child in the authenticated request body', async () => {
    const payload = { contentByNodeId: { sub: '- Child' }, missingMaterial: {} };
    jest.mocked(apiClient).mockResolvedValue({ ok: true, json: async () => payload } as Response);
    await generateNotePlanContent({ sermonId: 's', outlinePointId: 'p', targetNodeId: 'sub', style: 'memory', expectedContext: 'context' });
    const options = jest.mocked(apiClient).mock.calls[0][1];
    expect(JSON.parse(options!.body as string)).toEqual({ outlinePointId: 'p', targetNodeId: 'sub', style: 'memory', expectedContext: 'context' });
  });
  it('posts a note proposal request with authentication and validates the returned node map', async () => {
    const payload = { contentByNodeId: { p: '- Cue' }, missingMaterial: {} };
    jest.mocked(apiClient).mockResolvedValue({ ok: true, json: async () => payload } as Response);
    const result = await generateNotePlanContent({ sermonId: 's', outlinePointId: 'p', style: 'memory', expectedContext: 'context' });
    expect(result).toEqual(payload);
    expect(apiClient).toHaveBeenCalledWith('/api/sermons/s/plan', expect.objectContaining({
      method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ outlinePointId: 'p', style: 'memory', expectedContext: 'context' }),
    }));
  });

  it.each([[409, 'contextChanged'], [422, 'sourceUnavailable'], [413, 'sourceTooLarge'], [500, 'generationFailed']])('explains a note-generation HTTP %s refusal', async (status, message) => {
    jest.mocked(apiClient).mockResolvedValue({ ok: false, status } as Response);
    await expect(generateNotePlanContent({ sermonId: 's', outlinePointId: 'p', style: 'memory', expectedContext: 'context' })).rejects.toThrow(String(message));
  });
  const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;
  const attempt = { ownerId: "owner", operationId: "f0e5b194-b526-4747-9068-8e86df3ef302" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("gets content with the operation ID that the plan saved", async () => {
    mockedApiClient.mockResolvedValue({
      ok: true,
      json: async () => ({ content: "Generated text" }),
    } as Response);

    const response = await generatePlanPointContent({
      sermonId: "sermon-1",
      outlinePointId: "point-1",
      style: "memory",
    }, attempt);

    expect(response).toEqual({ content: "Generated text" });
    const [url, options] = mockedApiClient.mock.calls[0];
    expect(options).toEqual({
      cache: "no-store",
      headers: { Authorization: 'Bearer test-token', 'X-AI-Operation-Id': attempt.operationId },
      category: 'ai',
      timeout: 60_000,
    });
    expect(url).toEqual(expect.stringContaining("/api/sermons/sermon-1/plan?"));
    const parsedUrl = new URL(url, "http://localhost");
    expect(parsedUrl.pathname).toBe("/api/sermons/sermon-1/plan");
    expect(parsedUrl.searchParams.get("outlinePointId")).toBe("point-1");
    expect(parsedUrl.searchParams.get("style")).toBe("memory");
  });

  it("checks the saved operation ID without starting a new generation", async () => {
    mockedApiClient.mockResolvedValue({ ok: true, json: async () => ({ content: "Earlier answer" }) } as Response);
    const params = { sermonId: "sermon-1", outlinePointId: "point-1", style: "memory" } as const;

    await expect(generatePlanPointContent(params, { ...attempt, recoverOnly: true })).resolves.toEqual({ content: "Earlier answer" });
    expect(mockedApiClient).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer test-token', 'X-AI-Operation-Id': attempt.operationId, 'X-AI-Recover-Only': '1' },
    }));
  });

  it("throws when generate request returns non-ok status", async () => {
    mockedApiClient.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Generation failed" }),
    } as Response);

    await expect(
      generatePlanPointContent({
        sermonId: "sermon-1",
        outlinePointId: "point-1",
        style: "memory",
      }, attempt)
    ).rejects.toThrow("Failed to generate content: 500");
  });

  // The plan screen says "ran out of time" only if the client keeps the status of a cut call.
  it("carries the status of a bare 504", async () => {
    mockedApiClient.mockResolvedValue({ ok: false, status: 504, json: async (): Promise<unknown> => { throw new SyntaxError('No JSON body'); } } as Response);

    await expect(
      generatePlanPointContent({ sermonId: "sermon-1", outlinePointId: "point-1", style: "memory" }, attempt)
    ).rejects.toMatchObject({ status: 504 });
  });

  it("throws when generate response payload has no content field", async () => {
    mockedApiClient.mockResolvedValue({
      ok: true,
      json: async () => ({ wrong: "shape" }),
    } as Response);

    await expect(
      generatePlanPointContent({
        sermonId: "sermon-1",
        outlinePointId: "point-1",
        style: "memory",
      }, attempt)
    ).rejects.toThrow("Failed to generate content: invalid response payload");
  });
});
