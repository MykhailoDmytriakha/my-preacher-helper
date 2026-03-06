"use client";

import { Check, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sanitizeMarkdown } from "@/utils/markdownUtils";

import { ACTIVE_BUTTON_CLASS, INACTIVE_BUTTON_CLASS } from "./constants";

import type { ExportTxtModalProps } from "./types";

export function ExportTxtModal({
  isOpen,
  onClose,
  content,
  getContent,
  format = "plain",
  hasPlan = false,
}: ExportTxtModalProps) {
  const { t } = useTranslation();
  const [activeFormat, setActiveFormat] = useState<"plain" | "markdown">(format);
  const [exportType, setExportType] = useState<"thoughts" | "plan">("thoughts");
  const [showTags, setShowTags] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [exportContent, setExportContent] = useState("");
  const [error, setError] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const modalId = useRef(`export-modal-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    return () => {
      setIsLoading(false);
      setExportContent("");
      setError(false);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setIsLoading(true);
    setError(false);

    if (content) {
      setExportContent(content);
      setIsLoading(false);
      return;
    }

    getContent(activeFormat, { includeTags: showTags, type: exportType })
      .then((result) => {
        setExportContent(result);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error getting export content:", err);
        setExportContent("Error preparing export");
        setError(true);
        setIsLoading(false);
      });
  }, [activeFormat, content, exportType, getContent, isOpen, showTags]);

  const handleCopy = () => {
    if (isCopied) {
      return;
    }

    navigator.clipboard
      .writeText(exportContent)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 1500);
      })
      .catch((err) => {
        console.error("Failed to copy text:", err);
      });
  };

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([exportContent], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `export.${activeFormat}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  if (!isOpen) {
    return null;
  }

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
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 id="export-modal-title" className="text-lg sm:text-xl font-semibold">
            {t("export.txtTitle")}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4 mb-4 text-sm flex-shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            {hasPlan && (
              <div className="flex items-center">
                <span className="mr-2">{t("export.exportContent", "Export content")}:</span>
                <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
                  <button
                    className={`px-3 py-1 rounded transition-colors ${exportType === "thoughts" ? ACTIVE_BUTTON_CLASS : INACTIVE_BUTTON_CLASS}`}
                    onClick={() => setExportType("thoughts")}
                    disabled={isLoading}
                  >
                    {t("export.thoughtsOption", "Thoughts")}
                  </button>
                  <button
                    className={`px-3 py-1 rounded transition-colors ${exportType === "plan" ? ACTIVE_BUTTON_CLASS : INACTIVE_BUTTON_CLASS}`}
                    onClick={() => setExportType("plan")}
                    disabled={isLoading}
                  >
                    {t("export.planOption", "Plan")}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center">
              <span className="mr-2">{t("export.format", "Format")}:</span>
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
                <button
                  className={`px-3 py-1 rounded transition-colors ${activeFormat === "plain" ? ACTIVE_BUTTON_CLASS : INACTIVE_BUTTON_CLASS}`}
                  onClick={() => setActiveFormat("plain")}
                  disabled={isLoading}
                >
                  {t("export.formatPlain", "Plain Text")}
                </button>
                <button
                  className={`px-3 py-1 rounded transition-colors ${activeFormat === "markdown" ? ACTIVE_BUTTON_CLASS : INACTIVE_BUTTON_CLASS}`}
                  onClick={() => setActiveFormat("markdown")}
                  disabled={isLoading}
                >
                  {t("export.formatMarkdown", "Markdown")}
                </button>
              </div>
            </div>

            {exportType === "thoughts" && (
              <div className="flex items-center ml-auto">
                <span className="mr-2">{t("export.includeTags", "Include tags")}:</span>
                <button
                  onClick={() => setShowTags((current) => !current)}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  role="switch"
                  aria-checked={showTags}
                  aria-label={showTags ? t("export.hideTags") : t("export.showTags")}
                  style={{ backgroundColor: showTags ? "#3b82f6" : "#e5e7eb" }}
                  disabled={isLoading}
                >
                  <span
                    className={`${showTags ? "translate-x-6" : "translate-x-1"} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                  />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 sm:p-4 mb-4 flex-grow overflow-y-auto relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-700/80 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          )}
          <div className={`transition-opacity duration-200 ${isLoading ? "opacity-30" : "opacity-100"}`}>
            {error ? (
              <div className="text-red-500">{exportContent}</div>
            ) : activeFormat === "plain" ? (
              <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm">{exportContent}</pre>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeMarkdown(exportContent)}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 justify-end flex-shrink-0">
          <button
            onClick={handleCopy}
            disabled={isLoading || !exportContent || error || isCopied}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 text-sm rounded-md transition-all duration-150 flex items-center justify-center gap-1.5 min-w-[100px] ${isCopied ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300" : "bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500"}`}
          >
            {isCopied ? (
              <>
                <Check size={16} />
                {t("export.copied", "Copied!")}
              </>
            ) : (
              t("export.copy", "Copy")
            )}
          </button>
          <button
            onClick={handleDownload}
            disabled={isLoading || !exportContent || error}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {activeFormat === "plain" ? t("export.downloadTxt") : t("export.downloadMarkdown", "Download MD")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
