"use client";

import { List, MessageSquareText, CheckCircle2, Calendar, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import OptionMenu from "@/components/dashboard/OptionMenu";
import { Sermon, Series } from "@/models/models";
import { getExportContent } from "@/utils/exportContent";
import {
  countPreachDatesByStatus,
  getEffectiveIsPreached,
  getLatestPreachedDate,
  getNextPlannedDate
} from "@/utils/preachDateStatus";
import { ThoughtSnippet } from "@/utils/sermonSearch";
import { getTagStyle, getStructureIcon } from "@/utils/tagUtils";
import ExportButtons from "@components/ExportButtons";
import { getContrastColor } from "@utils/color";
import { formatDate, formatDateOnly } from "@utils/dateFormatter";
import { getSermonPlanData } from "@utils/sermonPlanAccess";

import HighlightedText from "../HighlightedText";

import { QuickPlanAccessButton } from "./QuickPlanAccessButton";

import type { TFunction } from "i18next";

const TEXT_PRIMARY_CLASSES = "text-gray-800 dark:text-gray-100";
const DASHBOARD_PREACHED_KEY = "dashboard.preached";
const CALENDAR_STATUS_PLANNED_KEY = "calendar.status.planned";

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
  formattedPlannedDate: string | null;
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
  t: TFunction;
}

interface SermonCardTitleVerseProps {
  sermon: Sermon;
  effectiveIsPreached: boolean;
  searchQuery: string;
}

interface SermonCardSnippetsProps {
  sermonId: string;
  searchQuery: string;
  searchSnippets: ThoughtSnippet[];
}

interface SermonCardBadgesProps {
  sermonSeries?: Series;
  thoughtCount: number;
  hasOutline: number | undefined;
  effectiveIsPreached: boolean;
  preachedDatesCount: number;
  plannedDatesCount: number;
  t: TFunction;
}

interface SermonCardFooterProps {
  sermon: Sermon;
  effectiveIsPreached: boolean;
  t: TFunction;
}

function SermonCardHeader({
  sermon,
  formattedCreatedDate,
  formattedPreachedDate,
  formattedPlannedDate,
  onDelete,
  onUpdate,
  t,
}: SermonCardHeaderProps) {
  const hasPreachedDate = Boolean(formattedPreachedDate);
  const hasPlannedDate = !hasPreachedDate && Boolean(formattedPlannedDate);
  const statusDateText = formattedPreachedDate ?? formattedPlannedDate ?? '-';
  const statusLabel = hasPreachedDate
    ? t(DASHBOARD_PREACHED_KEY)
    : hasPlannedDate
    ? t(CALENDAR_STATUS_PLANNED_KEY, { defaultValue: 'Planned' })
    : t(DASHBOARD_PREACHED_KEY);
  const statusClasses = hasPreachedDate
    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
    : hasPlannedDate
    ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
    : 'bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500';

  return (
    <div className="flex items-start justify-between mb-2">
      <div className="flex flex-col gap-1.5">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 text-xs font-medium">
          <Calendar className="w-3 h-3" />
          <span className="uppercase tracking-wide text-[10px]">{t('dashboard.created')}</span>
          <span className={TEXT_PRIMARY_CLASSES}>{formattedCreatedDate}</span>
        </div>
        <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses}`}>
          <CheckCircle2 className="w-3 h-3" />
          <span className="uppercase tracking-wide text-[10px]">{statusLabel}</span>
          <span className={hasPreachedDate || hasPlannedDate ? TEXT_PRIMARY_CLASSES : ''}>
            {statusDateText}
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

function SermonCardTitleVerse({ sermon, effectiveIsPreached, searchQuery }: SermonCardTitleVerseProps) {
  return (
    <>
      <Link href={`/sermons/${sermon.id}`} className="group/title block mb-2">
        <h3
          className={`text-lg font-bold leading-tight transition-colors ${effectiveIsPreached
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
  sermonSeries,
  thoughtCount,
  hasOutline,
  effectiveIsPreached,
  preachedDatesCount,
  plannedDatesCount,
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
      {effectiveIsPreached && (
        <div className="flex items-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-md border border-green-100 dark:border-green-800/30" title={t(DASHBOARD_PREACHED_KEY)}>
          <CheckCircle2 className="w-3 h-3 mr-1.5" />
          <span>{t(DASHBOARD_PREACHED_KEY)}</span>
        </div>
      )}

      {!effectiveIsPreached && plannedDatesCount > 0 && (
        <div className="flex items-center text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md border border-amber-100 dark:border-amber-800/30" title={t(CALENDAR_STATUS_PLANNED_KEY, { defaultValue: 'Planned' })}>
          <Calendar className="w-3 h-3 mr-1.5" />
          <span>{t(CALENDAR_STATUS_PLANNED_KEY, { defaultValue: 'Planned' })}</span>
        </div>
      )}

      {/* Missing Preach Dates Warning */}
      {effectiveIsPreached && preachedDatesCount === 0 && (
        <div className="flex items-center text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md border border-amber-100 dark:border-amber-800/30 animate-pulse" title={t('calendar.noPreachDatesWarning')}>
          <AlertCircle className="w-3 h-3 mr-1.5" />
          <span>{t('calendar.noPreachDatesWarning')}</span>
        </div>
      )}
    </div>
  );
}

function SermonCardFooter({ sermon, effectiveIsPreached, t }: SermonCardFooterProps) {
  const planData = getSermonPlanData(sermon);

  return (
    <div className="px-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between gap-3">
      <div className="flex-grow">
        <QuickPlanAccessButton sermon={sermon} t={t} isPreached={effectiveIsPreached} />
      </div>

      <div className="flex-shrink-0 border-l border-gray-200 dark:border-gray-700 pl-3">
        <ExportButtons
          sermonId={sermon.id}
          orientation="horizontal"
          getExportContent={(format, options) => getExportContent(sermon, undefined, { format, includeTags: options?.includeTags })}
          className=""
          isPreached={effectiveIsPreached}
          variant="icon"
          planData={planData}
          sermonTitle={sermon.title}
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
  const effectiveIsPreached = getEffectiveIsPreached(sermon);
  const latestPreachedDate = getLatestPreachedDate(sermon);
  const nextPlannedDate = getNextPlannedDate(sermon);
  const preachedDatesCount = countPreachDatesByStatus(sermon, 'preached');
  const plannedDatesCount = countPreachDatesByStatus(sermon, 'planned');

  const formattedCreatedDate = formatDate(sermon.date);
  const formattedPreachedDate = latestPreachedDate?.date ? formatDateOnly(latestPreachedDate.date) : null;
  const formattedPlannedDate =
    !formattedPreachedDate && nextPlannedDate?.date ? formatDateOnly(nextPlannedDate.date) : null;
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
    h-full relative overflow-visible
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
            formattedPlannedDate={formattedPlannedDate}
            onDelete={onDelete}
            onUpdate={onUpdate}
            t={t}
          />

          <SermonCardTitleVerse
            sermon={sermon}
            effectiveIsPreached={effectiveIsPreached}
            searchQuery={searchQuery}
          />

          <SermonCardSnippets
            sermonId={sermon.id}
            searchQuery={searchQuery}
            searchSnippets={searchSnippets}
          />

          {/* Badges & Metadata */}
          <SermonCardBadges
            sermonSeries={sermonSeries}
            thoughtCount={thoughtCount}
            hasOutline={hasOutline}
            effectiveIsPreached={effectiveIsPreached}
            preachedDatesCount={preachedDatesCount}
            plannedDatesCount={plannedDatesCount}
            t={t}
          />
        </div>

        {/* Footer Actions */}
        <SermonCardFooter sermon={sermon} effectiveIsPreached={effectiveIsPreached} t={t} />
      </div>
    </div>
  );
}
