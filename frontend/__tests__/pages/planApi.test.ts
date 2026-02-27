import { generatePlanPointContent, saveSermonPlan } from "@/(pages)/(private)/sermons/[id]/plan/planApi";
import type { Plan } from "@/models/models";

describe("planApi", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("maps generate response payload to content string", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ content: "Generated text" }),
    });

    const response = await generatePlanPointContent({
      sermonId: "sermon-1",
      outlinePointId: "point-1",
      style: "memory",
    });

    expect(response).toEqual({ content: "Generated text" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sermons/sermon-1/plan?outlinePointId=point-1&style=memory"
    );
  });

  it("throws when generate request returns non-ok status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(
      generatePlanPointContent({
        sermonId: "sermon-1",
        outlinePointId: "point-1",
        style: "memory",
      })
    ).rejects.toThrow("Failed to generate content: 500");
  });

  it("throws when generate response payload has no content field", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ wrong: "shape" }),
    });

    await expect(
      generatePlanPointContent({
        sermonId: "sermon-1",
        outlinePointId: "point-1",
        style: "memory",
      })
    ).rejects.toThrow("Failed to generate content: invalid response payload");
  });

  it("sends PUT request with serialized plan payload", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
    });

    const plan: Plan = {
      introduction: { outline: "Intro", outlinePoints: { p1: "A" } },
      main: { outline: "Main", outlinePoints: { p2: "B" } },
      conclusion: { outline: "Conclusion", outlinePoints: { p3: "C" } },
    };

    await saveSermonPlan({
      sermonId: "sermon-1",
      plan,
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/sermons/sermon-1/plan", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(plan),
    });
  });

  it("throws when save request returns non-ok status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
    });

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
