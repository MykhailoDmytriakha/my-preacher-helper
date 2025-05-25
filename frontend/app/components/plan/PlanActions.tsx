"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollText, FileText, Save, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";

interface PlanActionsProps {
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleMode: () => void;
  onSavePlan: () => void;
  isSaving: boolean;
  editMode: boolean;
  hasUnsavedChanges: boolean;
}

export const PlanActions = ({
  isExpanded,
  onToggleExpand,
  onToggleMode,
  onSavePlan,
  isSaving,
  editMode,
  hasUnsavedChanges,
}: PlanActionsProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 mb-6">
      {/* Expand/Collapse Button */}
      <Button
        onClick={onToggleExpand}
        variant="default"
        className="flex items-center gap-2"
        title={isExpanded ? t("plan.collapse") : t("plan.expand")}
      >
        {isExpanded ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {isExpanded ? t("plan.collapse") : t("plan.expand")}
        </span>
      </Button>

      {/* View/Edit Mode Toggle */}
      <Button
        onClick={onToggleMode}
        variant="default"
        className="flex items-center gap-2"
        title={editMode ? t("plan.viewMode") : t("plan.editMode")}
      >
        {editMode ? (
          <FileText className="h-4 w-4" />
        ) : (
          <ScrollText className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {editMode ? t("plan.viewMode") : t("plan.editMode")}
        </span>
      </Button>

      {/* Save Plan Button */}
      <Button
        onClick={onSavePlan}
        variant={hasUnsavedChanges ? "primary" : "default"}
        className="flex items-center gap-2"
        disabled={isSaving}
        title={t("plan.savePlan")}
      >
        {isSaving ? (
          <LoadingSpinner size="small" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {t("plan.savePlan")}
        </span>
      </Button>

      {/* Status Indicator */}
      {hasUnsavedChanges && (
        <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
          <span className="text-sm hidden md:inline">
            {t("plan.unsavedChanges")}
          </span>
        </div>
      )}
    </div>
  );
}; 