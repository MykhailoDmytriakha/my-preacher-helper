"use client";

import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import React from "react";
import { useTranslation } from "react-i18next";

import { Sermon } from "@/models/models";
import { formatDate } from "@utils/dateFormatter";
import { getEffectiveIsPreached } from "@utils/preachDateStatus";

import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";


interface SermonInSeriesCardProps {
  sermon: Sermon;
  position: number;
  onRemove?: (sermonId: string) => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableProvidedDragHandleProps | null; // Props from @hello-pangea/dnd
}

function buildPreview(sermon: Sermon): string {
  return (
    sermon.preparation?.thesis?.oneSentence ||
    sermon.thoughts?.[0]?.text ||
    ""
  );
}

export default function SermonInSeriesCard({
  sermon,
  position,
  onRemove,
  isDragging = false,
  dragHandleProps,
}: SermonInSeriesCardProps) {
  const { t } = useTranslation();
  const preview = buildPreview(sermon);
  const isPreached = getEffectiveIsPreached(sermon);

  return (
    <div
      className={`relative flex gap-4 rounded-xl border border-gray-200 bg-white/90 p-4 shadow-sm ring-1 ring-gray-100 transition-all dark:border-gray-700 dark:bg-gray-900/70 dark:ring-gray-800 ${
        isDragging ? "shadow-lg ring-2 ring-blue-500/40" : "hover:shadow-md"
      }`}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-800/70">
          {position}
        </div>
        <div
          {...dragHandleProps}
          className="cursor-grab text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300"
          title={t("workspaces.series.detail.dragToReorder")}
        >
          <Bars3Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <Link href={`/sermons/${sermon.id}`} className="block">
          <h3 className="text-lg font-semibold text-gray-900 transition-colors hover:text-blue-600 dark:text-gray-50 dark:hover:text-blue-400">
            {sermon.title}
          </h3>
        </Link>
        <p className="text-sm text-gray-600 dark:text-gray-400 italic line-clamp-1">
          {sermon.verse}
        </p>
        {preview && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
            {preview}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
            {formatDate(sermon.date)}
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
            {sermon.thoughts?.length || 0} thoughts
          </span>
          {isPreached && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
              {t("dashboard.preached")}
            </span>
          )}
          {sermon.seriesPosition && (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200">
              #{sermon.seriesPosition}
            </span>
          )}
        </div>
      </div>

      {onRemove && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(sermon.id);
          }}
          className="self-start rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-300"
          title={t("workspaces.series.actions.removeFromSeries")}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
