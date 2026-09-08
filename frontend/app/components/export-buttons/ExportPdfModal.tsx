"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormButton } from "@/components/ui/FormDialog";

import { ExportDialog } from "./ExportDialog";
import { useExportPreview } from "./useExportPreview";

import type { ExportPdfModalProps } from "./types";

export function ExportPdfModal({
  isOpen,
  onClose,
  getContent,
  title,
}: ExportPdfModalProps) {
  const { t } = useTranslation();
  const { content, isLoading: isPreparing, error: previewError } = useExportPreview(isOpen, getContent);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const isLoading = isPreparing || isExporting;
  const error = previewError || exportError;
  const contentRef = useRef<HTMLDivElement>(null);
  const exportSession = useRef(0);
  useEffect(() => {
    setIsExporting(false);
    setExportError(false);
    return () => { exportSession.current += 1; };
  }, [isOpen, getContent]);

  const handleExportPdf = async () => {
    const element = contentRef.current;
    if (!element || isLoading || error) {
      return;
    }

    const session = exportSession.current;
    try {
      setIsExporting(true);
      setExportError(false);
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      if (session !== exportSession.current) return;
      const canvas = await html2canvas(element, {
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

    } catch (err) {
      console.error("Error generating PDF:", err);
      if (session === exportSession.current) setExportError(true);
    } finally {
      if (session === exportSession.current) setIsExporting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <ExportDialog format="PDF" title={t('export.pdfTitle', 'Export to PDF')} onClose={onClose} isLoading={isLoading}
      error={error ? t('export.errorPreparingPdf', 'Error preparing PDF content') : undefined}
      actions={<>
        <FormButton variant="secondary" onClick={onClose}>{t('actions.cancel')}</FormButton>
        <FormButton onClick={handleExportPdf} disabled={isLoading || error} aria-busy={isExporting}>
          {t('export.savePdf', 'Save as PDF')}
        </FormButton>
      </>}
    >
      <div ref={contentRef} style={{ backgroundColor: 'white', color: 'black' }}>{content}</div>
    </ExportDialog>
  );
}
