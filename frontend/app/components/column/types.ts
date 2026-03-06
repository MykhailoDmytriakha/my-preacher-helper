import type { PlanData } from "../../../utils/wordExport";
import type { Item, SermonOutline, SermonPoint, Thought } from "@/models/models";
import type React from "react";



export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type ColumnSectionId = "introduction" | "main" | "conclusion";
export type SectionType = "introduction" | "mainPart" | "conclusion";
export type HighlightType = "assigned" | "moved";
export type HighlightedItems = Record<string, { type: HighlightType }>;
export type OnAudioThoughtCreated = (thought: Thought, sectionId: ColumnSectionId) => void;

export type PlaceholderColors = {
  border: string;
  bg: string;
  header: string;
  headerText: string;
};

export interface ColumnProps {
  id: string;
  title: string;
  items: Item[];
  headerColor?: string;
  onEdit?: (item: Item) => void;
  outlinePoints?: SermonPoint[];
  showFocusButton?: boolean;
  isFocusMode?: boolean;
  onToggleFocusMode?: (columnId: string) => void;
  onAiSort?: () => void;
  isLoading?: boolean;
  className?: string;
  getExportContent?: (
    format: "plain" | "markdown",
    options?: { includeTags?: boolean }
  ) => Promise<string>;
  sermonId?: string;
  onAddThought?: (sectionId: string, outlinePointId?: string) => void;
  onOutlineUpdate?: (updatedOutline: SermonOutline) => void;
  onOutlinePointDeleted?: (pointId: string, columnId: string) => void;
  onAddOutlinePoint?: (sectionId: string, index: number, text: string) => Promise<void>;
  thoughtsPerSermonPoint?: Record<string, number>;
  isDiffModeActive?: boolean;
  highlightedItems?: HighlightedItems;
  onKeepItem?: (itemId: string, columnId: string) => void;
  onRevertItem?: (itemId: string, columnId: string) => void;
  onKeepAll?: (columnId: string) => void;
  onRevertAll?: (columnId: string) => void;
  activeId?: string | null;
  onMoveToAmbiguous?: (itemId: string, fromContainerId: string) => void;
  onAudioThoughtCreated?: OnAudioThoughtCreated;
  onToggleReviewed?: (outlinePointId: string, isReviewed: boolean) => void;
  onSwitchPage?: (sectionId?: string) => void;
  onNavigateToSection?: (sectionId: ColumnSectionId) => void;
  onRetryPendingThought?: (itemId: string) => void;
  planData?: PlanData;
}

export interface OpenPointEditorArgs {
  point: SermonPoint;
  isFocusMode?: boolean;
  setLocalEditText: React.Dispatch<React.SetStateAction<string>>;
  setIsEditingLocally: React.Dispatch<React.SetStateAction<boolean>>;
  onEditPoint?: (point: SermonPoint) => void;
}
