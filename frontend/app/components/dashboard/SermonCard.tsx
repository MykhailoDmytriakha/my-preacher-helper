"use client";

import Link from "next/link";
import { Sermon, Series } from "@/models/models";
import { formatDate } from "@utils/dateFormatter";
import { useTranslation } from "react-i18next";
import OptionMenu from "@/components/dashboard/OptionMenu";
import ExportButtons from "@components/ExportButtons";
import { getExportContent } from "@/utils/exportContent";
import { DocumentIcon } from "@components/Icons";
import { QuickPlanAccessButton } from "./QuickPlanAccessButton";

interface SermonCardProps {
  sermon: Sermon;
  series?: Series[];
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
  isMultiSelectMode?: boolean;
  selectedSermonIds?: Set<string>;
  onToggleSermonSelection?: (sermonId: string) => void;
}

export default function SermonCard({
  sermon,
  series = [],
  onDelete,
  onUpdate,
  isMultiSelectMode = false,
  selectedSermonIds = new Set(),
  onToggleSermonSelection
}: SermonCardProps) {
  const { t } = useTranslation();

  const formattedDate = formatDate(sermon.date);
  const thoughtCount = sermon.thoughts?.length || 0;
  const hasOutline = sermon.outline?.introduction?.length || 
                     sermon.outline?.main?.length || 
                     sermon.outline?.conclusion?.length;
  
  const cardClasses = `
    group flex flex-col ${
      sermon.isPreached
        ? 'bg-gray-100 dark:bg-gray-800'
        : 'bg-gray-50 dark:bg-gray-900'
    }
    rounded-lg shadow hover:shadow-lg transition-all duration-300
    border border-gray-200 dark:border-gray-700 h-full relative
  `;
  
  return (
    <div className={cardClasses} data-testid={`sermon-card-${sermon.id}`}>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="p-4 sm:p-5 flex flex-col flex-grow">
          <div className="flex items-start justify-between gap-2 mb-3">
            {isMultiSelectMode && (
              <div className="flex-shrink-0">
                <input
                  type="checkbox"
                  checked={selectedSermonIds.has(sermon.id)}
                  onChange={() => onToggleSermonSelection?.(sermon.id)}
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <Link href={`/sermons/${sermon.id}`} className="flex-1 min-w-0">
              <h3 className={`text-base sm:text-lg font-bold transition-colors line-clamp-2 ${
                sermon.isPreached
                  ? 'text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-300'
                  : 'text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300'
              }`}>
                {sermon.title}
              </h3>
            </Link>
            <div className="z-20 flex-shrink-0">
              <OptionMenu
                sermon={sermon}
                onDelete={(id: string) => onDelete(id)}
                onUpdate={onUpdate}
              />
            </div>
          </div>
          <Link
            href={`/sermons/${sermon.id}`}
            className="block text-sm text-gray-600 dark:text-gray-300 mb-4 break-words whitespace-pre-line"
          >
            {sermon.verse}
          </Link>

          <div className="flex flex-wrap items-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-auto gap-y-2">
            <div className="flex items-center mr-4">
              <DocumentIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
              <span>{thoughtCount} {thoughtCount === 1 ? t('dashboard.thought') : t('dashboard.thoughts')}</span>
            </div>
            {hasOutline ? (
              <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                sermon.isPreached
                  ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                  : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
              }`}>
                {t('dashboard.hasOutline')}
              </div>
            ) : null}
            {(() => {
              // First, check if sermon has seriesId
              if (sermon.seriesId && sermon.seriesId.trim()) {
                const sermonSeries = series.find(s => s.id === sermon.seriesId);
                if (sermonSeries) {
                  const badgeStyle = sermonSeries.color ? {
                    backgroundColor: sermonSeries.color,
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                  } : {};
                  return (
                    <Link
                      href={`/series/${sermon.seriesId}`}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        sermonSeries.color ? 'hover:opacity-80' : (
                          sermon.isPreached
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                            : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                        )
                      } transition-colors`}
                      style={sermonSeries.color ? badgeStyle : {}}
                      onClick={(e) => e.stopPropagation()}
                      title={sermonSeries.title}
                    >
                      {t('workspaces.series.badges.seriesName', { title: sermonSeries.title })}
                    </Link>
                  );
                }
              }

              // Fallback: check if sermon is in any series' sermonIds
              const containingSeries = series.find(s => s.sermonIds?.includes(sermon.id));
              if (containingSeries) {
                const badgeStyle = containingSeries.color ? {
                  backgroundColor: containingSeries.color,
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                } : {};
                return (
                  <Link
                    href={`/series/${containingSeries.id}`}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      containingSeries.color ? 'hover:opacity-80' : (
                        sermon.isPreached
                          ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                          : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                      )
                    } transition-colors`}
                    style={containingSeries.color ? badgeStyle : {}}
                    onClick={(e) => e.stopPropagation()}
                    title={containingSeries.title}
                  >
                    {t('workspaces.series.badges.seriesName', { title: containingSeries.title })}
                  </Link>
                );
              }

              return null;
            })()}
          </div>
        </div>

        <div className={`p-3 sm:p-4 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-3 ${
          sermon.isPreached
            ? 'bg-gray-200 dark:bg-gray-700 group-hover:bg-gray-50 dark:group-hover:bg-gray-900'
            : 'bg-gray-50 dark:bg-gray-900'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              {formattedDate}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-2">
            <QuickPlanAccessButton sermon={sermon} t={t} isPreached={sermon.isPreached} />
            <ExportButtons
              sermonId={sermon.id}
              orientation="horizontal"
              getExportContent={(format, options) => getExportContent(sermon, undefined, { format, includeTags: options?.includeTags })}
              className="scale-100"
              isPreached={sermon.isPreached}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

