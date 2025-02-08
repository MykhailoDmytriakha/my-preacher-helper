"use client";

import React, { useState } from "react";
import { log } from "@utils/logger";
import { createPortal } from "react-dom";

interface ExportButtonsLayoutProps {
  onTxtClick: () => void;
  onPdfClick: () => void;
  onWordClick: () => void;
  orientation?: "horizontal" | "vertical";
}

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

interface ExportTxtModalProps {
  content: string;
  onClose: () => void;
}

export function ExportTxtModal({ content, onClose }: ExportTxtModalProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sermon-export.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">Экспорт в TXT</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300"
          >
            ✕
          </button>
        </div>
        
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4 max-h-96 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono text-sm">
            {content}
          </pre>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            {isCopied ? "Скопировано!" : "Копировать"}
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Скачать TXT
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface ExportButtonsContainerProps {
  sermonId: string;
  getExportContent: () => Promise<string>;
  orientation?: "horizontal" | "vertical";
}

export default function ExportButtons({
  sermonId,
  getExportContent,
  orientation = "horizontal",
}: ExportButtonsContainerProps) {
  const [exportContent, setExportContent] = useState("");
  const [showTxtModal, setShowTxtModal] = useState(false);

  const handleTxtExport = async () => {
    try {
      const content = await getExportContent();
      setExportContent(content);
      setShowTxtModal(true);
    } catch (error) {
      console.error("Error generating export content:", error);
      alert("Ошибка подготовки текста для экспорта");
    }
  };

  return (
    <>
      <ExportButtonsLayout
        orientation={orientation}
        onTxtClick={handleTxtExport}
        onPdfClick={() => log.info(`Export PDF for sermon ${sermonId}`)}
        onWordClick={() => log.info(`Export Word for sermon ${sermonId}`)}
      />
      
      {showTxtModal && (
        <ExportTxtModal
          content={exportContent}
          onClose={() => setShowTxtModal(false)}
        />
      )}
    </>
  );
}