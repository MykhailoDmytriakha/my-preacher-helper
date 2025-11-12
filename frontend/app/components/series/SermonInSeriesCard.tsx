"use client";

import React from "react";
import Link from "next/link";
import { Sermon } from "@/models/models";
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { formatDate } from "@utils/dateFormatter";
import { useTranslation } from 'react-i18next';

interface SermonInSeriesCardProps {
  sermon: Sermon;
  position: number;
  onRemove?: (sermonId: string) => void;
  isDragging?: boolean;
  dragHandleProps?: any; // Props from @hello-pangea/dnd
}

export default function SermonInSeriesCard({
  sermon,
  position,
  onRemove,
  isDragging = false,
  dragHandleProps
}: SermonInSeriesCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`
        relative flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all
        dark:border-gray-700 dark:bg-gray-800
        ${isDragging ? 'shadow-lg ring-2 ring-blue-500' : 'hover:shadow-md'}
      `}
    >
      {/* Position Number */}
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
        {position}
      </div>

      {/* Drag Handle */}
      <div
        {...dragHandleProps}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <Bars3Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/sermons/${sermon.id}`}
          className="block hover:text-blue-600 dark:hover:text-blue-400"
        >
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {sermon.title}
          </h3>
        </Link>

        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 dark:text-gray-400">
          <span className="truncate">{sermon.verse}</span>
          <span>•</span>
          <span>{formatDate(sermon.date)}</span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {sermon.thoughts?.length || 0} thoughts
          </span>
          {sermon.isPreached && (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              Preached
            </span>
          )}
        </div>
      </div>

      {/* Remove Button */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(sermon.id);
          }}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
          title={t('workspaces.series.actions.removeFromSeries')}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
