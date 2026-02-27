import { useCallback } from "react";
import { toast } from "sonner";

import { PlanStyle } from "@/api/clients/openAI.client";
import { Sermon, Plan } from "@/models/models";
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
  setGeneratingId: React.Dispatch<React.SetStateAction<string | null>>;
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
}

export default function usePlanActions({
  sermon,
  planStyle,
  outlineLookup,
  generatedContent,
  t,
  setGeneratingId,
  onGenerated,
  onSaved,
}: UsePlanActionsParams) {
  const generateSermonPointContent = useCallback(async (outlinePointId: string) => {
    if (!sermon) return;

    setGeneratingId(outlinePointId);

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

      toast.success(t("plan.contentGenerated"));
    } catch (error) {
      debugLog("Plan generate failed", { sermonId: sermon.id, outlinePointId, error });
      toast.error(t("errors.failedToGenerateContent"));
    } finally {
      setGeneratingId(null);
    }
  }, [onGenerated, outlineLookup, planStyle, sermon, setGeneratingId, t]);

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
