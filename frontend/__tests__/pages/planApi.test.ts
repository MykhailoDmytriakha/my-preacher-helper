import { generateNotePlanContent, generatePlanPointContent, saveSermonPlan } from "@/(pages)/(private)/sermons/[id]/plan/planApi";
import { apiClient } from '@/utils/apiClient';
import type { Plan } from "@/models/models";

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("maps generate response payload to content string", async () => {
    mockedApiClient.mockResolvedValue({
      ok: true,
      json: async () => ({ content: "Generated text" }),
    } as Response);

    const response = await generatePlanPointContent({
      sermonId: "sermon-1",
      outlinePointId: "point-1",
      style: "memory",
    });

    expect(response).toEqual({ content: "Generated text" });
    const [url, options] = mockedApiClient.mock.calls[0];
    expect(options).toEqual({
      cache: "no-store",
      headers: { Authorization: 'Bearer test-token' },
      category: 'ai',
    });
    expect(url).toEqual(expect.stringContaining("/api/sermons/sermon-1/plan?"));
    const parsedUrl = new URL(url, "http://localhost");
    expect(parsedUrl.pathname).toBe("/api/sermons/sermon-1/plan");
    expect(parsedUrl.searchParams.get("outlinePointId")).toBe("point-1");
    expect(parsedUrl.searchParams.get("style")).toBe("memory");
    expect(parsedUrl.searchParams.get("requestId")).toEqual(expect.any(String));
  });

  it("throws when generate request returns non-ok status", async () => {
    mockedApiClient.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(
      generatePlanPointContent({
        sermonId: "sermon-1",
        outlinePointId: "point-1",
        style: "memory",
      })
    ).rejects.toThrow("Failed to generate content: 500");
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
      })
    ).rejects.toThrow("Failed to generate content: invalid response payload");
  });

  it("sends PUT request with serialized plan payload", async () => {
    mockedApiClient.mockResolvedValue({
      ok: true,
    } as Response);

    const plan: Plan = {
      introduction: { outline: "Intro", outlinePoints: { p1: "A" } },
      main: { outline: "Main", outlinePoints: { p2: "B" } },
      conclusion: { outline: "Conclusion", outlinePoints: { p3: "C" } },
    };

    await saveSermonPlan({
      sermonId: "sermon-1",
      plan,
    });

    expect(mockedApiClient).toHaveBeenCalledWith("/api/sermons/sermon-1/plan", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(plan),
    });
  });

  it("throws when save request returns non-ok status", async () => {
    mockedApiClient.mockResolvedValue({
      ok: false,
      status: 400,
    } as Response);

    await expect(
      saveSermonPlan({
        sermonId: "sermon-1",
        plan: {
          introduction: { outline: "" },
          main: { outline: "" },
          conclusion: { outline: "" },
        },
      })
    ).rejects.toThrow("Failed to save plan: 400");
  });
});
