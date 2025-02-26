"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface ExportButtonsLayoutProps {
  onTxtClick: (e: React.MouseEvent) => void;
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
  const { t } = useTranslation();
  const layoutClass = orientation === "vertical" ? "flex-col" : "flex-row";

  return (
    <div className={`flex ${layoutClass} gap-1.5`}>
      <button
        onClick={onTxtClick}
        className="w-full px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
      >
        TXT
      </button>
      <button
        onClick={onPdfClick}
        disabled={true}
        className="w-full px-3 py-1.5 text-sm bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 rounded-md opacity-50 cursor-not-allowed relative group"
      >
        PDF
        <span className={`hidden group-hover:block absolute ${orientation === "vertical" ? "left-full top-1/2 -translate-y-1/2 ml-2" : "bottom-full left-1/2 -translate-x-1/2 mb-2"} px-2 py-1 text-xs bg-gray-900 text-white rounded-md`}>
          {t('export.soonAvailable')}
        </span>
      </button>
      <button
        onClick={onWordClick}
        disabled={true}
        className="w-full px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 rounded-md opacity-50 cursor-not-allowed relative group"
      >
        Word
        <span className={`hidden group-hover:block absolute ${orientation === "vertical" ? "left-full top-1/2 -translate-y-1/2 ml-2" : "bottom-full left-1/2 -translate-x-1/2 mb-2"} px-2 py-1 text-xs bg-gray-900 text-white rounded-md`}>
          {t('export.soonAvailable')}
        </span>
      </button>
    </div>
  );
}

interface ExportTxtModalProps {
  content: string;
  onClose: () => void;
}

export function ExportTxtModal({ content, onClose }: ExportTxtModalProps) {
  const { t } = useTranslation();
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
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">{t('export.txtTitle')}</h3>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
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
            {isCopied ? t('export.copied') : t('export.copy')}
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {t('export.downloadTxt')}
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
  const { t } = useTranslation();
  const [exportContent, setExportContent] = useState("");
  const [showTxtModal, setShowTxtModal] = useState(false);

  const handleTxtExport = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const content = await getExportContent();
      setExportContent(content);
      setShowTxtModal(true);
    } catch (error) {
      console.error("Error generating export content:", error);
      alert(t('export.prepareError'));
    }
  };

  return (
    <>
      <ExportButtonsLayout
        orientation={orientation}
        onTxtClick={handleTxtExport}
        onPdfClick={() => console.log(`Export PDF for sermon ${sermonId}`)}
        onWordClick={() => console.log(`Export Word for sermon ${sermonId}`)}
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