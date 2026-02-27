import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { TimerPhase } from "@/types/TimerState";
import { sanitizeMarkdown } from "@/utils/markdownUtils";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

import {
  SECTION_NAMES,
  TRANSLATION_KEYS,
  TRANSLATION_SECTIONS_CONCLUSION,
  TRANSLATION_SECTIONS_MAIN,
} from "./constants";

import type { CombinedPlan, PlanTimerState, SermonSectionKey } from "./types";

const MarkdownRenderer = ({
  markdown,
  section,
}: {
  markdown: string;
  section?: SermonSectionKey;
}) => {
  const sectionClass = section ? `prose-${section}` : "";
  const sectionDivClass = section ? `${section}-section` : "";
  const sanitizedMarkdown = sanitizeMarkdown(markdown);

  return (
    <div className={`prose prose-sm md:prose-base dark:prose-invert max-w-none markdown-content prose-scaled ${sectionClass} ${sectionDivClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {sanitizedMarkdown}
      </ReactMarkdown>
    </div>
  );
};

export interface FullPlanContentProps {
  sermonTitle?: string;
  sermonVerse?: string;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState?: PlanTimerState | null;
  isPreachingMode?: boolean;
  noContentText: string;
}

export default function FullPlanContent({
  sermonTitle,
  sermonVerse,
  combinedPlan,
  t,
  timerState,
  isPreachingMode,
  noContentText,
}: FullPlanContentProps) {
  const checkPhaseCompleted = useCallback((phase: TimerPhase, currentPhase: TimerPhase): boolean => {
    const phaseOrder: TimerPhase[] = ["introduction", "main", "conclusion", "finished"];
    const phaseIndex = phaseOrder.indexOf(phase);
    const currentIndex = phaseOrder.indexOf(currentPhase);
    return phaseIndex < currentIndex;
  }, []);

  const [completingPhase, setCompletingPhase] = useState<TimerPhase | null>(null);
  const prevTimerStateRef = useRef<{
    currentPhase: TimerPhase;
    phaseProgress: number;
    totalProgress: number;
  } | null>(null);

  useEffect(() => {
    if (
      timerState &&
      prevTimerStateRef.current &&
      timerState.currentPhase !== prevTimerStateRef.current.currentPhase &&
      checkPhaseCompleted(prevTimerStateRef.current.currentPhase, timerState.currentPhase)
    ) {
      setCompletingPhase(prevTimerStateRef.current.currentPhase);
      const timer = setTimeout(() => {
        setCompletingPhase(null);
      }, 300);
      return () => clearTimeout(timer);
    }
    prevTimerStateRef.current = timerState || null;
  }, [timerState, checkPhaseCompleted]);

  const getProgressClipPath = useCallback((phase: TimerPhase): string => {
    if (!timerState) return "inset(0 0 100% 0)";

    const byPhase = timerState.phaseProgressByPhase;
    const value = phase === "introduction"
      ? byPhase.introduction
      : phase === "main"
        ? byPhase.main
        : byPhase.conclusion;
    const progressPercent = Math.min(Math.max(value, 0), 1) * 100;
    const hideFromBottom = 100 - progressPercent;
    return `inset(0 0 ${hideFromBottom}% 0)`;
  }, [timerState]);

  const getProgressOverlayClasses = useCallback((phase: TimerPhase): string => {
    const baseClasses = "progress-overlay";

    if (phase === "introduction") {
      return `${baseClasses} progress-overlay-introduction${completingPhase === "introduction" ? " completing" : ""}`;
    }
    if (phase === "main") {
      return `${baseClasses} progress-overlay-main${completingPhase === "main" ? " completing" : ""}`;
    }
    if (phase === "conclusion") {
      return `${baseClasses} progress-overlay-conclusion${completingPhase === "conclusion" ? " completing" : ""}`;
    }
    return baseClasses;
  }, [completingPhase]);

  const getProgressOverlayStyles = useCallback((phase: TimerPhase): React.CSSProperties => {
    if (!timerState) return {};

    const currentPhase = timerState.currentPhase;
    const isCompleted = (
      (phase === "introduction" && ["main", "conclusion", "finished"].includes(currentPhase)) ||
      (phase === "main" && ["conclusion", "finished"].includes(currentPhase)) ||
      (phase === "conclusion" && currentPhase === "finished")
    );

    if (isCompleted) {
      const isCompleting = completingPhase === phase;
      return {
        transition: "none",
        animation: isCompleting ? "progressFill 0s ease-out forwards" : "none",
      };
    }

    return {};
  }, [timerState, completingPhase]);

  const getProgressAriaAttributes = useCallback((phase: TimerPhase) => {
    if (!timerState) return {};

    const byPhase = timerState.phaseProgressByPhase;
    const value = phase === "introduction"
      ? byPhase.introduction
      : phase === "main"
        ? byPhase.main
        : byPhase.conclusion;
    const progressValue = Math.round(Math.min(Math.max(value, 0), 1) * 100);

    let ariaLabel = "";
    switch (phase) {
      case "introduction":
        ariaLabel = t("plan.progress.introduction", { defaultValue: "Introduction progress: {progress}% complete" });
        break;
      case "main":
        ariaLabel = t("plan.progress.main", { defaultValue: "Main part progress: {progress}% complete" });
        break;
      case "conclusion":
        ariaLabel = t("plan.progress.conclusion", { defaultValue: "Conclusion progress: {progress}% complete" });
        break;
    }

    return {
      role: "progressbar",
      "aria-valuenow": progressValue,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-label": ariaLabel.replace("{progress}", progressValue.toString()),
    };
  }, [timerState, t]);

  return (
    <>
      {sermonTitle && isPreachingMode && (
        <div className="mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            {sermonTitle}
          </h1>
        </div>
      )}
      {sermonVerse && (
        <div className={`mb-8 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
          <p className="text-gray-700 dark:text-gray-300 italic text-lg whitespace-pre-line">
            {sermonVerse}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {t(TRANSLATION_KEYS.COMMON.SCRIPTURE)}
          </p>
        </div>
      )}

      <div data-section={SECTION_NAMES.INTRODUCTION} className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.introduction.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} relative overflow-hidden rounded-lg`}>
        {timerState && (
          <div
            className={getProgressOverlayClasses("introduction")}
            style={{
              clipPath: getProgressClipPath("introduction"),
              ...getProgressOverlayStyles("introduction"),
            }}
            {...getProgressAriaAttributes("introduction")}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.introduction.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
          {t(TRANSLATION_KEYS.SECTIONS.INTRODUCTION)}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} prose-introduction`}>
          <MarkdownRenderer
            markdown={combinedPlan.introduction || t(TRANSLATION_KEYS.NO_CONTENT)}
            section={SECTION_NAMES.INTRODUCTION}
          />
        </div>
      </div>

      <div data-section={SECTION_NAMES.MAIN} className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.mainPart.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} relative overflow-hidden rounded-lg`}>
        {timerState && (
          <div
            className={getProgressOverlayClasses("main")}
            style={{
              clipPath: getProgressClipPath("main"),
              ...getProgressOverlayStyles("main"),
            }}
            {...getProgressAriaAttributes("main")}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.mainPart.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
          {t(TRANSLATION_SECTIONS_MAIN)}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.mainPart.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} prose-main`}>
          <MarkdownRenderer
            markdown={combinedPlan.main || noContentText}
            section={SECTION_NAMES.MAIN}
          />
        </div>
      </div>

      <div data-section={SECTION_NAMES.CONCLUSION} className="mb-4 relative overflow-hidden rounded-lg">
        {timerState && (
          <div
            className={getProgressOverlayClasses("conclusion")}
            style={{ clipPath: getProgressClipPath("conclusion") }}
            {...getProgressAriaAttributes("conclusion")}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.conclusion.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
          {t(TRANSLATION_SECTIONS_CONCLUSION)}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.conclusion.border.split(" ")[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} prose-conclusion`}>
          <MarkdownRenderer
            markdown={combinedPlan.conclusion || noContentText}
            section={SECTION_NAMES.CONCLUSION}
          />
        </div>
      </div>
    </>
  );
}

