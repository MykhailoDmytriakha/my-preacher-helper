import { Minimize2, X } from "lucide-react";
import React from "react";

import { Sermon } from "@/models/models";

import FullPlanContent from "./FullPlanContent";
import PlanCopyButton from "./PlanCopyButton";
import PlanMarkdownGlobalStyles from "./PlanMarkdownGlobalStyles";

import type { CombinedPlan, CopyStatus, PlanTimerState } from "./types";

interface PlanImmersiveViewProps {
  sermon: Sermon;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState: PlanTimerState | null;
  isPreachingMode: boolean;
  noContentText: string;
  copyStatus: CopyStatus;
  immersiveContentRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => Promise<void>;
  onOpenPlanOverlay: () => void;
  onClosePlanView: () => void;
}

export default function PlanImmersiveView({
  sermon,
  combinedPlan,
  t,
  timerState,
  isPreachingMode,
  noContentText,
  copyStatus,
  immersiveContentRef,
  onCopy,
  onOpenPlanOverlay,
  onClosePlanView,
}: PlanImmersiveViewProps) {
  return (
    <>
      <PlanMarkdownGlobalStyles variant="immersive" />
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900" data-testid="sermon-plan-immersive-view">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-4">
          <div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{sermon.title}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("plan.pageTitle")}</p>
          </div>
          <div className="flex items-center gap-2 h-10">
            <PlanCopyButton status={copyStatus} onCopy={onCopy} t={t} />
            <button
              onClick={onOpenPlanOverlay}
              className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
              title={t("plan.exitFullscreen")}
            >
              <Minimize2 className="h-7 w-7" />
            </button>
            <button
              onClick={onClosePlanView}
              className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
              title={t("actions.close")}
            >
              <X className="h-7 w-7" />
            </button>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto">
          <div ref={immersiveContentRef} className="max-w-5xl mx-auto px-6 py-8">
            <FullPlanContent
              sermonTitle={sermon.title}
              sermonVerse={sermon.verse}
              combinedPlan={combinedPlan}
              t={t}
              timerState={timerState}
              isPreachingMode={isPreachingMode}
              noContentText={noContentText}
            />
          </div>
        </main>
      </div>
    </>
  );
}

