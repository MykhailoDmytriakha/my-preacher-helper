import { Maximize2, X } from "lucide-react";
import React from "react";
import { createPortal } from "react-dom";

import { Sermon } from "@/models/models";

import FullPlanContent from "./FullPlanContent";
import PlanCopyButton from "./PlanCopyButton";

import type { CombinedPlan, CopyStatus, PlanTimerState } from "./types";

interface PlanOverlayPortalProps {
  isPlanOverlay: boolean;
  sermon: Sermon;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState: PlanTimerState | null;
  isPreachingMode: boolean;
  noContentText: string;
  copyStatus: CopyStatus;
  planOverlayContentRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => Promise<void>;
  onOpenPlanImmersive: () => void;
  onClosePlanView: () => void;
}

export default function PlanOverlayPortal({
  isPlanOverlay,
  sermon,
  combinedPlan,
  t,
  timerState,
  isPreachingMode,
  noContentText,
  copyStatus,
  planOverlayContentRef,
  onCopy,
  onOpenPlanImmersive,
  onClosePlanView,
}: PlanOverlayPortalProps) {
  if (!isPlanOverlay || typeof document === "undefined" || !sermon) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm" data-testid="sermon-plan-overlay">
      <div className="flex flex-1 justify-center p-4 overflow-y-auto">
        <div className="flex w-full flex-1 max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[calc(100vh-2rem)] min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{sermon.title}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("plan.pageTitle")}</p>
            </div>
            <div className="flex items-center gap-2 h-10">
              <PlanCopyButton status={copyStatus} onCopy={onCopy} t={t} />
              <button
                onClick={onOpenPlanImmersive}
                className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
                title={t("plan.fullscreen")}
              >
                <Maximize2 className="h-7 w-7" />
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
          <div ref={planOverlayContentRef} className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
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
        </div>
      </div>
    </div>,
    document.body
  );
}

