"use client";

import {
  BookOpenIcon,
  ClockIcon,
  ArrowTrendingUpIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import React from "react";
import { useTranslation } from "react-i18next";

import MarkdownDisplay from "@/components/MarkdownDisplay";
import { Series } from "@/models/models";

interface SeriesCardProps {
  series: Series;
  onUpdate?: () => void;
}

const statusStyles: Record<
  Series["status"],
  { bg: string; text: string; ring: string }
> = {
  draft: {
    bg: "bg-slate-100 dark:bg-slate-800/70",
    text: "text-slate-700 dark:text-slate-200",
    ring: "ring-slate-200/60 dark:ring-slate-700/80",
  },
  active: {
    bg: "bg-blue-100 dark:bg-blue-900/60",
    text: "text-blue-800 dark:text-blue-100",
    ring: "ring-blue-200/70 dark:ring-blue-800/70",
  },
  completed: {
    bg: "bg-emerald-100 dark:bg-emerald-900/60",
    text: "text-emerald-800 dark:text-emerald-100",
    ring: "ring-emerald-200/70 dark:ring-emerald-800/70",
  },
};

/** Parse a #rrggbb or #rgb hex string into {r, g, b} or null */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

export default function SeriesCard({ series }: SeriesCardProps) {
  const { t } = useTranslation();
  const sermonCount = series.items
    ? series.items.filter((i) => i.type === "sermon").length
    : series.sermonIds?.length || 0;
  const groupCount = series.items
    ? series.items.filter((i) => i.type === "group").length
    : 0;
  const accent = series.color || "#2563EB";
  const rgb = hexToRgb(accent);

  // Light mode: soft 7% tint background + 25% tint border
  const cardStyle: React.CSSProperties = rgb
    ? {
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.07)`,
      borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`,
    }
    : {};

  // Dark mode overlay tint (13% opacity) applied via an absolute sibling div
  const darkOverlayStyle: React.CSSProperties = rgb
    ? { backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.13)` }
    : {};

  return (
    <div
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border p-5 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md dark:border-gray-700/80"
      style={cardStyle}
    >
      {/* Dark-mode tint overlay */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 dark:opacity-100"
        style={darkOverlayStyle}
        aria-hidden
      />

      <div className="relative flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <h3 className="text-lg font-semibold text-gray-900 transition-colors group-hover:text-blue-600 dark:text-gray-50 dark:group-hover:text-blue-400">
                {series.title || `Series ${series.id.slice(-4)}`}
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {series.theme || t("workspaces.series.description")}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyles[series.status].bg} ${statusStyles[series.status].text} ${statusStyles[series.status].ring}`}
          >
            {t(`workspaces.series.form.statuses.${series.status}`)}
          </span>
        </div>

        {/* Book / topic chip and description */}
        <div className="mt-4 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/60 px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100">
            <BookOpenIcon className="h-4 w-4" />
            <span className="truncate max-w-[180px]">
              {series.bookOrTopic || t("workspaces.series.form.bookOrTopic")}
            </span>
          </div>
          {series.description && (
            <div className="line-clamp-3 text-sm text-gray-500 dark:text-gray-300">
              <MarkdownDisplay content={series.description} compact className="!text-sm !text-gray-500 dark:!text-gray-300 prose-p:my-1 prose-headings:my-1" />
            </div>
          )}
        </div>
      </div>

      {/* Footer stats */}
      <div className="relative mt-6 space-y-3 border-t border-black/10 pt-4 dark:border-white/10">
        <div className="grid grid-cols-2 gap-3 text-sm text-gray-700 dark:text-gray-300">
          <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/50 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-gray-900/40">
            <ArrowTrendingUpIcon className="h-4 w-4 shrink-0 text-blue-500" />
            <div className="flex flex-col leading-tight min-w-0">
              <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                {t("workspaces.series.detail.sermonCount", { count: sermonCount })}
              </span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{sermonCount}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/50 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-gray-900/40">
            <UserGroupIcon className="h-4 w-4 shrink-0 text-indigo-500" />
            <div className="flex flex-col leading-tight min-w-0">
              <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                {t("workspaces.series.detail.groupCount", { count: groupCount })}
              </span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{groupCount}</span>
            </div>
          </div>

          {series.duration && (
            <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/50 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-gray-900/40">
              <ClockIcon className="h-4 w-4 shrink-0 text-amber-500" />
              <div className="flex flex-col leading-tight min-w-0">
                <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {t("workspaces.series.detail.duration", { defaultValue: "Duration" })}
                </span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {`${series.duration} weeks`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
