import { act, render, screen } from "@testing-library/react";
import React from "react";

import FullPlanContent from "@/(pages)/(private)/sermons/[id]/plan/FullPlanContent";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "sections.introduction") return "Introduction";
  if (key === "sections.main") return "Main";
  if (key === "sections.conclusion") return "Conclusion";
  if (key === "common.scripture") return "Scripture";
  if (key === "plan.progress.introduction") return "Introduction progress: {progress}% complete";
  if (key === "plan.progress.main") return "Main progress: {progress}% complete";
  if (key === "plan.progress.conclusion") return "Conclusion progress: {progress}% complete";
  return String(options?.defaultValue ?? key);
};

const basePlan = {
  introduction: "Intro text",
  main: "Main text",
  conclusion: "Conclusion text",
};

describe("FullPlanContent", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("marks previous phase as completing when timer phase advances", () => {
    const { container, rerender } = render(
      <FullPlanContent
        sermonTitle="Sermon title"
        sermonVerse="John 3:16"
        combinedPlan={basePlan}
        t={t}
        noContentText="No content"
        isPreachingMode
        timerState={{
          currentPhase: "introduction",
          phaseProgress: 0.25,
          totalProgress: 0.1,
          phaseProgressByPhase: { introduction: 0.25, main: 0, conclusion: 0 },
          timeRemaining: 100,
          isFinished: false,
        }}
      />
    );

    rerender(
      <FullPlanContent
        sermonTitle="Sermon title"
        sermonVerse="John 3:16"
        combinedPlan={basePlan}
        t={t}
        noContentText="No content"
        isPreachingMode
        timerState={{
          currentPhase: "main",
          phaseProgress: 0.1,
          totalProgress: 0.4,
          phaseProgressByPhase: { introduction: 1, main: 0.1, conclusion: 0 },
          timeRemaining: 80,
          isFinished: false,
        }}
      />
    );

    const introOverlay = container.querySelector(".progress-overlay-introduction") as HTMLElement;
    expect(introOverlay).toHaveClass("completing");
    expect(introOverlay.style.animation).toContain("progressFill");
    expect(introOverlay.style.transition).toBe("none");

    act(() => {
      jest.advanceTimersByTime(301);
    });

    expect(introOverlay).not.toHaveClass("completing");
  });

  it("clamps progress values and exposes progressbar aria attributes", () => {
    render(
      <FullPlanContent
        combinedPlan={basePlan}
        t={t}
        noContentText="No content"
        timerState={{
          currentPhase: "conclusion",
          phaseProgress: 0.5,
          totalProgress: 0.7,
          phaseProgressByPhase: { introduction: 1.4, main: -0.25, conclusion: 0.5 },
          timeRemaining: 40,
          isFinished: false,
        }}
      />
    );

    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars[0]).toHaveAttribute("aria-valuenow", "100");
    expect(progressBars[0]).toHaveAttribute("aria-label", "Introduction progress: 100% complete");
    expect(progressBars[1]).toHaveAttribute("aria-valuenow", "0");
    expect(progressBars[1]).toHaveAttribute("aria-label", "Main progress: 0% complete");
    expect(progressBars[2]).toHaveAttribute("aria-valuenow", "50");
    expect(progressBars[2]).toHaveAttribute("aria-label", "Conclusion progress: 50% complete");
  });

  it("renders title and verse in preaching mode without timer", () => {
    render(
      <FullPlanContent
        sermonTitle="Sermon title"
        sermonVerse="John 3:16"
        combinedPlan={basePlan}
        t={t}
        noContentText="No content"
        isPreachingMode
      />
    );

    expect(screen.getByText("Sermon title")).toBeInTheDocument();
    expect(screen.getByText("John 3:16")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
