
import { LOCAL_THOUGHT_PREFIX } from "@/utils/pendingThoughtsStore";
import { getCanonicalTagForSection } from "@/utils/tagUtils";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

import {
  BG_GRAY_LIGHT_DARK,
  BG_GRAY_LIGHTER_DARK,
  POINT_AUDIO_SECTION_IDS,
  SECTION_NAV_ORDER,
} from "./constants";

import type {
  ColumnSectionId,
  OpenPointEditorArgs,
  PlaceholderColors,
  SectionType,
  Translate,
} from "./types";
import type { Item } from "@/models/models";
import type { CSSProperties } from "react";

type OutlineInsertAccent = {
  badgeClassName: string;
  badgeShadowStyle: CSSProperties;
  lineStyle: CSSProperties;
};

const getSectionPalette = (sectionId: string) => {
  if (sectionId === "introduction") return SERMON_SECTION_COLORS.introduction;
  if (sectionId === "main") return SERMON_SECTION_COLORS.mainPart;
  if (sectionId === "conclusion") return SERMON_SECTION_COLORS.conclusion;
  return null;
};

export const isColumnSectionId = (sectionId: string): sectionId is ColumnSectionId =>
  POINT_AUDIO_SECTION_IDS.includes(sectionId as ColumnSectionId);

export const getPlaceholderColors = (
  containerId: string,
  headerColor?: string
): PlaceholderColors => {
  if (headerColor) {
    return {
      border: "border-2 border-opacity-30",
      bg: BG_GRAY_LIGHT_DARK,
      header: BG_GRAY_LIGHTER_DARK,
      headerText: "text-gray-700 dark:text-gray-200",
    };
  }

  const palette = getSectionPalette(containerId);
  if (!palette) {
    return {
      border: "border-2 border-gray-200 dark:border-gray-700",
      bg: BG_GRAY_LIGHT_DARK,
      header: BG_GRAY_LIGHTER_DARK,
      headerText: "text-gray-700 dark:text-gray-200",
    };
  }

  return {
    border: `border-2 ${palette.border.split(" ")[0]} dark:${palette.darkBorder}`,
    bg: `${palette.bg} dark:${palette.darkBg}`,
    header: `${palette.bg} dark:${palette.darkBg}`,
    headerText: `${palette.text} dark:${palette.darkText}`,
  };
};

export const getForceTagForContainer = (containerId: string) => {
  if (containerId === "introduction") return getCanonicalTagForSection("introduction");
  if (containerId === "main") return getCanonicalTagForSection("main");
  if (containerId === "conclusion") return getCanonicalTagForSection("conclusion");
  return undefined;
};

export const isPointAudioSection = (containerId: string): containerId is ColumnSectionId =>
  isColumnSectionId(containerId);

export const getReviewToggleLabel = (isReviewed: boolean, t: Translate) => {
  if (isReviewed) {
    return t("structure.markAsUnreviewed", { defaultValue: "Mark as unreviewed" });
  }
  return t("structure.markAsReviewed", { defaultValue: "Mark as reviewed" });
};

export const openPointEditor = ({
  point,
  isFocusMode,
  setLocalEditText,
  setIsEditingLocally,
  onEditPoint,
}: OpenPointEditorArgs) => {
  if (point.isReviewed) return;
  if (isFocusMode) {
    onEditPoint?.(point);
    return;
  }
  setLocalEditText(point.text);
  setIsEditingLocally(true);
};

export const mapColumnIdToSectionType = (columnId: string): SectionType | null => {
  switch (columnId) {
    case "introduction":
      return "introduction";
    case "main":
      return "mainPart";
    case "conclusion":
      return "conclusion";
    default:
      return null;
  }
};

export const isPendingItem = (item: Item) =>
  item.id.startsWith(LOCAL_THOUGHT_PREFIX) || Boolean(item.syncStatus);

export const getSectionHeaderBgStyle = (sectionId: string, headerColor?: string) => {
  if (headerColor) return { backgroundColor: headerColor };
  const palette = getSectionPalette(sectionId);
  return palette ? { backgroundColor: palette.base } : undefined;
};

export const getSectionBorderColor = (sectionId: string, headerColor?: string) => {
  if (headerColor) return "";
  const palette = getSectionPalette(sectionId);
  return palette ? palette.border.split(" ")[0] : "border-gray-200";
};

export const getOutlineInsertAccent = (sectionId: string): OutlineInsertAccent => {
  const palette = getSectionPalette(sectionId);
  if (!palette) {
    return {
      badgeClassName:
        "border border-blue-200 dark:border-blue-500/70 bg-white/95 dark:bg-slate-900/95 text-blue-600 dark:text-blue-300",
      badgeShadowStyle: { boxShadow: "0 2px 8px rgba(59,130,246,0.28)" },
      lineStyle: { background: "linear-gradient(90deg, #93c5fd, #3b82f6, #93c5fd)" },
    };
  }

  return {
    badgeClassName: `border ${palette.border} dark:${palette.darkBorder} ${palette.bg} dark:${palette.darkBg} ${palette.text} dark:${palette.darkText}`,
    badgeShadowStyle: { boxShadow: `0 2px 8px ${palette.base}55` },
    lineStyle: {
      background: `linear-gradient(90deg, ${palette.light}, ${palette.base}, ${palette.light})`,
    },
  };
};

export const getAdjacentSectionIds = (sectionId: string) => {
  const currentIndex = SECTION_NAV_ORDER.indexOf(sectionId as ColumnSectionId);
  return {
    previousSectionId: currentIndex > 0 ? SECTION_NAV_ORDER[currentIndex - 1] : null,
    nextSectionId:
      currentIndex >= 0 && currentIndex < SECTION_NAV_ORDER.length - 1
        ? SECTION_NAV_ORDER[currentIndex + 1]
        : null,
  };
};
