"use client";

import React from "react";
import { log } from "@utils/logger";
/**
 * Props for the presentational export buttons layout.
 */
interface ExportButtonsLayoutProps {
  onTxtClick: () => void;
  onPdfClick: () => void;
  onWordClick: () => void;
  orientation?: "horizontal" | "vertical";
}

/**
 * Presentational layout for export buttons.
 */
export function ExportButtonsLayout({
  onTxtClick,
  onPdfClick,
  onWordClick,
  orientation = "horizontal",
}: ExportButtonsLayoutProps) {
  const layoutClass = orientation === "vertical" ? "flex-col" : "flex-row";

  return (
    <div className={`flex ${layoutClass} gap-1.5`}>
      <button
        onClick={onTxtClick}
        className="w-full px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-md"
      >
        TXT
      </button>
      <button
        onClick={onPdfClick}
        className="w-full px-3 py-1.5 text-sm bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 rounded-md"
      >
        PDF
      </button>
      <button
        onClick={onWordClick}
        className="w-full px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 rounded-md"
      >
        Word
      </button>
    </div>
  );
}

/**
 * Props for the container export buttons component.
 */
interface ExportButtonsContainerProps {
  sermonId: string;
  orientation?: "horizontal" | "vertical";
}

/**
 * Container component that wires up the export buttons with sermon-specific actions.
 */
export default function ExportButtons({
  sermonId,
  orientation = "horizontal",
}: ExportButtonsContainerProps) {
  return (
    <ExportButtonsLayout
      orientation={orientation}
      onTxtClick={() => log.info(`Export TXT for sermon ${sermonId}`)}
      onPdfClick={() => log.info(`Export PDF for sermon ${sermonId}`)}
      onWordClick={() => log.info(`Export Word for sermon ${sermonId}`)}
    />
  );
}
