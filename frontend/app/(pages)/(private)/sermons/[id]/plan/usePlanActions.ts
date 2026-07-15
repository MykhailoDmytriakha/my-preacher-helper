import { useCallback } from "react";
import { toast } from "sonner";

import { PlanStyle } from "@/api/clients/openAI.client";
import { Sermon, Plan } from "@/models/models";
import { isUsageCapReachedError } from "@/services/usageLimits";
import { debugLog } from "@/utils/debugMode";

import { buildSectionOutlineMarkdown } from "./buildSectionOutlineMarkdown";
import { generatePlanPointContent, saveSermonPlan } from "./planApi";
import { getPointFromLookup, getPointSectionFromLookup } from "./planOutlineLookup";

import type { PlanOutlineLookup } from "./planOutlineLookup";
import type { SermonSectionKey } from "./types";

interface UsePlanActionsParams {
  sermon: Sermon | null;
  planStyle: PlanStyle;
  outlineLookup: PlanOutlineLookup;
  generatedContent: Record<string, string>;
  t: (key: string, options?: Record<string, unknown>) => string;
  setGeneratingIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onGenerated: (params: {
    outlinePointId: string;
    content: string;
    section: SermonSectionKey;
  }) => void;
  onSaved: (params: {
    outlinePointId: string;
    section: SermonSectionKey;
    combinedText: string;
    updatedPlan: Plan;
  }) => Promise<void> | void;
  onAiSuccess?: () => Promise<void> | void;
  aiBlocked?: boolean;
}

export default function usePlanActions({
  sermon,
  planStyle,
  outlineLookup,
  generatedContent,
  t,
  setGeneratingIds,
  onGenerated,
  onSaved,
  onAiSuccess,
  aiBlocked = false,
}: UsePlanActionsParams) {
  const generateSermonPointContent = useCallback(async (outlinePointId: string) => {
    if (aiBlocked || !sermon) return;

    setGeneratingIds((prev) => ({
      ...prev,
      [outlinePointId]: true,
    }));

    try {
      const outlinePoint = getPointFromLookup(outlineLookup, outlinePointId);
      const section = getPointSectionFromLookup(outlineLookup, outlinePointId);

      if (!outlinePoint || !section) {
        toast.error(t("errors.outlinePointNotFound"));
        return;
      }

      const { content } = await generatePlanPointContent({
        sermonId: sermon.id,
        outlinePointId,
        style: planStyle,
      });

      onGenerated({
        outlinePointId: outlinePoint.id,
        content,
        section,
      });
      await onAiSuccess?.();

      toast.success(t("plan.contentGenerated"));
    } catch (error) {
      debugLog("Plan generate failed", { sermonId: sermon.id, outlinePointId, error });
      if (isUsageCapReachedError(error)) return;
      toast.error(t("errors.failedToGenerateContent"));
    } finally {
      setGeneratingIds((prev) => {
        const { [outlinePointId]: _finishedPoint, ...next } = prev;
        return next;
      });
    }
  }, [aiBlocked, onAiSuccess, onGenerated, outlineLookup, planStyle, sermon, setGeneratingIds, t]);

  const saveSermonPoint = useCallback(async (
    outlinePointId: string,
    content: string,
    section: SermonSectionKey
  ) => {
    if (!sermon) return;

    try {
      const currentPlan: Plan = sermon.plan || {
        introduction: { outline: "" },
        main: { outline: "" },
        conclusion: { outline: "" },
      };

      const sectionData = currentPlan[section] || { outline: "" };
      const updatedOutlinePoints = {
        ...(sectionData.outlinePoints || {}),
        [outlinePointId]: content,
      };

      const allPointsInSection = outlineLookup.pointsBySection[section] || [];
      const combinedText = buildSectionOutlineMarkdown({
        orderedOutlinePoints: allPointsInSection,
        outlinePointsContentById: {
          ...generatedContent,
          ...updatedOutlinePoints,
          [outlinePointId]: content,
        },
      });

      const updatedPlan: Plan = {
        ...currentPlan,
        [section]: {
          ...sectionData,
          outline: combinedText,
          outlinePoints: updatedOutlinePoints,
        },
      };

      await saveSermonPlan({
        sermonId: sermon.id,
        plan: updatedPlan,
      });

      await onSaved({
        outlinePointId,
        section,
        combinedText,
        updatedPlan,
      });

      toast.success(t("plan.pointSaved"));
      if (allPointsInSection.length > 1) {
        toast.success(t("plan.sectionSaved", { section: t(`sections.${section}`) }));
      }
    } catch (error) {
      debugLog("Plan save failed", { sermonId: sermon.id, outlinePointId, section, error });
      toast.error(t("errors.failedToSavePoint"));
    }
  }, [generatedContent, onSaved, outlineLookup.pointsBySection, sermon, t]);

  return {
    generateSermonPointContent,
    saveSermonPoint,
  };
}
