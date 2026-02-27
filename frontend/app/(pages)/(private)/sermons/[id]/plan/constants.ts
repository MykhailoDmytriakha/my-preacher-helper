import type { CopyStatus } from "./types";

export const TRANSLATION_SECTIONS_MAIN = "sections.main";
export const TRANSLATION_SECTIONS_CONCLUSION = "sections.conclusion";

// Translation key constants for frequently used strings
export const TRANSLATION_KEYS = {
  NO_CONTENT: "plan.noContent",
  SECTIONS: {
    INTRODUCTION: "sections.introduction",
    MAIN: "sections.main",
    CONCLUSION: "sections.conclusion",
  },
  COMMON: {
    SCRIPTURE: "common.scripture",
  },
  PLAN: {
    COPY_SUCCESS: "plan.copySuccess",
    COPY_ERROR: "plan.copyError",
    NO_SERMON_POINTS: "plan.noSermonPoints",
    VIEW_MODE: "plan.viewMode",
    EDIT_MODE: "plan.editMode",
  },
  COPY: {
    COPYING: "copy.copying",
    COPY_FORMATTED: "copy.copyFormatted",
  },
} as const;

// Status constants for immersive copy
export const COPY_STATUS = {
  IDLE: "idle",
  COPYING: "copying",
  SUCCESS: "success",
  ERROR: "error",
} as const;

// Section names constants
export const SECTION_NAMES = {
  INTRODUCTION: "introduction",
  MAIN: "main",
  CONCLUSION: "conclusion",
} as const;

export const copyButtonClasses =
  "flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700";

export const copyButtonStatusClasses: Record<CopyStatus, string> = {
  idle: "",
  copying: "opacity-80 cursor-wait",
  success: "border-2 border-green-500 bg-green-600 hover:bg-green-700",
  error: "border-2 border-red-500 bg-red-600 hover:bg-red-700",
};

// Hover style for section-colored action buttons
export const sectionButtonStyles = `
  .section-button {
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }
  .section-button:hover {
    background-color: var(--hover-bg) !important;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  .section-button:active {
    transform: translateY(0);
    background-color: var(--active-bg) !important;
    box-shadow: none;
  }
`;
