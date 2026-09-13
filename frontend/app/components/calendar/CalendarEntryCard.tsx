'use client';

import { CalendarDaysIcon, MapPinIcon, UserIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { CALENDAR_KIND_STYLE } from '@/components/calendar/calendarKinds';
import { Chip } from '@/components/ui/Chip';
import { getContrastColor } from '@/utils/color';

import type { Series } from '@/models/models';
import type { CalendarEntry, CalendarEntryStatus } from '@/utils/calendarEntries';
import type { Locale } from 'date-fns';

/**
 * ONE CARD FOR EVERYTHING ON A DAY, whatever kind it is.
 *
 * The month list and the agenda used to hold the same card twice, each written as a chain of
 * "if it is a sermon … otherwise …" over a dozen fields. They differ in one real way — the agenda
 * carries the date on its left, because it runs across months — so that is the only thing this
 * component branches on. Everything else comes from the entry, and a new kind of entry needs no
 * change here at all.
 */
const STATUS_TONE: Record<CalendarEntryStatus, 'amber' | 'emerald' | 'indigo' | 'neutral'> = {
  planned: 'amber',
  preached: 'emerald',
  preparing: 'indigo',
  held: 'neutral',
};

const STATUS_KEY: Record<CalendarEntryStatus, string> = {
  planned: 'calendar.status.planned',
  preached: 'calendar.status.preached',
  preparing: 'council.status.preparing',
  held: 'council.status.held',
};

export function CalendarEntryCard({
  entry,
  series,
  layout = 'month',
  dateLocale,
}: {
  entry: CalendarEntry;
  series?: Series;
  /** `month` — inside a day already named above; `agenda` — a row that carries its own date. */
  layout?: 'month' | 'agenda';
  dateLocale?: Locale;
}) {
  const { t } = useTranslation();
  const style = CALENDAR_KIND_STYLE[entry.kind];
  const Icon = style.icon;
  const agenda = layout === 'agenda';
  const date = parseISO(entry.date);

  return (
    <Link
      href={entry.href}
      data-testid={`calendar-entry-${entry.kind}`}
      className={
        agenda
          ? 'group flex flex-col gap-4 p-6 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center dark:hover:bg-gray-700/50'
          : 'group block overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-blue-500 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500'
      }
    >
      {agenda && (
        /* The date block wears the colour of what stands beside it, so a row reads as one thing. */
        <div className={`flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center rounded-xl border ${style.dateBadge}`}>
          <span className={`text-[10px] font-bold uppercase ${style.dateBadgeMonth}`}>
            {format(date, 'MMM', { locale: dateLocale })}
          </span>
          <span className={`text-xl font-bold leading-none ${style.dateBadgeDay}`}>{format(date, 'd')}</span>
          <span className={`text-[10px] ${style.dateBadgeMonth}`}>{format(date, 'yyyy')}</span>
        </div>
      )}

      <div className={agenda ? 'min-w-0 flex-grow' : 'flex flex-col gap-2'}>
        <div className={`flex items-start justify-between gap-2 overflow-hidden ${agenda ? 'mb-1' : ''}`}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${style.iconColor}`} />
            <h4 className="min-w-0 truncate font-bold text-gray-900 transition-colors group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
              {entry.title}
            </h4>
          </div>
          {entry.outcome && (
            <Chip weight="bold" tone="blue" size="xs" className="flex-shrink-0 whitespace-nowrap uppercase tracking-wider">
              {t(`calendar.outcomes.${entry.outcome}`)}
            </Chip>
          )}
          {entry.status && (
            <Chip
              weight="bold"
              tone={STATUS_TONE[entry.status]}
              size="xs"
              className="flex-shrink-0 whitespace-nowrap uppercase tracking-wider"
            >
              {t(STATUS_KEY[entry.status])}
            </Chip>
          )}
        </div>

        {series && (
          <div>
            <Chip
              tone="custom"
              size="sm"
              className="max-w-[120px]"
              style={{
                backgroundColor: series.color || '#3B82F6',
                color: getContrastColor(series.color || '#3B82F6'),
              }}
            >
              <span className="block truncate">{series.title}</span>
            </Chip>
          </div>
        )}

        {entry.subtitle && (
          <div className="flex min-w-0 items-start gap-1.5 overflow-hidden text-sm text-gray-600 dark:text-gray-400">
            <CalendarDaysIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1 overflow-hidden whitespace-pre-line break-words">{entry.subtitle}</div>
          </div>
        )}

        {/*
          WHAT IT IS ABOUT, not just what it is called. The section lists a council's headings
          under its name; the day showed the name alone, so the pastor had to leave the calendar
          to remember his own agenda. Numbered like there, because the order is the order he will
          walk them in.
        */}
        {entry.sections && (
          <ol className="space-y-1">
            {entry.sections.titles.map((title, index) => (
              <li key={`${title}-${index}`} className="flex gap-2 text-sm">
                <span className="w-4 shrink-0 text-right text-xs font-bold tabular-nums text-gray-500 dark:text-gray-500">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{title}</span>
              </li>
            ))}
            {entry.sections.hidden > 0 && (
              <li className="pl-6 text-xs text-gray-400 dark:text-gray-500">
                {t('council.moreTopics', { count: entry.sections.hidden })}
              </li>
            )}
          </ol>
        )}

        {/*
          A council says how far it got rather than where it met — but only once there is
          something to say. "Covered 0 of 8" before the meeting is a number pretending to be news;
          a council still being prepared is told by its name and its chip, and nothing else.
        */}
        {entry.progress && entry.progress.done > 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('council.discussedCount', { done: entry.progress.done, total: entry.progress.total })}
          </p>
        )}

        {(entry.location || entry.audience) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 overflow-hidden text-sm text-gray-600 dark:text-gray-400">
            {entry.location && (
              <div className="flex min-w-0 max-w-full items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
                <MapPinIcon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{entry.location}</span>
              </div>
            )}
            {entry.audience && (
              <div className="flex min-w-0 items-center gap-1.5">
                <UserIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="truncate">{entry.audience}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
