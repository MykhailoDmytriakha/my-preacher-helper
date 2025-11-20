"use client";

import React from "react";
import { SermonPoint, Thought } from "@/models/models";
import { useTranslation } from "react-i18next";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import SermonPointCard from "./OutlinePointCard";

interface PlanSectionProps {
  sectionName: "introduction" | "main" | "conclusion";
  outlinePoints: SermonPoint[];
  thoughts: Thought[];
  generatedContent: Record<string, string>;
  modifiedContent: Record<string, boolean>;
  savedContent: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  generatingId: string | null;
  onGenerate: (outlinePointId: string) => Promise<void>;
  onSave: (outlinePointId: string, content: string, section: string) => void;
  onContentChange: (outlinePointId: string, content: string) => void;
  onToggleEditMode: (outlinePointId: string) => void;
  onOpenFragmentsModal: (outlinePointId: string) => void;
  getThoughtsForSermonPoint: (outlinePointId: string) => Thought[];
  className?: string;
  "data-testid"?: string;
}

export const PlanSection = React.forwardRef<HTMLDivElement, PlanSectionProps>(({
  sectionName,
  outlinePoints,
  generatedContent,
  modifiedContent,
  savedContent,
  editModePoints,
  generatingId,
  onGenerate,
  onSave,
  onContentChange,
  onToggleEditMode,
  onOpenFragmentsModal,
  getThoughtsForSermonPoint,
  className,
  "data-testid": testId,
}, ref) => {
  const { t } = useTranslation();
  
  // Map section names for theme colors
  const themeSectionName = sectionName === 'main' ? 'mainPart' : sectionName;
  const sectionColors = SERMON_SECTION_COLORS[themeSectionName];
  
  // Get section title and color
  const getSectionTitle = () => {
    switch (sectionName) {
      case "introduction":
        return t("sections.introduction");
      case "main":
        return t("sections.main");
      case "conclusion":
        return t("sections.conclusion");
      default:
        return sectionName;
    }
  };

  // Header background now uses canonical palette hex (no hardcoded tailwind color tokens)

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={`rounded-lg overflow-hidden border ${sectionColors.border.split(' ')[0]} dark:${sectionColors.darkBorder} ${sectionColors.bg} dark:${sectionColors.darkBg} ${className || ""}`}
    >
      <h2
        className={`text-xl font-semibold p-3 text-white dark:text-white border-b ${sectionColors.border.split(' ')[0]} dark:${sectionColors.darkBorder}`}
        style={{ backgroundColor: sectionColors.light }}
      >
        {getSectionTitle()}
      </h2>
      
      <div className="p-3">
        {outlinePoints.map((outlinePoint) => (
          <SermonPointCard
            key={outlinePoint.id}
            outlinePoint={outlinePoint}
            thoughts={getThoughtsForSermonPoint(outlinePoint.id)}
            sectionName={sectionName}
            onGenerate={onGenerate}
            generatedContent={generatedContent[outlinePoint.id] || null}
            isGenerating={generatingId === outlinePoint.id}
            onOpenFragmentsModal={onOpenFragmentsModal}
            editMode={editModePoints[outlinePoint.id] || false}
            onToggleEditMode={onToggleEditMode}
            onContentChange={onContentChange}
            onSave={onSave}
            modifiedContent={modifiedContent[outlinePoint.id] || false}
            savedContent={savedContent[outlinePoint.id] || false}
          />
        ))}
        
        {outlinePoints.length === 0 && (
          <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
        )}
      </div>
    </div>
  );
});

PlanSection.displayName = "PlanSection";

export default PlanSection; 