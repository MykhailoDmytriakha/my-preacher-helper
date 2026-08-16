import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";

import usePlanActions from "@/(pages)/(private)/sermons/[id]/plan/usePlanActions";
import { generatePlanPointContent } from "@/(pages)/(private)/sermons/[id]/plan/planApi";
import { savePlanTextViaClient } from "@/services/sermons.client";
import { UsageCapReachedError } from "@/services/usageLimits";

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

/**
 * THE REAL MODULE, WITH ONLY THE WRITE REPLACED.
 *
 * Listing mocked exports by hand meant every new helper the screens started using arrived here
 * as `undefined` — and `undefined` inside a catch block turns a handled refusal into an
 * unhandled throw, so the tests failed for a reason that had nothing to do with the behaviour
 * under test. Spreading the actual module keeps the seam exactly one function wide.
 */
jest.mock("@/services/sermons.client", () => ({
  ...jest.requireActual("@/services/sermons.client"),
  savePlanTextViaClient: jest.fn(),
}));

jest.mock("@/(pages)/(private)/sermons/[id]/plan/planApi", () => ({
  generatePlanPointContent: jest.fn(),
}));

describe("usePlanActions", () => {
  const mockToast = toast as jest.Mocked<typeof toast>;
  const mockGeneratePlanPointContent = generatePlanPointContent as jest.MockedFunction<typeof generatePlanPointContent>;
  const mockSavePlanText = savePlanTextViaClient as jest.MockedFunction<typeof savePlanTextViaClient>;
  type GeneratingIds = Record<string, boolean>;

  const sermon = {
    id: "sermon-1",
    title: "Sermon",
    verse: "John 3:16",
    date: "2026-02-27",
    userId: "user-1",
    /**
     * THOUGHTS THAT ACTUALLY SIT ON THE POINTS.
     *
     * This fixture used to be `thoughts: []` — a shape the real server answers with
     * 400 "no thoughts associated with this outline point". The generate tests were
     * green while describing a sermon that could never generate anything; only the
     * client-side guard added later made the mismatch visible.
     */
    thoughts: [
      { id: "th1", text: "Thought on p1", tags: [], date: "2026-02-27", outlinePointId: "p1" },
      { id: "th2", text: "Thought on p2", tags: [], date: "2026-02-27", outlinePointId: "p2" },
    ],
    outline: {
      introduction: [
        { id: "p1", text: "Intro 1" },
        { id: "p2", text: "Intro 2" },
      ],
      main: [],
      conclusion: [],
    },
    plan: {
      introduction: {
        outline: "",
        outlinePoints: {
          p1: "Old intro 1",
          p2: "Old intro 2",
        },
      },
      main: { outline: "" },
      conclusion: { outline: "" },
    },
  };

  const outlineLookup = {
    byPointId: {
      p1: { section: "introduction" as const, outlinePoint: { id: "p1", text: "Intro 1" } },
      p2: { section: "introduction" as const, outlinePoint: { id: "p2", text: "Intro 2" } },
    },
    pointIdsBySection: {
      introduction: ["p1", "p2"],
      main: [],
      conclusion: [],
    },
    pointsBySection: {
      introduction: [
        { id: "p1", text: "Intro 1" },
        { id: "p2", text: "Intro 2" },
      ],
      main: [],
      conclusion: [],
    },
  };

  const t = (key: string, options?: Record<string, unknown>) => {
    if (key === "sections.introduction") return "Introduction";
    if (key === "plan.sectionSaved") return `Section saved: ${options?.section as string}`;
    return key;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createGeneratingIdsHarness(initial: GeneratingIds = {}) {
    let state = initial;
    const states: GeneratingIds[] = [];
    const setGeneratingIds = jest.fn((update: GeneratingIds | ((prev: GeneratingIds) => GeneratingIds)) => {
      state = typeof update === "function" ? update(state) : update;
      states.push(state);
    });

    return {
      setGeneratingIds,
      getState: () => state,
      getStates: () => states,
    };
  }

  it("runs generate flow and triggers onGenerated callback", async () => {
    mockGeneratePlanPointContent.mockResolvedValue({ content: "Generated intro content" });

    const { setGeneratingIds, getStates } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.generateSermonPointContent("p1");
    });

    expect(getStates()).toEqual([{ p1: true }, {}]);
    expect(onGenerated).toHaveBeenCalledWith({
      outlinePointId: "p1",
      content: "Generated intro content",
      section: "introduction",
    });
    expect(mockToast.success).toHaveBeenCalledWith("plan.contentGenerated");
  });

  it("keeps parallel generate flows independent by point id", async () => {
    const deferredByPoint = new Map<string, {
      resolve: (value: { content: string }) => void;
      promise: Promise<{ content: string }>;
    }>();
    mockGeneratePlanPointContent.mockImplementation(({ outlinePointId }) => {
      let resolve!: (value: { content: string }) => void;
      const promise = new Promise<{ content: string }>((res) => {
        resolve = res;
      });
      deferredByPoint.set(outlinePointId, { resolve, promise });
      return promise;
    });

    const { setGeneratingIds, getState } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    let firstGenerate!: Promise<void>;
    let secondGenerate!: Promise<void>;
    await act(async () => {
      firstGenerate = result.current.generateSermonPointContent("p1");
      secondGenerate = result.current.generateSermonPointContent("p2");
    });

    expect(getState()).toEqual({ p1: true, p2: true });

    await act(async () => {
      deferredByPoint.get("p1")?.resolve({ content: "Generated p1" });
      await firstGenerate;
    });

    expect(getState()).toEqual({ p2: true });

    await act(async () => {
      deferredByPoint.get("p2")?.resolve({ content: "Generated p2" });
      await secondGenerate;
    });

    expect(getState()).toEqual({});
    expect(onGenerated).toHaveBeenCalledWith({
      outlinePointId: "p1",
      content: "Generated p1",
      section: "introduction",
    });
    expect(onGenerated).toHaveBeenCalledWith({
      outlinePointId: "p2",
      content: "Generated p2",
      section: "introduction",
    });
  });

  it("shows generate error toast when API call fails", async () => {
    mockGeneratePlanPointContent.mockRejectedValue(new Error("network fail"));

    const { setGeneratingIds } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.generateSermonPointContent("p1");
    });

    expect(mockToast.error).toHaveBeenCalledWith("errors.failedToGenerateContent");
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("lets the global handler own usage-cap errors", async () => {
    mockGeneratePlanPointContent.mockRejectedValue(new UsageCapReachedError(
      "ai",
      110,
      100,
      110,
      "2026-08-01T00:00:00.000Z"
    ));

    const { setGeneratingIds, getState } = createGeneratingIdsHarness();
    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated: jest.fn(),
        onSaved: jest.fn(),
      })
    );

    await act(async () => {
      await result.current.generateSermonPointContent("p1");
    });

    expect(mockToast.error).not.toHaveBeenCalledWith("errors.failedToGenerateContent");
    expect(getState()).toEqual({});
  });

  it("shows not-found toast when outline point cannot be resolved", async () => {
    const { setGeneratingIds, getStates } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup: {
          ...outlineLookup,
          byPointId: {},
        },
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.generateSermonPointContent("missing-point");
    });

    expect(mockToast.error).toHaveBeenCalledWith("errors.outlinePointNotFound");
    expect(mockGeneratePlanPointContent).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
    expect(getStates()).toEqual([{ "missing-point": true }, {}]);
  });

  /**
   * AN EMPTY POINT IS NOT A BROKEN ONE.
   *
   * The server refuses a point with no thoughts (400), which used to reach the screen
   * as the generic "generation failed" — the wrong story on a plan being written by
   * hand. The hook answers first: an informational message, no request, no AI spent.
   */
  it("explains instead of failing when the point has no thoughts to generate from", async () => {
    const { setGeneratingIds, getStates } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon: { ...sermon, thoughts: [] } as typeof sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.generateSermonPointContent("p1");
    });

    expect(mockToast.info).toHaveBeenCalledWith("plan.noThoughtsToGenerate");
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockGeneratePlanPointContent).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
    // The spinner still clears — an early return must not leave the button spinning.
    expect(getStates()).toEqual([{ p1: true }, {}]);
  });

  it("writes the point's cells as text and calls onSaved", async () => {
    mockSavePlanText.mockResolvedValue(undefined);

    const { setGeneratingIds } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.saveSermonPoint("p1", { p1: "Updated intro 1" }, "introduction");
    });

    // The text goes out as node keys; the document is assembled when it is READ, so no
    // section markdown is built here any more and none travels to storage.
    expect(mockSavePlanText).toHaveBeenCalledWith(
      "sermon-1",
      { p1: "Updated intro 1" },
      [],
      expect.objectContaining({ userId: "user-1" })
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        outlinePointId: "p1",
        section: "introduction",
        // What was actually sent travels back, so the screen can tell whether the text on
        // it still matches — a cell typed into mid-flight must NOT be marked saved.
        sentText: { p1: "Updated intro 1" },
      })
    );
    expect(mockToast.success).toHaveBeenCalledWith("plan.pointSaved");
  });

  it("shows save error toast when API request fails", async () => {
    mockSavePlanText.mockRejectedValue(new Error("save fail"));

    const { setGeneratingIds } = createGeneratingIdsHarness();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.saveSermonPoint("p1", { p1: "Updated intro 1" }, "introduction");
    });

    expect(mockToast.error).toHaveBeenCalledWith("errors.failedToSavePoint");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("touches only the edited node, even when the sermon has no stored plan", async () => {
    mockSavePlanText.mockResolvedValue(undefined);
    const onSaved = jest.fn();

    const sermonWithoutPlan = {
      ...sermon,
      plan: undefined,
      outline: {
        introduction: [{ id: "p1", text: "Intro 1" }],
        main: [],
        conclusion: [],
      },
    };

    const { result } = renderHook(() =>
      usePlanActions({
        sermon: sermonWithoutPlan,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingIds: createGeneratingIdsHarness().setGeneratingIds,
        onGenerated: jest.fn(),
        onSaved,
      })
    );

    await act(async () => {
      await result.current.saveSermonPoint("p1", { p1: "Fresh intro" }, "introduction");
    });

    /**
     * ONLY the edited node travels. The old shape rebuilt the whole section — its markdown
     * and every other point's text — from this screen's copy, which is how saving the
     * introduction could blank what another device had written into it.
     */
    expect(mockSavePlanText).toHaveBeenCalledWith(
      "sermon-1",
      { p1: "Fresh intro" },
      [],
      expect.objectContaining({ userId: "user-1" })
    );
    expect(onSaved).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("plan.pointSaved");
  });
});
