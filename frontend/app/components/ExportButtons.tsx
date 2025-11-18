"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Check, FileText, File, FileType } from 'lucide-react';
import { exportToWord, PlanData } from '../../utils/wordExport';
import { sanitizeMarkdown } from "../utils/markdownUtils";

interface ExportButtonsLayoutProps {
  onTxtClick: (e: React.MouseEvent) => void;
  onPdfClick: () => void;
  onWordClick: () => void;
  orientation?: "horizontal" | "vertical";
  isPdfAvailable?: boolean;
  isPreached?: boolean;
  variant?: 'default' | 'icon';
}

export function ExportButtonsLayout({
  onTxtClick,
  onPdfClick,
  onWordClick,
  orientation = "horizontal",
  isPdfAvailable = false,
  isPreached = false,
  variant = 'default',
}: ExportButtonsLayoutProps) {
  const { t } = useTranslation();
  const layoutClass = orientation === "vertical" ? "flex-col" : "flex-row";
  
  if (variant === 'icon') {
    return (
      <div className={`flex ${layoutClass} gap-2 w-full sm:w-auto flex-shrink-0 items-center`}>
        <div className="tooltip">
          <button
            onClick={onTxtClick}
            className={`p-1.5 rounded-md transition-colors ${
              isPreached
                ? 'text-gray-500 hover:bg-gray-200 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400'
                : 'text-gray-400 hover:bg-blue-50 hover:text-blue-600 dark:text-gray-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400'
            }`}
            aria-label={t('export.txtTitle')}
          >
            <FileText className="w-4 h-4" />
          </button>
          <span className="tooltiptext tooltiptext-top">TXT</span>
        </div>

        <div className="tooltip">
          <button
            onClick={onPdfClick}
            disabled={!isPdfAvailable}
            className={`p-1.5 rounded-md transition-colors ${
              !isPdfAvailable
                ? 'text-gray-300 cursor-not-allowed dark:text-gray-700'
                : isPreached
                  ? 'text-gray-500 hover:bg-gray-200 hover:text-purple-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-purple-400'
                  : 'text-gray-400 hover:bg-purple-50 hover:text-purple-600 dark:text-gray-500 dark:hover:bg-purple-900/30 dark:hover:text-purple-400'
            }`}
            aria-label={isPdfAvailable ? "PDF export" : "PDF export (coming soon)"}
          >
            <File className="w-4 h-4" />
          </button>
          <span className="tooltiptext tooltiptext-top">{isPdfAvailable ? 'PDF' : t('export.soonAvailable')}</span>
        </div>

        <div className="tooltip">
          <button
            onClick={onWordClick}
            className={`p-1.5 rounded-md transition-colors ${
              isPreached
                ? 'text-gray-500 hover:bg-gray-200 hover:text-green-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-green-400'
                : 'text-gray-400 hover:bg-green-50 hover:text-green-600 dark:text-gray-500 dark:hover:bg-green-900/30 dark:hover:text-green-400'
            }`}
            aria-label="Word export"
          >
            <FileType className="w-4 h-4" />
          </button>
          <span className="tooltiptext tooltiptext-top">Word</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${layoutClass} gap-1.5 w-full sm:w-auto flex-shrink-0`}>
      <button
        onClick={onTxtClick}
        className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors flex-1 sm:flex-none text-center ${
          isPreached
            ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900 dark:hover:text-blue-300'
            : 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
        }`}
      >
        TXT
      </button>
      
      <div className="tooltip flex-1 sm:flex-none">
        <button
          onClick={onPdfClick}
          disabled={!isPdfAvailable}
          className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md w-full ${
            isPreached
              ? isPdfAvailable
                ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-900 dark:hover:text-purple-300'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 opacity-50 cursor-not-allowed'
              : `bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 ${!isPdfAvailable ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-200 dark:hover:bg-purple-800'}`
          }`}
          aria-label={isPdfAvailable ? "PDF export" : "PDF export (coming soon)"}
        >
          PDF
        </button>
        {!isPdfAvailable && (
          <span className={`tooltiptext ${orientation === "vertical" ? "tooltiptext-right" : "tooltiptext-top"}`}>
            {t('export.soonAvailable')}
          </span>
        )}
      </div>
      
      <div className="tooltip flex-1 sm:flex-none">
        <button
          onClick={onWordClick}
          disabled={false}
          className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md transition-colors w-full ${
            isPreached
              ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900 dark:hover:text-green-300'
              : 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
          }`}
          aria-label="Word export"
        >
          Word
        </button>
      </div>
    </div>
  );
}

interface ExportTxtModalProps {
  isOpen: boolean;
  onClose: () => void;
  content?: string;
  getContent: (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => Promise<string>;
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
  const [showTags, setShowTags] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [exportContent, setExportContent] = useState<string>('');
  const [error, setError] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState(false);
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

  // Initial content loading and when format/tags change
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      setError(false);
      
      if (content) {
        setExportContent(content);
        setIsLoading(false);
      } else if (getContent) {
        getContent(activeFormat, { includeTags: showTags })
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
  }, [isOpen, content, getContent, activeFormat, showTags]);
  
  // No longer need to fetch content in these handlers since the useEffect will handle it
  const handleFormatChange = (newFormat: 'plain' | 'markdown') => {
    setActiveFormat(newFormat);
  };

  const handleTagsToggle = () => {
    const newShowTags = !showTags;
    setShowTags(newShowTags);
  };
  
  // Handle copy to clipboard with feedback
  const handleCopy = () => {
    if (isCopied) return;

    navigator.clipboard.writeText(exportContent).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    }).catch(err => {
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
        
        {/* Options row - Format selection and Tags toggle */}
        <div className="flex flex-wrap items-center mb-4 text-sm flex-shrink-0 gap-4">
          {/* Format selection */}
          <div className="flex items-center">
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
          
          {/* Tags toggle switch */}
          <div className="flex items-center ml-auto">
            <span className="mr-2">{t('export.includeTags')}:</span>
            <button 
              onClick={handleTagsToggle}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              role="switch"
              aria-checked={showTags}
              aria-label={showTags ? t('export.hideTags') : t('export.showTags')}
              style={{ 
                backgroundColor: showTags ? '#3b82f6' : '#e5e7eb',
              }}
              disabled={isLoading}
            >
              <span 
                className={`${
                  showTags ? 'translate-x-6' : 'translate-x-1'
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
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
                  {sanitizeMarkdown(exportContent)}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2 sm:gap-3 justify-end flex-shrink-0">
          <button
            onClick={handleCopy}
            disabled={isLoading || !exportContent || error || isCopied}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 text-sm rounded-md transition-all duration-150 flex items-center justify-center gap-1.5 min-w-[100px] ${isCopied ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
          >
            {isCopied ? (
              <>
                <Check size={16} />
                {t('export.copied', 'Copied!')}
              </>
            ) : (
              t('export.copy', 'Copy')
            )}
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

interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  getContent: () => Promise<React.ReactNode>;
  title: string;
}

export const ExportPdfModal: React.FC<ExportPdfModalProps> = ({
  isOpen,
  onClose,
  getContent,
  title,
}) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<boolean>(false);
  const [content, setContent] = useState<React.ReactNode | null>(null);
  const modalId = useRef(`export-pdf-modal-${Math.random().toString(36).substring(2, 9)}`);
  const contentRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      setError(false);
      
      getContent()
        .then((content) => {
          setContent(content);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error('Error preparing PDF content:', err);
          setError(true);
          setIsLoading(false);
        });
    }
  }, [isOpen, getContent]);
  
  const handleExportPdf = async () => {
    if (!contentRef.current) return;
    
    try {
      setIsLoading(true);
      
      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = 30;
      
      pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);
      pdf.save(`${title || 'export'}.pdf`);
      
      setIsLoading(false);
    } catch (err) {
      console.error('Error generating PDF:', err);
      setError(true);
      setIsLoading(false);
    }
  };
  
  if (!isOpen) return null;
  
  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" data-testid="portal-content">
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 w-full max-w-4xl flex flex-col"
        style={{ minHeight: "300px", maxHeight: "90vh" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-pdf-modal-title"
        data-testid="export-pdf-modal"
        data-modal-id={modalId.current}
      >
        {/* Modal header */}
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 id="export-pdf-modal-title" className="text-lg sm:text-xl font-semibold">
            {t('export.pdfTitle', 'Export to PDF')}
          </h3>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        
        {/* Content area */}
        <div className="bg-white rounded-lg p-3 sm:p-4 mb-4 flex-grow overflow-y-auto relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-700/80 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          )}
          
          {error ? (
            <div className="text-red-500">{t('export.errorPreparingPdf', 'Error preparing PDF content')}</div>
          ) : (
            <div 
              ref={contentRef} 
              className="transition-opacity duration-200"
              style={{ backgroundColor: 'white', color: 'black' }}
            >
              {content}
            </div>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2 sm:gap-3 justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            {t('actions.cancel')}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isLoading || error}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('export.savePdf', 'Save as PDF')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

interface ExportButtonsContainerProps {
  sermonId: string;
  getExportContent: (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => Promise<string>;
  getPdfContent?: () => Promise<React.ReactNode>;
  orientation?: "horizontal" | "vertical";
  className?: string;
  showTxtModalDirectly?: boolean;
  onTxtModalClose?: () => void;
  title?: string;
  disabledFormats?: ('txt' | 'pdf' | 'word')[];
  isPreached?: boolean;
  variant?: 'default' | 'icon';
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
      white-space: nowrap;
      
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
  getExportContent,
  getPdfContent,
  orientation = "horizontal",
  className = "",
  showTxtModalDirectly = false,
  onTxtModalClose,
  title = "Export",
  disabledFormats = [],
  isPreached = false,
  variant = 'default',
}: ExportButtonsContainerProps) {
  const [showTxtModal, setShowTxtModal] = useState(showTxtModalDirectly || false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  // Determine if PDF is available based on the disabledFormats prop
  const isPdfAvailable = !!getPdfContent && !disabledFormats.includes('pdf');
  // Similarly, check if TXT is disabled (though less likely needed)
  const isTxtDisabled = disabledFormats.includes('txt');
  // Word is now enabled
  const isWordDisabled = disabledFormats.includes('word');

  useEffect(() => {
    setShowTxtModal(showTxtModalDirectly || false);
  }, [showTxtModalDirectly]);

  const handleTxtClick = (e: React.MouseEvent) => {
    if (isTxtDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    setShowTxtModal(true);
  };

  const handleCloseModal = () => {
    setShowTxtModal(false);
    if (onTxtModalClose) {
      onTxtModalClose();
    }
  };

  const handlePdfClick = () => {
    if (!isPdfAvailable) return;
    console.log("handlePdfClick called");
    setShowPdfModal(true);
  };

  const handleClosePdfModal = () => {
    console.log("handleClosePdfModal called");
    setShowPdfModal(false);
  };

  const handleWordClick = async () => { 
    if (isWordDisabled) return;
    
    try {
      // Get the plan content in markdown format
      const content = await getExportContent('markdown', { includeTags: false });
      
      // Parse the content to extract sections - keep markdown formatting intact
      const lines = content.split('\n');
      let sermonTitle = title || 'План проповеди';
      let sermonVerse = '';
      let introduction = '';
      let main = '';
      let conclusion = '';
      let currentSection = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Extract title if it's at the beginning - remove markdown formatting for title
        if (i === 0 && line.startsWith('# ')) {
          sermonTitle = line.replace('# ', '').trim();
          continue;
        }
        
        // Extract verse if it follows title - remove markdown formatting for verse
        if (line.startsWith('> ')) {
          sermonVerse = line.replace('> ', '').trim();
          continue;
        }
        
        // Check for section headers
        if (line.includes('Вступление') || line.includes('Introduction')) {
          currentSection = 'introduction';
          continue;
        } else if (line.includes('Основная часть') || line.includes('Main Part')) {
          currentSection = 'main';
          continue;
        } else if (line.includes('Заключение') || line.includes('Conclusion')) {
          currentSection = 'conclusion';
          continue;
        }
        
        // Add content to appropriate section - KEEP markdown formatting
        if (currentSection && line.trim()) {
          if (currentSection === 'introduction') {
            introduction += line + '\n';
          } else if (currentSection === 'main') {
            main += line + '\n';
          } else if (currentSection === 'conclusion') {
            conclusion += line + '\n';
          }
        }
      }
      
      const planData: PlanData = {
        sermonTitle: sermonTitle,
        sermonVerse: sermonVerse || undefined,
        introduction: introduction.trim() || 'Содержание будет добавлено позже...',
        main: main.trim() || 'Содержание будет добавлено позже...',
        conclusion: conclusion.trim() || 'Содержание будет добавлено позже...',
      };
      
      await exportToWord({ data: planData });
      
    } catch (error) {
      console.error('Error exporting to Word:', error);
      // You can add a toast notification here if needed
    }
  };

  return (
    <div className={className} data-testid="export-buttons-container">
      <TooltipStyles />
      <ExportButtonsLayout
        onTxtClick={handleTxtClick}
        onPdfClick={handlePdfClick}
        onWordClick={handleWordClick}
        orientation={orientation}
        isPdfAvailable={isPdfAvailable}
        isPreached={isPreached}
        variant={variant}
      />

      <ExportTxtModal
        isOpen={showTxtModal}
        onClose={handleCloseModal}
        getContent={getExportContent}
        format="plain"
      />
      
      {getPdfContent && (
        <ExportPdfModal
          isOpen={showPdfModal}
          onClose={handleClosePdfModal}
          getContent={getPdfContent}
          title={title}
        />
      )}
    </div>
  );
}
