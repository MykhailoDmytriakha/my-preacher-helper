"use client";

import React from "react";

// ExportButtons component (presentational)
interface ExportButtonsProps {
  onTxtClick?: () => void;
  onPdfClick?: () => void;
  onWordClick?: () => void;
  orientation?: "horizontal" | "vertical";
}

function ExportButtonsLayout({
  onTxtClick,
  onPdfClick,
  onWordClick,
  orientation = "horizontal",
}: ExportButtonsProps) {
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

// ClientExportButtons component (container)
interface ExportButtonsProps {
  sermonId: string;
  orientation?: "horizontal" | "vertical";
}

export default function ExportButtons({
  sermonId,
  orientation = "horizontal",
}: ExportButtonsProps) {
  return (
    <ExportButtonsLayout
      orientation={orientation}
      sermonId={sermonId}
      onTxtClick={() => console.log(`Export TXT for sermon ${sermonId}`)}
      onPdfClick={() => console.log(`Export PDF for sermon ${sermonId}`)}
      onWordClick={() => console.log(`Export Word for sermon ${sermonId}`)}
    />
  );
}
