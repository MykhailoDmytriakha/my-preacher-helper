"use client";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { AudioLines, Check, File, FileText, FileType, Volume2, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@locales/i18n";

import AudioExportModal from "@/components/AudioExportModal";
import ActionButton, { ACTION_BUTTON_SLOT_CLASS } from "@/components/common/ActionButton";
import { debugLog } from "@/utils/debugMode";
import { sanitizeMarkdown } from "@/utils/markdownUtils";

import { PlanData, exportToWord } from "../../utils/wordExport";

const AUDIO_BUTTON_LABEL = 'Audio (Beta)';



interface ExportButtonsLayoutProps {
  onTxtClick: (e: React.MouseEvent) => void;
  onPdfClick: () => void;
  onWordClick: () => void;
  onAudioClick?: () => void;
  orientation?: "horizontal" | "vertical";
  isPdfAvailable?: boolean;
  isWordDisabled?: boolean;
  isAudioEnabled?: boolean;
  isPreached?: boolean;
  variant?: 'default' | 'icon';
  extraButtons?: React.ReactNode;
  slotClassName?: string;
}

type Orientation = NonNullable<ExportButtonsLayoutProps['orientation']>;

const LAYOUT_CLASS_BY_ORIENTATION: Record<Orientation, string> = {
  horizontal: "flex-row",
  vertical: "flex-col",
};

const TOOLTIP_POSITION_BY_ORIENTATION: Record<Orientation, string> = {
  horizontal: "tooltiptext-top",
  vertical: "tooltiptext-right",
};

const getTxtIconButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
    : "text-gray-400 hover:bg-blue-50 hover:text-blue-600 dark:text-gray-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400";

const getPdfIconButtonClassName = (isPdfAvailable: boolean, isPreached: boolean) => {
  if (!isPdfAvailable) {
    return "text-gray-300 cursor-not-allowed dark:text-gray-700";
  }
  return isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-purple-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-purple-400"
    : "text-gray-400 hover:bg-purple-50 hover:text-purple-600 dark:text-gray-500 dark:hover:bg-purple-900/30 dark:hover:text-purple-400";
};

const getWordIconButtonClassName = (isWordDisabled: boolean, isPreached: boolean) => {
  if (isWordDisabled) {
    return "text-gray-300 cursor-not-allowed dark:text-gray-700";
  }
  return isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-green-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-green-400"
    : "text-gray-400 hover:bg-green-50 hover:text-green-600 dark:text-gray-500 dark:hover:bg-green-900/30 dark:hover:text-green-400";
};

const getAudioIconButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-orange-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-orange-400"
    : "text-gray-400 hover:bg-orange-50 hover:text-orange-600 dark:text-gray-500 dark:hover:bg-orange-900/30 dark:hover:text-orange-400";

const getTxtTextButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900 dark:hover:text-blue-300"
    : "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800";

const getPdfTextButtonClassName = (isPdfAvailable: boolean, isPreached: boolean) => {
  if (isPreached) {
    return isPdfAvailable
      ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-900 dark:hover:text-purple-300"
      : "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 opacity-50 cursor-not-allowed";
  }
  return isPdfAvailable
    ? "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800"
    : "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 opacity-50 cursor-not-allowed";
};

const getWordTextButtonClassName = (isWordDisabled: boolean, isPreached: boolean) => {
  if (isWordDisabled) {
    return "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-50";
  }
  return isPreached
    ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900 dark:hover:text-green-300"
    : "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800";
};

const getAudioTextButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-900 dark:hover:text-orange-300"
    : "bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800";

function ExportButtonsLayout({
  onTxtClick,
  onPdfClick,
  onWordClick,
  onAudioClick,
  orientation = "horizontal",
  isPdfAvailable = false,
  isWordDisabled = false,
  isAudioEnabled = false,
  isPreached = false,
  variant = 'default',
  extraButtons,
  slotClassName,
}: ExportButtonsLayoutProps) {
  const { t } = useTranslation();
  const translate = (key: string, fallback: string) => {
    const result = t(key, { defaultValue: fallback });
    return result === key ? fallback : result;
  };
  const layoutClass = LAYOUT_CLASS_BY_ORIENTATION[orientation];
  const pdfTooltipPositionClass = TOOLTIP_POSITION_BY_ORIENTATION[orientation];
  const pdfExportLabel = translate('export.pdfTitle', 'Export to PDF');
  const pdfExportComingSoonLabel = translate('export.pdfTitleComingSoon', 'Export to PDF (coming soon)');
  const wordExportLabel = translate('export.wordTitle', 'Export to Word');
  const txtExportLabel = translate('export.txtTitle', 'Export to TXT');
  const pdfButtonLabel = translate('export.pdfButton', 'PDF');
  const txtButtonLabel = translate('export.txtButton', 'TXT');
  const wordButtonLabel = translate('export.wordButton', 'Word');
  const soonAvailableLabel = translate('export.soonAvailable', 'Coming soon!');
  const noPlanForWordLabel = translate('export.noPlanForWord', 'Plan required for Word');
  const pdfAriaLabel = isPdfAvailable ? pdfExportLabel : pdfExportComingSoonLabel;
  const audioLabel = translate('export.audioButton', AUDIO_BUTTON_LABEL);

  if (variant === 'icon') {
    const txtIconButtonClassName = getTxtIconButtonClassName(isPreached);
    const pdfIconButtonClassName = getPdfIconButtonClassName(isPdfAvailable, isPreached);
    const wordIconButtonClassName = getWordIconButtonClassName(isWordDisabled, isPreached);
    const pdfTooltipText = isPdfAvailable ? pdfButtonLabel : soonAvailableLabel;
    const wordTooltipText = isWordDisabled ? noPlanForWordLabel : wordButtonLabel;

    return (
      <div className={`flex ${layoutClass} gap-2 w-full sm:w-auto flex-shrink-0 items-center`}>
        <div className="tooltip">
          <button
            onClick={onTxtClick}
            className={`p-1.5 rounded-md transition-colors ${txtIconButtonClassName
              }`}
            aria-label={txtExportLabel}
          >
            <FileText className="w-4 h-4" />
          </button>
          <span className="tooltiptext tooltiptext-top">{txtButtonLabel}</span>
        </div>

        <div className="tooltip">
          <button
            onClick={onPdfClick}
            disabled={!isPdfAvailable}
            className={`p-1.5 rounded-md transition-colors ${pdfIconButtonClassName
              }`}
            aria-label={pdfAriaLabel}
          >
            <File className="w-4 h-4" />
          </button>
          <span className="tooltiptext tooltiptext-top">{pdfTooltipText}</span>
        </div>

        <div className="tooltip">
          <button
            onClick={onWordClick}
            disabled={isWordDisabled}
            className={`p-1.5 rounded-md transition-colors ${wordIconButtonClassName
              }`}
            aria-label={wordExportLabel}
          >
            <FileType className="w-4 h-4" />
          </button>
          <span className="tooltiptext tooltiptext-top">{wordTooltipText}</span>
        </div>

        {isAudioEnabled && onAudioClick && (
          <div className="tooltip">
            <button
              onClick={onAudioClick}
              className={`p-1.5 rounded-md transition-colors ${getAudioIconButtonClassName(isPreached)}`}
              aria-label={audioLabel}
            >
              <Volume2 className="w-4 h-4" />
            </button>
            <span className="tooltiptext tooltiptext-top">{audioLabel}</span>
          </div>
        )}
      </div>
    );
  }

  const txtTextButtonClassName = getTxtTextButtonClassName(isPreached);
  const pdfTextButtonClassName = getPdfTextButtonClassName(isPdfAvailable, isPreached);
  const wordTextButtonClassName = getWordTextButtonClassName(isWordDisabled, isPreached);
  const textButtonSlotClassName = slotClassName || ACTION_BUTTON_SLOT_CLASS;

  return (
    <div className={`flex ${layoutClass} gap-1.5 w-full sm:w-auto flex-shrink-0`}>
      {extraButtons}

      <div className={textButtonSlotClassName}>
        <ActionButton
          onClick={onTxtClick}
          className={txtTextButtonClassName}
        >
          {txtButtonLabel}
        </ActionButton>
      </div>

      <div className={`tooltip ${textButtonSlotClassName}`}>
        <ActionButton
          onClick={onPdfClick}
          disabled={!isPdfAvailable}
          className={pdfTextButtonClassName}
          aria-label={pdfAriaLabel}
        >
          {pdfButtonLabel}
        </ActionButton>
        {!isPdfAvailable && (
          <span className={`tooltiptext ${pdfTooltipPositionClass}`}>
            {soonAvailableLabel}
          </span>
        )}
      </div>

      <div className={`tooltip ${textButtonSlotClassName}`}>
        <ActionButton
          onClick={onWordClick}
          disabled={isWordDisabled}
          className={wordTextButtonClassName}
          aria-label={wordExportLabel}
        >
          {wordButtonLabel}
        </ActionButton>
        {isWordDisabled && (
          <span className={`tooltiptext ${pdfTooltipPositionClass}`}>
            {noPlanForWordLabel}
          </span>
        )}
      </div>

      {isAudioEnabled && onAudioClick && (
        <div className={`tooltip ${textButtonSlotClassName}`}>
          <ActionButton
            onClick={onAudioClick}
            className={getAudioTextButtonClassName(isPreached)}
            aria-label={audioLabel}
          >
            <AudioLines className="w-4 h-4" />
          </ActionButton>
          <span className={`tooltiptext ${pdfTooltipPositionClass}`}>
            {audioLabel}
          </span>
        </div>
      )}
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
    const file = new Blob([exportContent], { type: 'text/plain' });
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
            <X size={20} />
          </button>
        </div>

        {/* Options row - Format selection and Tags toggle */}
        <div className="flex flex-wrap items-center mb-4 text-sm flex-shrink-0 gap-4">
          {/* Format selection */}
          <div className="flex items-center">
            <span className="mr-2">{t('export.format')}:</span>
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
              <button
                className={`px-3 py-1 rounded ${activeFormat === 'plain'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                onClick={() => handleFormatChange('plain')}
                disabled={isLoading}
              >
                {t('export.formatPlain')}
              </button>
              <button
                className={`px-3 py-1 rounded ${activeFormat === 'markdown'
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
                className={`${showTags ? 'translate-x-6' : 'translate-x-1'
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
            <X size={20} />
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
  /** Enable audio export button (beta feature) */
  enableAudio?: boolean;
  /** Sermon title for audio filename - required if enableAudio is true */
  sermonTitle?: string;
  /** Structured plan data for Word export */
  planData?: PlanData;
  /** Section to export in Focus Mode */
  focusedSection?: string;
  /** Optional extra buttons rendered before export actions */
  extraButtons?: React.ReactNode;
  /** Optional slot class override for action sizing */
  slotClassName?: string;
}

const TooltipStyles = () => (
  <style jsx global>{`
    /* Base tooltip styles */
    .tooltip {
      position: relative;
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
  sermonId,
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
  enableAudio = false,
  sermonTitle = '',
  planData,
  focusedSection,
  extraButtons,
  slotClassName,
}: ExportButtonsContainerProps) {
  const [showTxtModal, setShowTxtModal] = useState(showTxtModalDirectly || false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);

  // Determine if PDF is available based on the disabledFormats prop
  const isPdfAvailable = !!getPdfContent && !disabledFormats.includes('pdf');
  // Similarly, check if TXT is disabled (though less likely needed)
  const isTxtDisabled = disabledFormats.includes('txt');
  // Word is disabled if no planData is provided (since Word only exports Plans now)
  const isWordDisabled = !planData || disabledFormats.includes('word');

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
    debugLog("ExportButtons: open PDF modal");
    setShowPdfModal(true);
  };

  const handleClosePdfModal = () => {
    debugLog("ExportButtons: close PDF modal");
    setShowPdfModal(false);
  };


  const handleWordClick = async () => {
    if (isWordDisabled || !planData) return;

    try {
      await exportToWord({
        data: planData,
        filename: `sermon-plan-${sermonTitle.replace(/[^a-zA-Zа-яА-Я0-9]/g, '-').toLowerCase()}.docx`,
        focusedSection: focusedSection
      });
    } catch (error) {
      console.error('Error exporting to Word:', error);
    }
  };

  const handleAudioClick = () => {
    setShowAudioModal(true);
  };

  const handleCloseAudioModal = () => {
    setShowAudioModal(false);
  };

  return (
    <div className={className} data-testid="export-buttons-container">
      <TooltipStyles />
      <ExportButtonsLayout
        onTxtClick={handleTxtClick}
        onPdfClick={handlePdfClick}
        onWordClick={handleWordClick}
        onAudioClick={enableAudio ? handleAudioClick : undefined}
        orientation={orientation}
        isPdfAvailable={isPdfAvailable}
        isWordDisabled={isWordDisabled}
        isAudioEnabled={enableAudio}
        isPreached={isPreached}
        variant={variant}
        extraButtons={extraButtons}
        slotClassName={slotClassName}
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

      {enableAudio && (
        <AudioExportModal
          isOpen={showAudioModal}
          onClose={handleCloseAudioModal}
          sermonId={sermonId}
          sermonTitle={sermonTitle || title}
        />
      )}
    </div>
  );
}
