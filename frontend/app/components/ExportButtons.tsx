"use client";

import React, { useState, useEffect } from "react";
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
  getExportContent: (format: 'plain' | 'markdown') => Promise<string>;
}

export function ExportTxtModal({ content, onClose, getExportContent }: ExportTxtModalProps) {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);
  const [format, setFormat] = useState<'plain' | 'markdown'>('plain');
  const [modalContent, setModalContent] = useState(content);
  const [isLoading, setIsLoading] = useState(false);
  const [displayContent, setDisplayContent] = useState(content);

  useEffect(() => {
    const updateContent = async () => {
      setIsLoading(true);
      try {
        const newContent = await getExportContent(format);
        setModalContent(newContent);
        setDisplayContent(newContent);
      } catch (error) {
        console.error("Error updating content format:", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    updateContent();
  }, [format, getExportContent]);

  const handleCopy = () => {
    navigator.clipboard.writeText(modalContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([modalContent], { type: "text/plain" });
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
        
        <div className="flex items-center mb-4 text-sm">
          <span className="mr-2">{t('export.format')}:</span>
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md">
            <button 
              className={`px-3 py-1 rounded-md ${format === 'plain' 
                ? 'bg-blue-500 text-white' 
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              onClick={() => setFormat('plain')}
            >
              {t('export.formatPlain')}
            </button>
            <button 
              className={`px-3 py-1 rounded-md ${format === 'markdown' 
                ? 'bg-blue-500 text-white' 
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              onClick={() => setFormat('markdown')}
            >
              {t('export.formatMarkdown')}
            </button>
          </div>
        </div>
        
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4 mb-4 overflow-hidden">
          <div style={{ minHeight: '200px' }} className="max-h-64 sm:max-h-96 overflow-y-auto relative">
            {isLoading ? (
              <div className="flex justify-center items-center absolute inset-0 bg-gray-50/80 dark:bg-gray-700/80 z-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : null}
            <pre className={`whitespace-pre-wrap font-mono text-xs sm:text-sm transition-opacity duration-300 ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
              {displayContent}
            </pre>
          </div>
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
  const [exportContent, setExportContent] = useState("");
  const [showTxtModal, setShowTxtModal] = useState(false);

  const getFormattedContent = async (format: 'plain' | 'markdown') => {
    try {
      // Получаем оригинальный контент для анализа
      const originalContent = await getExportContent();
      
      // Определяем колонку, находящуюся в фокусе, анализируя заголовок
      // Это эвристика, но она должна работать для наших данных
      let focusedColumn: string | undefined;
      
      // Проверим, находимся ли мы на странице структуры
      const isStructurePage = window.location.pathname.includes('/structure');
      
      // Если мы на странице структуры, попробуем определить колонку из URL
      if (isStructurePage) {
        const url = new URL(window.location.href);
        const focusParam = url.searchParams.get('focus');
        
        // Если параметр focus есть в URL, используем его
        if (focusParam && ['introduction', 'main', 'conclusion', 'ambiguous'].includes(focusParam)) {
          focusedColumn = focusParam;
        }
      }
      
      // Если мы все еще не определили колонку, попробуем проанализировать содержимое
      if (!focusedColumn) {
        // Попытка определить текущую колонку из содержимого
        if (originalContent.includes('# Introduction') || 
            originalContent.includes('# Вступление') || 
            originalContent.includes('# Вступ')) {
          focusedColumn = 'introduction';
        } else if (originalContent.includes('# Main Part') || 
                  originalContent.includes('# Основная часть') || 
                  originalContent.includes('# Основна частина')) {
          focusedColumn = 'main';
        } else if (originalContent.includes('# Conclusion') || 
                  originalContent.includes('# Заключение') || 
                  originalContent.includes('# Висновок')) {
          focusedColumn = 'conclusion';
        } else if (originalContent.includes('# Under Consideration') || 
                  originalContent.includes('# На рассмотрении') || 
                  originalContent.includes('# На розгляді')) {
          focusedColumn = 'ambiguous';
        }
      }
      
      // Записываем в консоль для отладки
      console.log('Determined focusedColumn:', focusedColumn);
      
      // Для определения страницы и API-вызова
      if (window.location.pathname.includes('/sermons/') || 
          window.location.pathname.includes('/dashboard')) {
        const { getExportContent: exportFn } = await import('@/utils/exportContent');
        
        try {
          const response = await fetch(`/api/sermons/${sermonId}`);
          if (response.ok) {
            const sermon = await response.json();
            // На страницах проповеди не используем фокус колонки
            return exportFn(sermon, undefined, { format });
          }
        } catch (error) {
          console.error("Error fetching sermon for format change:", error);
        }
      }
      
      // Для страницы структуры (structure page)
      if (isStructurePage) {
        try {
          const response = await fetch(`/api/sermons/${sermonId}`);
          if (response.ok) {
            const sermon = await response.json();
            
            // Используем определенную выше переменную focusedColumn
            const { getExportContent: exportFn } = await import('@/utils/exportContent');
            
            // Если мы определили focusedColumn, используем её, иначе экспортируем всю проповедь
            if (focusedColumn) {
              console.log('Exporting with focusedColumn:', focusedColumn);
              return exportFn(sermon, focusedColumn, { format });
            } else {
              // Если не удалось определить колонку, просто экспортируем весь контент
              return exportFn(sermon, undefined, { format });
            }
          }
        } catch (error) {
          console.error("Error fetching sermon for format change:", error);
        }
      }
      
      return originalContent;
    } catch (error) {
      console.error("Error generating export content with format:", error);
      return "";
    }
  };

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
          getExportContent={getFormattedContent}
          onClose={() => setShowTxtModal(false)}
        />
      )}
    </div>
  );
}