"use client";

import { AudioLines, File, FileText, FileType, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import ActionButton, { ACTION_BUTTON_SLOT_CLASS } from "@/components/common/ActionButton";

import {
  getAudioIconButtonClassName,
  getAudioTextButtonClassName,
  getPdfIconButtonClassName,
  getPdfTextButtonClassName,
  getTxtIconButtonClassName,
  getTxtTextButtonClassName,
  getWordIconButtonClassName,
  getWordTextButtonClassName,
} from "./classNames";
import { AUDIO_BUTTON_LABEL, LAYOUT_CLASS_BY_ORIENTATION, TOOLTIP_POSITION_BY_ORIENTATION } from "./constants";

import type { ExportButtonsLayoutProps } from "./types";

export function ExportButtonsLayout({
  onTxtClick,
  onPdfClick,
  onWordClick,
  onAudioClick,
  orientation = "horizontal",
  isPdfAvailable = false,
  isWordDisabled = false,
  isAudioEnabled = false,
  isPreached = false,
  variant = "default",
  extraButtons,
  slotClassName,
}: ExportButtonsLayoutProps) {
  const { t } = useTranslation();
  const translate = (key: string, fallback: string) => {
    const result = t(key, { defaultValue: fallback });
    return result === key ? fallback : result;
  };

  const layoutClass = LAYOUT_CLASS_BY_ORIENTATION[orientation];
  const tooltipPositionClass = TOOLTIP_POSITION_BY_ORIENTATION[orientation];
  const pdfExportLabel = translate("export.pdfTitle", "Export to PDF");
  const pdfExportComingSoonLabel = translate("export.pdfTitleComingSoon", "Export to PDF (coming soon)");
  const wordExportLabel = translate("export.wordTitle", "Export to Word");
  const txtExportLabel = translate("export.txtTitle", "Export to TXT");
  const pdfButtonLabel = translate("export.pdfButton", "PDF");
  const txtButtonLabel = translate("export.txtButton", "TXT");
  const wordButtonLabel = translate("export.wordButton", "Word");
  const soonAvailableLabel = translate("export.soonAvailable", "Coming soon!");
  const noPlanForWordLabel = translate("export.noPlanForWord", "Plan required for Word");
  const pdfAriaLabel = isPdfAvailable ? pdfExportLabel : pdfExportComingSoonLabel;
  const audioLabel = translate("export.audioButton", AUDIO_BUTTON_LABEL);

  if (variant === "icon") {
    const pdfTooltipText = isPdfAvailable ? pdfButtonLabel : soonAvailableLabel;
    const wordTooltipText = isWordDisabled ? noPlanForWordLabel : wordButtonLabel;

    return (
      <div className={`flex flex-wrap ${layoutClass} gap-2 w-full sm:w-auto flex-shrink-0 items-center`}>
        <div className="tooltip">
          <button
            onClick={onTxtClick}
            className={`p-1.5 rounded-md transition-colors ${getTxtIconButtonClassName(isPreached)}`}
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
            className={`p-1.5 rounded-md transition-colors ${getPdfIconButtonClassName(isPdfAvailable, isPreached)}`}
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
            className={`p-1.5 rounded-md transition-colors ${getWordIconButtonClassName(isWordDisabled, isPreached)}`}
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

  const textButtonSlotClassName = slotClassName || ACTION_BUTTON_SLOT_CLASS;

  return (
    <div className={`flex flex-wrap ${layoutClass} gap-1.5 w-full sm:w-auto flex-shrink-0`}>
      {extraButtons}

      <div className={textButtonSlotClassName}>
        <ActionButton onClick={onTxtClick} className={getTxtTextButtonClassName(isPreached)}>
          {txtButtonLabel}
        </ActionButton>
      </div>

      <div className={`tooltip ${textButtonSlotClassName}`}>
        <ActionButton
          onClick={onPdfClick}
          disabled={!isPdfAvailable}
          className={getPdfTextButtonClassName(isPdfAvailable, isPreached)}
          aria-label={pdfAriaLabel}
        >
          {pdfButtonLabel}
        </ActionButton>
        {!isPdfAvailable && <span className={`tooltiptext ${tooltipPositionClass}`}>{soonAvailableLabel}</span>}
      </div>

      <div className={`tooltip ${textButtonSlotClassName}`}>
        <ActionButton
          onClick={onWordClick}
          disabled={isWordDisabled}
          className={getWordTextButtonClassName(isWordDisabled, isPreached)}
          aria-label={wordExportLabel}
        >
          {wordButtonLabel}
        </ActionButton>
        {isWordDisabled && <span className={`tooltiptext ${tooltipPositionClass}`}>{noPlanForWordLabel}</span>}
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
          <span className={`tooltiptext ${tooltipPositionClass}`}>{audioLabel}</span>
        </div>
      )}
    </div>
  );
}
