import type { PlanData } from "../../../utils/wordExport";
import type { MouseEvent, ReactNode } from "react";

export interface ExportButtonsLayoutProps {
  onTxtClick: (event: MouseEvent) => void;
  onPdfClick: () => void;
  onWordClick: () => void;
  onAudioClick?: () => void;
  orientation?: "horizontal" | "vertical";
  isPdfAvailable?: boolean;
  isWordDisabled?: boolean;
  isAudioEnabled?: boolean;
  isPreached?: boolean;
  variant?: "default" | "icon";
  extraButtons?: ReactNode;
  slotClassName?: string;
}

export type Orientation = NonNullable<ExportButtonsLayoutProps["orientation"]>;

export interface ExportTxtModalProps {
  isOpen: boolean;
  onClose: () => void;
  content?: string;
  getContent: (
    format: "plain" | "markdown",
    options?: { includeTags?: boolean; type?: "thoughts" | "plan" },
  ) => Promise<string>;
  format?: "plain" | "markdown";
  hasPlan?: boolean;
}

export interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  getContent: () => Promise<ReactNode>;
  title: string;
}

export interface ExportButtonsProps {
  sermonId: string;
  getExportContent: (
    format: "plain" | "markdown",
    options?: { includeTags?: boolean; type?: "thoughts" | "plan" },
  ) => Promise<string>;
  getPdfContent?: () => Promise<ReactNode>;
  orientation?: "horizontal" | "vertical";
  className?: string;
  showTxtModalDirectly?: boolean;
  onTxtModalClose?: () => void;
  title?: string;
  disabledFormats?: ("txt" | "pdf" | "word")[];
  isPreached?: boolean;
  variant?: "default" | "icon";
  enableAudio?: boolean;
  sermonTitle?: string;
  planData?: PlanData;
  focusedSection?: string;
  extraButtons?: ReactNode;
  slotClassName?: string;
  hasPlan?: boolean;
}
