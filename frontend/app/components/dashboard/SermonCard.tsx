"use client";

import { List, MessageSquareText, CheckCircle2, Calendar, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import OptionMenu from "@/components/dashboard/OptionMenu";
import { Sermon, Series } from "@/models/models";
import { getExportContent } from "@/utils/exportContent";
import { ThoughtSnippet } from "@/utils/sermonSearch";
import { getTagStyle, getStructureIcon } from "@/utils/tagUtils";
import ExportButtons from "@components/ExportButtons";
import { getContrastColor } from "@utils/color";
import { formatDate } from "@utils/dateFormatter";

import HighlightedText from "../HighlightedText";

import { QuickPlanAccessButton } from "./QuickPlanAccessButton";

const TEXT_PRIMARY_CLASSES = "text-gray-800 dark:text-gray-100";
const DASHBOARD_PREACHED_KEY = "dashboard.preached";

interface SermonCardProps {
  sermon: Sermon;
  series?: Series[];
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
  searchQuery?: string;
  searchSnippets?: ThoughtSnippet[];
}

interface SermonCardHeaderProps {
  sermon: Sermon;
  formattedCreatedDate: string;
  formattedPreachedDate: string | null;
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
  t: (key: string) => string;
}

interface SermonCardTitleVerseProps {
  sermon: Sermon;
  searchQuery: string;
}

interface SermonCardSnippetsProps {
  sermonId: string;
  searchQuery: string;
  searchSnippets: ThoughtSnippet[];
}

interface SermonCardBadgesProps {
  sermon: Sermon;
  sermonSeries?: Series;
  thoughtCount: number;
  hasOutline: number | undefined;
  t: (key: string) => string;
}

interface SermonCardFooterProps {
  sermon: Sermon;
  t: (key: string) => string;
}

function SermonCardHeader({
  sermon,
  formattedCreatedDate,
  formattedPreachedDate,
  onDelete,
  onUpdate,
  t,
}: SermonCardHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-2">
      <div className="flex flex-col gap-1.5">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 text-xs font-medium">
          <Calendar className="w-3 h-3" />
          <span className="uppercase tracking-wide text-[10px]">{t('dashboard.created')}</span>
          <span className={TEXT_PRIMARY_CLASSES}>{formattedCreatedDate}</span>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            formattedPreachedDate
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
          }`}
        >
          <CheckCircle2 className="w-3 h-3" />
          <span className="uppercase tracking-wide text-[10px]">{t(DASHBOARD_PREACHED_KEY)}</span>
          <span className={formattedPreachedDate ? TEXT_PRIMARY_CLASSES : ''}>
            {formattedPreachedDate ?? '-'}
          </span>
        </div>
      </div>

      <div className="z-20 -mr-2 -mt-1">
        <OptionMenu
          sermon={sermon}
          onDelete={(id: string) => onDelete(id)}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}

function SermonCardTitleVerse({ sermon, searchQuery }: SermonCardTitleVerseProps) {
  return (
    <>
      <Link href={`/sermons/${sermon.id}`} className="group/title block mb-2">
        <h3
          className={`text-lg font-bold leading-tight transition-colors ${sermon.isPreached
            ? `${TEXT_PRIMARY_CLASSES} group-hover/title:text-blue-600 dark:group-hover/title:text-blue-400`
            : 'text-gray-900 dark:text-white group-hover/title:text-blue-600 dark:group-hover/title:text-blue-400'
          }`}
        >
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
    </>
  );
}

function SermonCardSnippets({ sermonId, searchQuery, searchSnippets }: SermonCardSnippetsProps) {
  if (searchSnippets.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {searchSnippets.map((snippet, idx) => (
        <div
          key={`${sermonId}-snippet-${idx}`}
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
  );
}

function SermonCardBadges({
  sermon,
  sermonSeries,
  thoughtCount,
  hasOutline,
  t,
}: SermonCardBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-auto text-xs">
      {/* Series Badge */}
      {sermonSeries && (
        <span
          className="flex items-center px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-80 max-w-[150px] cursor-pointer"
          style={sermonSeries.color ? {
            backgroundColor: sermonSeries.color,
            color: getContrastColor(sermonSeries.color),
          } : {}}
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = `/series/${sermonSeries.id}`;
          }}
          title={sermonSeries.title}
        >
          <span className="truncate">{sermonSeries.title}</span>
        </span>
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
        <div className="flex items-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-md border border-green-100 dark:border-green-800/30" title={t(DASHBOARD_PREACHED_KEY)}>
          <CheckCircle2 className="w-3 h-3 mr-1.5" />
          <span>{t(DASHBOARD_PREACHED_KEY)}</span>
        </div>
      )}

      {/* Missing Preach Dates Warning */}
      {sermon.isPreached && (!sermon.preachDates || sermon.preachDates.length === 0) && (
        <div className="flex items-center text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md border border-amber-100 dark:border-amber-800/30 animate-pulse" title={t('calendar.noPreachDatesWarning')}>
          <AlertCircle className="w-3 h-3 mr-1.5" />
          <span>{t('calendar.noPreachDatesWarning')}</span>
        </div>
      )}
    </div>
  );
}

function SermonCardFooter({ sermon, t }: SermonCardFooterProps) {
  return (
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
  );
}

export default function SermonCard({
  sermon,
  series = [],
  onDelete,
  onUpdate,
  searchQuery = "",
  searchSnippets = []
}: SermonCardProps) {
  const { t } = useTranslation();

  const formattedCreatedDate = formatDate(sermon.date);
  const latestPreachDate = sermon.isPreached
    ? sermon.preachDates?.reduce<string | null>((latest, preachDate) => {
        if (!preachDate.date) return latest;
        if (!latest) return preachDate.date;
        return new Date(preachDate.date) > new Date(latest) ? preachDate.date : latest;
      }, null) ?? null
    : null;
  const formattedPreachedDate = latestPreachDate ? formatDate(latestPreachDate) : null;
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
      <div className="flex flex-col h-full">
        {/* Main Content Area */}
        <div className="p-5 flex flex-col flex-grow relative">
          {/* Header: Dates & Menu */}
          <SermonCardHeader
            sermon={sermon}
            formattedCreatedDate={formattedCreatedDate}
            formattedPreachedDate={formattedPreachedDate}
            onDelete={onDelete}
            onUpdate={onUpdate}
            t={t}
          />

          <SermonCardTitleVerse sermon={sermon} searchQuery={searchQuery} />

          <SermonCardSnippets
            sermonId={sermon.id}
            searchQuery={searchQuery}
            searchSnippets={searchSnippets}
          />

          {/* Badges & Metadata */}
          <SermonCardBadges
            sermon={sermon}
            sermonSeries={sermonSeries}
            thoughtCount={thoughtCount}
            hasOutline={hasOutline}
            t={t}
          />
        </div>

        {/* Footer Actions */}
        <SermonCardFooter sermon={sermon} t={t} />
      </div>
    </div>
  );
}
