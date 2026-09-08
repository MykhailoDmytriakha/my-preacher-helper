"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import "@locales/i18n";

import AudioExportModal from "@/components/AudioExportModal";
import { debugLog } from "@/utils/debugMode";

import { ExportButtonsLayout } from "./export-buttons/ExportButtonsLayout";
import { ExportPdfModal } from "./export-buttons/ExportPdfModal";
import { ExportTxtModal } from "./export-buttons/ExportTxtModal";
import { TooltipStyles } from "./export-buttons/TooltipStyles";

import type { ExportButtonsProps } from "./export-buttons/types";

export { ExportPdfModal, ExportTxtModal } from "./export-buttons";

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
  variant = "default",
  enableAudio = false,
  sermonTitle = "",
  planData,
  hasPlan: initialHasPlan,
  focusedSection,
  extraButtons,
  slotClassName,
}: ExportButtonsProps) {
  const [showTxtModal, setShowTxtModal] = useState(showTxtModalDirectly || false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [isWordExporting, setIsWordExporting] = useState(false);
  const wordExportPending = useRef(false);

  const hasPlan = initialHasPlan !== undefined ? initialHasPlan : !!planData;
  const isPdfAvailable = !!getPdfContent && !disabledFormats.includes("pdf");
  const isTxtDisabled = disabledFormats.includes("txt");
  const isWordDisabled = !planData || disabledFormats.includes("word");

  useEffect(() => {
    setShowTxtModal(showTxtModalDirectly || false);
  }, [showTxtModalDirectly]);

  const handleTxtClick = (event: MouseEvent) => {
    if (isTxtDisabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setShowTxtModal(true);
  };

  const handleCloseTxtModal = () => {
    setShowTxtModal(false);

    if (onTxtModalClose) {
      onTxtModalClose();
    }
  };

  const handlePdfClick = () => {
    if (!isPdfAvailable) {
      return;
    }

    debugLog("ExportButtons: open PDF modal");
    setShowPdfModal(true);
  };

  const handleClosePdfModal = () => {
    debugLog("ExportButtons: close PDF modal");
    setShowPdfModal(false);
  };

  const handleWordClick = async () => {
    if (isWordDisabled || !planData || wordExportPending.current) {
      return;
    }

    wordExportPending.current = true;
    setIsWordExporting(true);
    try {
      const { exportToWord } = await import('../../utils/wordExport');
      await exportToWord({
        data: planData,
        filename: `sermon-plan-${sermonTitle.replace(/[^a-zA-Zа-яА-Я0-9]/g, "-").toLowerCase()}.docx`,
        focusedSection,
      });
    } catch (error) {
      console.error("Error exporting to Word:", error);
    } finally {
      wordExportPending.current = false;
      setIsWordExporting(false);
    }
  };

  return (
    <div className={className} data-testid="export-buttons-container">
      <TooltipStyles />
      <ExportButtonsLayout
        onTxtClick={handleTxtClick}
        onPdfClick={handlePdfClick}
        onWordClick={handleWordClick}
        onAudioClick={enableAudio ? () => setShowAudioModal(true) : undefined}
        orientation={orientation}
        isPdfAvailable={isPdfAvailable}
        isWordDisabled={isWordDisabled}
        isWordExporting={isWordExporting}
        isAudioEnabled={enableAudio}
        isPreached={isPreached}
        variant={variant}
        extraButtons={extraButtons}
        slotClassName={slotClassName}
      />

      <ExportTxtModal
        isOpen={showTxtModal}
        onClose={handleCloseTxtModal}
        getContent={getExportContent}
        hasPlan={hasPlan}
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
          onClose={() => setShowAudioModal(false)}
          sermonId={sermonId}
          sermonTitle={sermonTitle || title}
        />
      )}
    </div>
  );
}
