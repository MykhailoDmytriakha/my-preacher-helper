"use client";

import React from "react";
import { OutlinePoint, Thought } from "@/models/models";
import { useTranslation } from "react-i18next";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { Key, Sparkles, Save, FileText, Pencil } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";

interface OutlinePointCardProps {
  outlinePoint: OutlinePoint;
  thoughts: Thought[];
  sectionName: string;
  onGenerate: (outlinePointId: string) => Promise<void>;
  generatedContent: string | null;
  isGenerating: boolean;
  sermonId: string;
  onOpenFragmentsModal: (outlinePointId: string) => void;
  editMode: boolean;
  onToggleEditMode: (outlinePointId: string) => void;
  onContentChange: (outlinePointId: string, content: string) => void;
  onSave: (outlinePointId: string, content: string, section: string) => void;
  modifiedContent: boolean;
  savedContent: boolean;
}

export const OutlinePointCard = React.forwardRef<HTMLDivElement, OutlinePointCardProps>(({
  outlinePoint,
  thoughts,
  sectionName,
  onGenerate,
  generatedContent,
  isGenerating,
  sermonId,
  onOpenFragmentsModal,
  editMode,
  onToggleEditMode,
  onContentChange,
  onSave,
  modifiedContent,
  savedContent,
}, ref) => {
  const { t } = useTranslation();
  
  // Map the API section name to the theme section name
  const themeSectionName = sectionName === 'main' ? 'mainPart' : sectionName as 'introduction' | 'mainPart' | 'conclusion';
  
  // Get the colors for this section
  const sectionColors = SERMON_SECTION_COLORS[themeSectionName];
  
  // Count key fragments across all thoughts for this outline point
  const keyFragmentsCount = thoughts.reduce((count, thought) => {
    return count + (thought.keyFragments?.length || 0);
  }, 0);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    onContentChange(outlinePoint.id, newContent);
  };

  const handleSave = () => {
    onSave(outlinePoint.id, generatedContent || "", sectionName);
  };

  const handleGenerate = () => {
    onGenerate(outlinePoint.id);
  };

  const handleToggleEdit = () => {
    onToggleEditMode(outlinePoint.id);
  };

  const handleOpenFragments = () => {
    onOpenFragmentsModal(outlinePoint.id);
  };
  
  return (
    <div 
      ref={ref}
      className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
    >
      <h3 className={`font-semibold text-lg mb-2 flex justify-between items-center`}
          style={{ color: sectionColors.text }}>
        {outlinePoint.text}
        
        <div className="flex gap-2">
          {/* Key Fragments Button */}
          <Button
            onClick={handleOpenFragments}
            variant="section"
            sectionColor={sectionColors}
            className="text-sm px-2 py-1 h-8 relative"
            title={t("plan.markKeyFragments")}
          >
            <Key className="h-4 w-4" />
            {keyFragmentsCount > 0 && (
              <span 
                className="absolute -top-1 -right-1 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border"
                style={{ borderColor: sectionColors.light }}
              >
                {keyFragmentsCount}
              </span>
            )}
          </Button>

          {/* Generate/Regenerate Button */}
          <Button
            onClick={handleGenerate}
            variant="section"
            sectionColor={sectionColors}
            className="text-sm px-2 py-1 h-8"
            disabled={isGenerating}
            title={isGenerating ? t("plan.generating") : generatedContent ? t("plan.regenerate") : t("plan.generate")}
          >
            {isGenerating ? (
              <LoadingSpinner size="small" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>

          {/* Save Button */}
          <Button
            onClick={handleSave}
            variant={modifiedContent ? "section" : "default"}
            sectionColor={modifiedContent ? sectionColors : undefined}
            className="text-sm px-2 py-1 h-8"
            disabled={
              !generatedContent || 
              generatedContent.trim() === "" || 
              (savedContent && !modifiedContent)
            }
            title={t("plan.save")}
          >
            <Save className="h-4 w-4" />
          </Button>
        </div>
      </h3>
      
      {/* Content Area */}
      <div className="relative">
        {/* Edit/View Toggle Button */}
        <Button
          className="absolute top-2 right-2 z-10 text-sm px-2 py-1 h-8"
          onClick={handleToggleEdit}
          variant="default"
          title={editMode ? t("plan.viewMode") : t("plan.editMode")}
        >
          {editMode ? (
            <FileText className="h-4 w-4" />
          ) : (
            <Pencil className="h-4 w-4" />
          )}
        </Button>

        {editMode ? (
          /* Edit Mode - Textarea */
          <TextareaAutosize
            className="w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white text-base"
            minRows={4}
            placeholder={t("plan.noContent")}
            value={generatedContent || ""}
            onChange={handleContentChange}
          />
        ) : (
          /* View Mode - Markdown */
          <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
            <div className="p-3 pr-12">
              <MarkdownRenderer 
                markdown={generatedContent || t("plan.noContent")} 
                section={sectionName as 'introduction' | 'main' | 'conclusion'}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

OutlinePointCard.displayName = "OutlinePointCard";

export default OutlinePointCard; 