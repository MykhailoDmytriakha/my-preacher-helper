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
import { List, MessageSquareText, CheckCircle2, Calendar } from "lucide-react";
import HighlightedText from "../HighlightedText";
import { ThoughtSnippet } from "@/utils/sermonSearch";
import { getTagStyle, getStructureIcon } from "@/utils/tagUtils";

interface SermonCardProps {
  sermon: Sermon;
  series?: Series[];
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
  isMultiSelectMode?: boolean;
  selectedSermonIds?: Set<string>;
  onToggleSermonSelection?: (sermonId: string) => void;
  searchQuery?: string;
  searchSnippets?: ThoughtSnippet[];
}

export default function SermonCard({
  sermon,
  series = [],
  onDelete,
  onUpdate,
  isMultiSelectMode = false,
  selectedSermonIds = new Set(),
  onToggleSermonSelection,
  searchQuery = "",
  searchSnippets = []
}: SermonCardProps) {
  const { t } = useTranslation();

  const formattedDate = formatDate(sermon.date);
  const thoughtCount = sermon.thoughts?.length || 0;
  const hasOutline = sermon.outline?.introduction?.length || 
                     sermon.outline?.main?.length || 
                     sermon.outline?.conclusion?.length;
  
  // Find series for this sermon
  const sermonSeries = (() => {
    if (sermon.seriesId && sermon.seriesId.trim()) {
      return series.find(s => s.id === sermon.seriesId);
    }
    return series.find(s => s.sermonIds?.includes(sermon.id));
  })();

  // Card base styles - clean white/dark theme without heavy backgrounds
  const cardClasses = `
    group flex flex-col
    bg-white dark:bg-gray-800
    rounded-xl shadow-sm hover:shadow-md transition-all duration-300
    border border-gray-200 dark:border-gray-700
    h-full relative overflow-hidden
  `;
  
  return (
    <div className={cardClasses} data-testid={`sermon-card-${sermon.id}`}>
      {/* Selection Overlay/Checkbox */}
      {isMultiSelectMode && (
        <div className="absolute top-4 left-4 z-30">
          <input
            type="checkbox"
            checked={selectedSermonIds.has(sermon.id)}
            onChange={() => onToggleSermonSelection?.(sermon.id)}
            className="w-5 h-5 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer shadow-sm"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="flex flex-col h-full">
        {/* Main Content Area */}
        <div className="p-5 flex flex-col flex-grow relative">
          {/* Header: Date & Menu */}
          <div className="flex items-start justify-between mb-2">
             <div className={`flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
               sermon.isPreached 
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
             }`}>
              <Calendar className="w-3 h-3 mr-1.5" />
              {formattedDate}
            </div>
            
            <div className="z-20 -mr-2 -mt-1">
              <OptionMenu
                sermon={sermon}
                onDelete={(id: string) => onDelete(id)}
                onUpdate={onUpdate}
              />
            </div>
          </div>

          {/* Title */}
          <Link href={`/sermons/${sermon.id}`} className="group/title block mb-2">
            <h3 className={`text-lg font-bold leading-tight transition-colors ${
              sermon.isPreached
                ? 'text-gray-800 dark:text-gray-100 group-hover/title:text-blue-600 dark:group-hover/title:text-blue-400'
                : 'text-gray-900 dark:text-white group-hover/title:text-blue-600 dark:group-hover/title:text-blue-400'
            }`}>
              <HighlightedText text={sermon.title} searchQuery={searchQuery} />
            </h3>
          </Link>

          {/* Verse */}
          {sermon.verse && (
            <Link
              href={`/sermons/${sermon.id}`}
              className="block text-sm text-gray-500 dark:text-gray-400 mb-4 line-clamp-2 italic hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <HighlightedText text={sermon.verse} searchQuery={searchQuery} />
            </Link>
          )}

          {searchSnippets.length > 0 && (
            <div className="mb-3 space-y-2">
              {searchSnippets.map((snippet, idx) => (
                <div
                  key={`${sermon.id}-snippet-${idx}`}
                  className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col gap-2"
                >
                  {snippet.text && (
                    <span style={{ wordBreak: 'keep-all' }}>
                      <HighlightedText text={snippet.text} searchQuery={searchQuery} />
                    </span>
                  )}
                  {snippet.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {snippet.tags.map((tag) => {
                        const { className, style } = getTagStyle(tag);
                        const iconInfo = getStructureIcon(tag);
                        return (
                          <span
                            key={tag}
                            style={style}
                            className={`${className} text-xs px-2 py-0.5`}
                          >
                            {iconInfo && (
                              <span
                                className={iconInfo.className}
                                dangerouslySetInnerHTML={{ __html: iconInfo.svg }}
                              />
                            )}
                            <HighlightedText text={tag} searchQuery={searchQuery} />
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Badges & Metadata */}
          <div className="flex flex-wrap items-center gap-2 mt-auto text-xs">
             {/* Series Badge */}
             {sermonSeries && (
              <Link
                href={`/series/${sermonSeries.id}`}
                className="flex items-center px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-80 max-w-[150px]"
                style={sermonSeries.color ? {
                  backgroundColor: sermonSeries.color,
                  color: '#ffffff',
                } : {}}
                onClick={(e) => e.stopPropagation()}
                title={sermonSeries.title}
              >
                <span className="truncate">{sermonSeries.title}</span>
              </Link>
            )}

            {/* Thoughts Count */}
            <div className="flex items-center text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-2 py-0.5 rounded-md border border-gray-100 dark:border-gray-700">
              <MessageSquareText className="w-3 h-3 mr-1.5 opacity-70" />
              <span>{thoughtCount}</span>
            </div>

            {/* SermonOutline Status */}
            {hasOutline && (
              <div className="flex items-center text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-md border border-blue-100 dark:border-blue-800/30" title={t('dashboard.hasOutline')}>
                <List className="w-3 h-3 mr-1.5" />
                <span>{t('dashboard.hasOutline')}</span>
              </div>
            )}
            
            {/* Preached Status (Icon only) */}
            {sermon.isPreached && (
               <div className="flex items-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-md border border-green-100 dark:border-green-800/30" title={t('dashboard.preached')}>
                <CheckCircle2 className="w-3 h-3 mr-1.5" />
                <span>{t('dashboard.preached')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between gap-3">
          <div className="flex-grow">
            <QuickPlanAccessButton sermon={sermon} t={t} isPreached={sermon.isPreached} />
          </div>
          
          <div className="flex-shrink-0 border-l border-gray-200 dark:border-gray-700 pl-3">
            <ExportButtons
              sermonId={sermon.id}
              orientation="horizontal"
              getExportContent={(format, options) => getExportContent(sermon, undefined, { format, includeTags: options?.includeTags })}
              className=""
              isPreached={sermon.isPreached}
              variant="icon"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
