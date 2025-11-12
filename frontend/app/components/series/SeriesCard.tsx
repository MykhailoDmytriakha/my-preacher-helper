"use client";

import Link from "next/link";
import { Series } from "@/models/models";
import { formatDate } from "@utils/dateFormatter";
import { useTranslation } from "react-i18next";
import { CalendarIcon, BookOpenIcon, ClockIcon } from "@heroicons/react/24/outline";

interface SeriesCardProps {
  series: Series;
  onUpdate?: () => void;
}

export default function SeriesCard({ series, onUpdate }: SeriesCardProps) {
  const { t } = useTranslation();

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  };

  const sermonCount = series.sermonIds?.length || 0;
  const formattedStartDate = series.startDate ? formatDate(series.startDate) : null;

  return (
    <Link
      href={`/series/${series.id}`}
      className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800 h-full block"
    >
      {/* Status Badge */}
      <div className="absolute right-4 top-4">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusColors[series.status]}`}>
          {t(`workspaces.series.form.statuses.${series.status}`)}
        </span>
      </div>

      {/* Color Bar */}
      {series.color && (
        <div
          className="absolute left-0 top-0 h-1 w-full"
          style={{ backgroundColor: series.color }}
        />
      )}

      {/* Content */}
      <div className="pr-20">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {series.title || `Series ${series.id.slice(-4)}`}
        </h3>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {series.theme}
        </p>

        {series.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 line-clamp-2">
            {series.description}
          </p>
        )}

        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <div className="flex items-center gap-1">
            <BookOpenIcon className="h-3 w-3" />
            <span>{t('workspaces.series.detail.sermonCount', { count: sermonCount })}</span>
          </div>

          {series.duration && (
            <div className="flex items-center gap-1">
              <ClockIcon className="h-3 w-3" />
              <span>{series.duration} weeks</span>
            </div>
          )}

          {formattedStartDate && (
            <div className="flex items-center gap-1">
              <CalendarIcon className="h-3 w-3" />
              <span>Starts {formattedStartDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* Hover indicator */}
      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="text-xs text-blue-500 dark:text-blue-400 font-medium">
          View series →
        </div>
      </div>
    </Link>
  );
}
