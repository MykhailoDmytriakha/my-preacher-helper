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
    <div className={`flex ${layoutClass} gap-1.5 max-w-full sm:max-w-none flex-shrink-0`}>
      <button
        onClick={onTxtClick}
        className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
      >
        TXT
      </button>
      
      <div className="tooltip">
        <button
          onClick={onPdfClick}
          disabled={true}
          className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 rounded-md opacity-50 cursor-not-allowed"
          aria-label="PDF export (coming soon)"
        >
          PDF
        </button>
        <span className={`tooltiptext ${orientation === "vertical" ? "tooltiptext-right" : "tooltiptext-top"}`}>
          {t('export.soonAvailable')}
        </span>
      </div>
      
      <div className="tooltip">
        <button
          onClick={onWordClick}
          disabled={true}
          className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 rounded-md opacity-50 cursor-not-allowed"
          aria-label="Word export (coming soon)"
        >
          Word
        </button>
        <span className={`tooltiptext ${orientation === "vertical" ? "tooltiptext-right" : "tooltiptext-top"}`}>
          {t('export.soonAvailable')}
        </span>
      </div>
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg sm:text-xl font-semibold">{t('export.txtTitle')}</h3>
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
        
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4 mb-4 max-h-64 sm:max-h-96 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm">
            {content}
          </pre>
        </div>

        <div className="flex gap-2 sm:gap-3 justify-end">
          <button
            onClick={handleCopy}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            {isCopied ? t('export.copied') : t('export.copy')}
          </button>
          <button
            onClick={handleDownload}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
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
  className?: string;
}

// Add global CSS for tooltips in a style tag at the end of the file
const TooltipStyles = () => (
  <style jsx global>{`
    /* Base tooltip styles */
    .tooltip {
      position: relative;
      display: inline-block;
    }
    
    .tooltip .tooltiptext {
      visibility: hidden;
      background-color: rgba(0, 0, 0, 0.8);
      color: #fff;
      text-align: center;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.75rem;
      
      /* Position the tooltip */
      position: absolute;
      z-index: 1000;
      
      /* Fade in transition */
      opacity: 0;
      transition: opacity 0.2s, visibility 0.2s;
    }
    
    /* Show the tooltip on hover */
    .tooltip:hover .tooltiptext {
      visibility: visible;
      opacity: 1;
    }
    
    /* Tooltip positioning */
    .tooltiptext-top {
      bottom: calc(100% + 5px);
      left: 50%;
      transform: translateX(-50%);
    }
    
    .tooltiptext-right {
      left: calc(100% + 5px);
      top: 50%;
      transform: translateY(-50%);
    }
    
    /* Arrows for tooltips */
    .tooltiptext-top:after {
      content: "";
      position: absolute;
      top: 100%;
      left: 50%;
      margin-left: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: rgba(0, 0, 0, 0.8) transparent transparent transparent;
    }
    
    .tooltiptext-right:after {
      content: "";
      position: absolute;
      top: 50%;
      right: 100%;
      margin-top: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: transparent rgba(0, 0, 0, 0.8) transparent transparent;
    }
  `}</style>
);

// Modify the default export to include the tooltip styles
export default function ExportButtons({
  sermonId,
  getExportContent,
  orientation = "horizontal",
  className = "",
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
    <div className={className}>
      <TooltipStyles />
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
    </div>
  );
}