"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
    <div className={`flex ${layoutClass} gap-1.5 w-full sm:w-auto flex-shrink-0`}>
      <button
        onClick={onTxtClick}
        className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors flex-1 sm:flex-none text-center"
      >
        TXT
      </button>
      
      <div className="tooltip flex-1 sm:flex-none">
        <button
          onClick={onPdfClick}
          disabled={true}
          className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 rounded-md opacity-50 cursor-not-allowed w-full"
          aria-label="PDF export (coming soon)"
        >
          PDF
        </button>
        <span className={`tooltiptext ${orientation === "vertical" ? "tooltiptext-right" : "tooltiptext-top"}`}>
          {t('export.soonAvailable')}
        </span>
      </div>
      
      <div className="tooltip flex-1 sm:flex-none">
        <button
          onClick={onWordClick}
          disabled={true}
          className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 rounded-md opacity-50 cursor-not-allowed w-full"
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
  isOpen: boolean;
  onClose: () => void;
  content?: string;
  getContent?: (format: 'plain' | 'markdown') => Promise<string>;
  format?: 'plain' | 'markdown';
}

export const ExportTxtModal: React.FC<ExportTxtModalProps> = ({
  isOpen,
  onClose,
  content,
  getContent,
  format = 'plain',
}) => {
  const { t } = useTranslation();
  const [activeFormat, setActiveFormat] = useState<'plain' | 'markdown'>(format);
  const [isLoading, setIsLoading] = useState(false);
  const [exportContent, setExportContent] = useState<string>('');
  const [error, setError] = useState<boolean>(false);
  const modalId = useRef(`export-modal-${Math.random().toString(36).substring(2, 9)}`);
  
  // Add cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      setIsLoading(false);
      setExportContent('');
      setError(false);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      setError(false);
      
      if (content) {
        setExportContent(content);
        setIsLoading(false);
      } else if (getContent) {
        getContent(activeFormat)
          .then((result) => {
            setExportContent(result);
            setIsLoading(false);
          })
          .catch((err) => {
            console.error('Error getting export content:', err);
            setExportContent('Error preparing export');
            setError(true);
            setIsLoading(false);
          });
      }
    }
  }, [isOpen, content, getContent, activeFormat]);
  
  const handleFormatChange = (newFormat: 'plain' | 'markdown') => {
    setActiveFormat(newFormat);
    setIsLoading(true);
    setError(false);
    
    if (getContent) {
      getContent(newFormat)
        .then((result) => {
          setExportContent(result);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error('Error getting export content:', err);
          setExportContent('Error preparing export');
          setError(true);
          setIsLoading(false);
        });
    }
  };
  
  // Handle copy to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(exportContent).catch(err => {
      console.error('Failed to copy text:', err);
    });
  };
  
  // Handle download
  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([exportContent], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `export.${activeFormat}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };
  
  if (!isOpen) return null;
  
  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" data-testid="portal-content">
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 w-full max-w-2xl flex flex-col"
        style={{ minHeight: "300px", maxHeight: "90vh" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        data-testid="export-txt-modal"
        data-modal-id={modalId.current}
      >
        {/* Modal header */}
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 id="export-modal-title" className="text-lg sm:text-xl font-semibold">
            {t('export.txtTitle')}
          </h3>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        
        {/* Format selection */}
        <div className="flex items-center mb-4 text-sm flex-shrink-0">
          <span className="mr-2">{t('export.format')}:</span>
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
            <button
              className={`px-3 py-1 rounded ${
                activeFormat === 'plain'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              onClick={() => handleFormatChange('plain')}
              disabled={isLoading}
            >
              {t('export.formatPlain')}
            </button>
            <button
              className={`px-3 py-1 rounded ${
                activeFormat === 'markdown'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              onClick={() => handleFormatChange('markdown')}
              disabled={isLoading}
            >
              {t('export.formatMarkdown')}
            </button>
          </div>
        </div>
        
        {/* Content area */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4 mb-4 flex-grow overflow-y-auto relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-700/80 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          )}
          <div className={`transition-opacity duration-200 ${isLoading ? 'opacity-30' : 'opacity-100'}`}>
            {error ? (
              <div className="text-red-500">{exportContent}</div>
            ) : activeFormat === 'plain' ? (
              <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm">{exportContent}</pre>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {exportContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2 sm:gap-3 justify-end flex-shrink-0">
          <button
            onClick={handleCopy}
            disabled={isLoading || !exportContent || error}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            {t('export.copy')}
          </button>
          <button
            onClick={handleDownload}
            disabled={isLoading || !exportContent || error}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {activeFormat === 'plain' 
              ? t('export.downloadTxt') 
              : t('export.downloadMarkdown', 'Download MD')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

interface ExportButtonsContainerProps {
  sermonId: string;
  getExportContent: (format: 'plain' | 'markdown') => Promise<string>;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

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

export default function ExportButtons({
  sermonId,
  getExportContent,
  orientation = "horizontal",
  className = "",
}: ExportButtonsContainerProps) {
  const { t } = useTranslation();
  const [showTxtModal, setShowTxtModal] = useState(false);

  const handleTxtClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTxtModal(true);
  };

  const handlePdfClick = () => { console.log("PDF Export clicked (disabled)"); };
  const handleWordClick = () => { console.log("Word Export clicked (disabled)"); };

  return (
    <div className={`relative ${className}`}>
      <TooltipStyles />
      
      <ExportButtonsLayout
        onTxtClick={handleTxtClick}
        onPdfClick={handlePdfClick}
        onWordClick={handleWordClick}
        orientation={orientation}
      />

      {showTxtModal && (
        <ExportTxtModal
          isOpen={showTxtModal}
          onClose={() => setShowTxtModal(false)}
          getContent={getExportContent}
        />
      )}
    </div>
  );
}