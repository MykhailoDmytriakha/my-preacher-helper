import React from "react";

import FloatingTextScaleControls from "@/components/FloatingTextScaleControls";
import Breadcrumbs from "@/components/navigation/Breadcrumbs";
import PreachingTimer from "@/components/PreachingTimer";
import { Sermon } from "@/models/models";

import FullPlanContent from "./FullPlanContent";
import PlanMarkdownGlobalStyles from "./PlanMarkdownGlobalStyles";

import type { CombinedPlan, PlanTimerState, PlanViewMode } from "./types";

interface PlanPreachingViewProps {
  sermon: Sermon;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState: PlanTimerState | null;
  isPlanPreaching: boolean;
  planViewMode: PlanViewMode | null;
  noContentText: string;
  preachingDuration: number | null;
  onTimerStateChange: (timerState: PlanTimerState) => void;
  onTimerFinished: () => void;
  onSetDuration: (durationSeconds: number) => void;
}

export default function PlanPreachingView({
  sermon,
  combinedPlan,
  t,
  timerState,
  isPlanPreaching,
  planViewMode,
  noContentText,
  preachingDuration,
  onTimerStateChange,
  onTimerFinished,
  onSetDuration,
}: PlanPreachingViewProps) {
  return (
    <>
      <PlanMarkdownGlobalStyles variant="preaching" />
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <div className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
          <PreachingTimer
            initialDuration={preachingDuration !== null ? preachingDuration : 0}
            className="border-0 shadow-none"
            onTimerStateChange={onTimerStateChange}
            onTimerFinished={onTimerFinished}
            onSetDuration={onSetDuration}
            exitFallbackPath={sermon?.id ? `/sermons/${sermon.id}` : undefined}
          />
        </div>

        <FloatingTextScaleControls />

        {planViewMode === "preaching" && (
          <main className="flex-1 overflow-y-auto pt-[115px] lg:pt-[65px]">
            <div className="preaching-content px-4 sm:px-6 pt-0 pb-8">
              <div className="mb-4 mt-0 lg:-mt-1">
                <Breadcrumbs forceShow={true} />
              </div>
              <FullPlanContent
                sermonTitle={sermon.title}
                sermonVerse={sermon.verse}
                combinedPlan={combinedPlan}
                t={t}
                timerState={timerState}
                isPreachingMode={isPlanPreaching}
                noContentText={noContentText}
              />
            </div>
          </main>
        )}
      </div>
    </>
  );
}

