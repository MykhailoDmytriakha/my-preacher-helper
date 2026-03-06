import type { Orientation } from "./types";

export const AUDIO_BUTTON_LABEL = "Audio (Beta)";

export const LAYOUT_CLASS_BY_ORIENTATION: Record<Orientation, string> = {
  horizontal: "flex-row",
  vertical: "flex-col",
};

export const TOOLTIP_POSITION_BY_ORIENTATION: Record<Orientation, string> = {
  horizontal: "tooltiptext-top",
  vertical: "tooltiptext-right",
};

export const ACTIVE_BUTTON_CLASS = "bg-blue-500 text-white shadow-sm";
export const INACTIVE_BUTTON_CLASS =
  "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600";
