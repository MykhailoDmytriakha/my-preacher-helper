import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";

import usePlanActions from "@/(pages)/(private)/sermons/[id]/plan/usePlanActions";
import { generatePlanPointContent, saveSermonPlan } from "@/(pages)/(private)/sermons/[id]/plan/planApi";

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/(pages)/(private)/sermons/[id]/plan/planApi", () => ({
  generatePlanPointContent: jest.fn(),
  saveSermonPlan: jest.fn(),
}));

describe("usePlanActions", () => {
  const mockToast = toast as jest.Mocked<typeof toast>;
  const mockGeneratePlanPointContent = generatePlanPointContent as jest.MockedFunction<typeof generatePlanPointContent>;
  const mockSaveSermonPlan = saveSermonPlan as jest.MockedFunction<typeof saveSermonPlan>;

  const sermon = {
    id: "sermon-1",
    title: "Sermon",
    verse: "John 3:16",
    date: "2026-02-27",
    userId: "user-1",
    thoughts: [],
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

  it("runs generate flow and triggers onGenerated callback", async () => {
    mockGeneratePlanPointContent.mockResolvedValue({ content: "Generated intro content" });

    const setGeneratingId = jest.fn();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingId,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.generateSermonPointContent("p1");
    });

    expect(setGeneratingId).toHaveBeenNthCalledWith(1, "p1");
    expect(setGeneratingId).toHaveBeenLastCalledWith(null);
    expect(onGenerated).toHaveBeenCalledWith({
      outlinePointId: "p1",
      content: "Generated intro content",
      section: "introduction",
    });
    expect(mockToast.success).toHaveBeenCalledWith("plan.contentGenerated");
  });

  it("shows generate error toast when API call fails", async () => {
    mockGeneratePlanPointContent.mockRejectedValue(new Error("network fail"));

    const setGeneratingId = jest.fn();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingId,
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

  it("shows not-found toast when outline point cannot be resolved", async () => {
    const setGeneratingId = jest.fn();
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
        setGeneratingId,
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
    expect(setGeneratingId).toHaveBeenNthCalledWith(1, "missing-point");
    expect(setGeneratingId).toHaveBeenLastCalledWith(null);
  });

  it("builds deterministic combined section text on save and calls onSaved", async () => {
    mockSaveSermonPlan.mockResolvedValue(undefined);

    const setGeneratingId = jest.fn();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingId,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.saveSermonPoint("p1", "Updated intro 1", "introduction");
    });

    expect(mockSaveSermonPlan).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        outlinePointId: "p1",
        section: "introduction",
        combinedText: "## Intro 1\n\nUpdated intro 1\n\n## Intro 2\n\nOld intro 2",
      })
    );
    expect(mockToast.success).toHaveBeenCalledWith("plan.pointSaved");
    expect(mockToast.success).toHaveBeenCalledWith("Section saved: Introduction");
  });

  it("shows save error toast when API request fails", async () => {
    mockSaveSermonPlan.mockRejectedValue(new Error("save fail"));

    const setGeneratingId = jest.fn();
    const onGenerated = jest.fn();
    const onSaved = jest.fn();

    const { result } = renderHook(() =>
      usePlanActions({
        sermon,
        planStyle: "memory",
        outlineLookup,
        generatedContent: {},
        t,
        setGeneratingId,
        onGenerated,
        onSaved,
      })
    );

    await act(async () => {
      await result.current.saveSermonPoint("p1", "Updated intro 1", "introduction");
    });

    expect(mockToast.error).toHaveBeenCalledWith("errors.failedToSavePoint");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("builds fallback empty plan object when sermon.plan is absent", async () => {
    mockSaveSermonPlan.mockResolvedValue(undefined);
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

    const outlineLookupSinglePoint = {
      ...outlineLookup,
      pointsBySection: {
        introduction: [{ id: "p1", text: "Intro 1" }],
        main: [],
        conclusion: [],
      },
      pointIdsBySection: {
        introduction: ["p1"],
        main: [],
        conclusion: [],
      },
    };

    const { result } = renderHook(() =>
      usePlanActions({
        sermon: sermonWithoutPlan,
        planStyle: "memory",
        outlineLookup: outlineLookupSinglePoint,
        generatedContent: {},
        t,
        setGeneratingId: jest.fn(),
        onGenerated: jest.fn(),
        onSaved,
      })
    );

    await act(async () => {
      await result.current.saveSermonPoint("p1", "Fresh intro", "introduction");
    });

    expect(mockSaveSermonPlan).toHaveBeenCalledWith({
      sermonId: "sermon-1",
      plan: {
        introduction: {
          outline: "## Intro 1\n\nFresh intro",
          outlinePoints: { p1: "Fresh intro" },
        },
        main: { outline: "" },
        conclusion: { outline: "" },
      },
    });
    expect(onSaved).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("plan.pointSaved");
    expect(mockToast.success).not.toHaveBeenCalledWith("Section saved: Introduction");
  });
});
