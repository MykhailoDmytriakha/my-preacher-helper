"use client";

import React from "react";
import { OutlinePoint, Thought, Plan } from "@/models/models";
import { useTranslation } from "react-i18next";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import OutlinePointCard from "./OutlinePointCard";

interface PlanSectionProps {
  sectionName: "introduction" | "main" | "conclusion";
  outlinePoints: OutlinePoint[];
  thoughts: Thought[];
  sermonId: string;
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
  getThoughtsForOutlinePoint: (outlinePointId: string) => Thought[];
  className?: string;
  "data-testid"?: string;
}

export const PlanSection = React.forwardRef<HTMLDivElement, PlanSectionProps>(({
  sectionName,
  outlinePoints,
  sermonId,
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
  getThoughtsForOutlinePoint,
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

  const getSectionHeaderBg = () => {
    switch (sectionName) {
      case "introduction":
        return "bg-blue-500 dark:bg-blue-700";
      case "main":
        return "bg-purple-500 dark:bg-purple-700";
      case "conclusion":
        return "bg-green-500 dark:bg-green-700";
      default:
        return "bg-gray-500 dark:bg-gray-700";
    }
  };

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={`rounded-lg overflow-hidden border ${sectionColors.border.split(' ')[0]} dark:${sectionColors.darkBorder} ${sectionColors.bg} dark:${sectionColors.darkBg} ${className || ""}`}
    >
      <h2 className={`text-xl font-semibold p-3 ${getSectionHeaderBg()} text-white dark:text-white border-b ${sectionColors.border.split(' ')[0]} dark:${sectionColors.darkBorder}`}>
        {getSectionTitle()}
      </h2>
      
      <div className="p-3">
        {outlinePoints.map((outlinePoint) => (
          <OutlinePointCard
            key={outlinePoint.id}
            outlinePoint={outlinePoint}
            thoughts={getThoughtsForOutlinePoint(outlinePoint.id)}
            sectionName={sectionName}
            onGenerate={onGenerate}
            generatedContent={generatedContent[outlinePoint.id] || null}
            isGenerating={generatingId === outlinePoint.id}
            sermonId={sermonId}
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
          <p className="text-gray-500">{t("plan.noOutlinePoints")}</p>
        )}
      </div>
    </div>
  );
});

PlanSection.displayName = "PlanSection";

export default PlanSection; 