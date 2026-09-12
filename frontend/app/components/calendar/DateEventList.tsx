"use client";

import { format, parseISO } from 'date-fns';
import { enUS, ru, uk } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

import { CalendarEntryCard } from '@/components/calendar/CalendarEntryCard';
import { CALENDAR_KIND_STYLE } from '@/components/calendar/calendarKinds';
import { CALENDAR_KINDS, countByKind, entriesByDate, type CalendarEntry } from '@/utils/calendarEntries';
import { getSeriesForRef } from '@/utils/seriesMembership';

import type { Series } from '@/models/models';

interface DateEventListProps {
  month: Date;
  /** Everything falling in this month, already filtered by what the person chose to see. */
  entries: CalendarEntry[];
  series?: Series[];
}

/**
 * THE MONTH, DAY BY DAY. It knows nothing about sermons, groups or councils — only about entries
 * and the counts they add up to, so a new kind arrives without a line changing here.
 */
export default function DateEventList({ month, entries, series = [] }: DateEventListProps) {
  const { t, i18n } = useTranslation();

  const getDateLocale = () => {
    switch (i18n.language) {
      case 'ru':
        return ru;
      case 'uk':
        return uk;
      default:
        return enUS;
    }
  };

  const formattedMonth = format(month, 'MMMM yyyy', { locale: getDateLocale() });
  const byDate = entriesByDate(entries);
  const sortedDates = Object.keys(byDate).sort().reverse();
  const counts = countByKind(entries);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formattedMonth}</h2>
        <div className="flex items-center gap-3">
          {CALENDAR_KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
            <span key={kind} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <span className={`h-2 w-2 shrink-0 rounded-full ${CALENDAR_KIND_STYLE[kind].dot}`} />
              {counts[kind]} {t(CALENDAR_KIND_STYLE[kind].countKey, { count: counts[kind] })}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {sortedDates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center dark:border-gray-700 dark:bg-gray-800/30">
            <p className="text-gray-500 dark:text-gray-400">{t('calendar.noPreachDates')}</p>
          </div>
        ) : (
          sortedDates.map((dateStr) => {
            const dayEntries = [...byDate[dateStr]].sort((a, b) => a.kind.localeCompare(b.kind));

            return (
              <div key={dateStr} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-md font-medium text-gray-700 dark:text-gray-300">
                    {format(parseISO(dateStr), 'PPPP', { locale: getDateLocale() })}
                  </h3>
                </div>

                <div className="grid gap-3">
                  {dayEntries.map((entry) => (
                    <CalendarEntryCard key={entry.id} entry={entry} series={getSeriesForRef(entry.refId, series)} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
