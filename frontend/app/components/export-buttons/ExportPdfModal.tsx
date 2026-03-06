"use client";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ExportPdfModalProps } from "./types";

export function ExportPdfModal({
  isOpen,
  onClose,
  getContent,
  title,
}: ExportPdfModalProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [content, setContent] = useState<React.ReactNode | null>(null);
  const modalId = useRef(`export-pdf-modal-${Math.random().toString(36).substring(2, 9)}`);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setIsLoading(true);
    setError(false);

    getContent()
      .then((nextContent) => {
        setContent(nextContent);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error preparing PDF content:", err);
        setError(true);
        setIsLoading(false);
      });
  }, [getContent, isOpen]);

  const handleExportPdf = async () => {
    if (!contentRef.current) {
      return;
    }

    try {
      setIsLoading(true);

      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = 30;

      pdf.addImage(imgData, "PNG", imgX, imgY, imgWidth * ratio, imgHeight * ratio);
      pdf.save(`${title || "export"}.pdf`);

      setIsLoading(false);
    } catch (err) {
      console.error("Error generating PDF:", err);
      setError(true);
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

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
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 id="export-pdf-modal-title" className="text-lg sm:text-xl font-semibold">
            {t("export.pdfTitle", "Export to PDF")}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="bg-white rounded-lg p-3 sm:p-4 mb-4 flex-grow overflow-y-auto relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-700/80 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          )}

          {error ? (
            <div className="text-red-500">{t("export.errorPreparingPdf", "Error preparing PDF content")}</div>
          ) : (
            <div
              ref={contentRef}
              className="transition-opacity duration-200"
              style={{ backgroundColor: "white", color: "black" }}
            >
              {content}
            </div>
          )}
        </div>

        <div className="flex gap-2 sm:gap-3 justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            {t("actions.cancel")}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isLoading || error}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("export.savePdf", "Save as PDF")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
