import type { CopyStatus, SermonSectionKey } from "./types";

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

export const SECTION_TONE_CLASSES: Record<
  SermonSectionKey,
  {
    border: string;
    surface: string;
    text: string;
  }
> = {
  introduction: {
    border: "border-amber-200 dark:border-amber-800",
    surface: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-200",
  },
  main: {
    border: "border-blue-200 dark:border-blue-800",
    surface: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-800 dark:text-blue-200",
  },
  conclusion: {
    border: "border-green-200 dark:border-green-800",
    surface: "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20",
    text: "text-green-800 dark:text-green-200",
  },
};

export const MARKDOWN_SECTION_VARIANT_CLASSES: Record<SermonSectionKey, string> = {
  introduction: "prose-introduction introduction-section",
  main: "prose-main main-section",
  conclusion: "prose-conclusion conclusion-section",
};

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
