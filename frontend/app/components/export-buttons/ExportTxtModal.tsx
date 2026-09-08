"use client";

import { Check } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { FormButton } from "@/components/ui/FormDialog";
import Switch from "@/components/ui/Switch";
import { useClipboard } from "@/hooks/useClipboard";
import { downloadBlobToDevice } from "@/utils/download";
import { sanitizeMarkdown } from "@/utils/markdownUtils";

import { ACTIVE_BUTTON_CLASS, INACTIVE_BUTTON_CLASS } from "./constants";
import { ExportDialog } from "./ExportDialog";
import { useExportPreview } from "./useExportPreview";

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
  const loadContent = useCallback(async () => content || getContent(activeFormat, { includeTags: showTags, type: exportType }), [content, getContent, activeFormat, showTags, exportType]);
  const { content: preparedContent, isLoading, error } = useExportPreview(isOpen, loadContent);
  const exportContent = preparedContent ?? '';
  const { isCopied, copyToClipboard, reset: resetCopy } = useClipboard({
    onError: (cause) => console.error("Failed to copy text:", cause),
  });
  useEffect(() => resetCopy(), [isOpen, exportContent, resetCopy]);

  const handleCopy = () => {
    if (!isCopied) void copyToClipboard(exportContent);
  };

  const handleDownload = () => {
    downloadBlobToDevice(new Blob([exportContent], { type: 'text/plain' }), activeFormat === 'plain' ? 'export.txt' : 'export.md');
  };

  if (!isOpen) {
    return null;
  }

  return (
    <ExportDialog format="TXT" title={t('export.txtTitle')} onClose={onClose} isLoading={isLoading}
      error={error ? t('export.prepareError') : undefined}
      controls={
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
                <Switch
                  onClick={() => setShowTags((current) => !current)}
                  checked={showTags}
                  aria-label={showTags ? t("export.hideTags") : t("export.showTags")}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>

      }
      actions={<>
          <FormButton
            variant={isCopied ? 'primary' : 'secondary'}
            tone="emerald"
            onClick={handleCopy}
            disabled={isLoading || !exportContent || error || isCopied}
          >
            {isCopied ? (
              <>
                <Check size={16} />
                {t("export.copied", "Copied!")}
              </>
            ) : (
              t("export.copy", "Copy")
            )}
          </FormButton>
          <FormButton
            onClick={handleDownload}
            disabled={isLoading || !exportContent || error}

          >
            {activeFormat === "plain" ? t("export.downloadTxt") : t("export.downloadMarkdown", "Download MD")}
          </FormButton>
      </>}
    >
      {activeFormat === 'plain' ? (
              <pre className="whitespace-pre-wrap font-mono text-xs sm:text-sm">{exportContent}</pre>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizeMarkdown(exportContent)}</ReactMarkdown>
              </div>)}
    </ExportDialog>
  );
}
