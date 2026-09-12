"use client";

import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { enUS, ru, uk } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

import { CalendarEntryCard } from '@/components/calendar/CalendarEntryCard';
import { byNewestFirst, type CalendarEntry } from '@/utils/calendarEntries';
import { getSeriesForRef } from '@/utils/seriesMembership';

import type { Series } from '@/models/models';

interface AgendaViewProps {
  /** Everything there is, across months: the agenda is a single running list. */
  entries: CalendarEntry[];
  series?: Series[];
}

/** The same entries as the month view, in one list that crosses months. */
export default function AgendaView({ entries, series = [] }: AgendaViewProps) {
  const { t, i18n } = useTranslation();

  const dateLocale = i18n.language === 'ru' ? ru : i18n.language === 'uk' ? uk : enUS;
  const ordered = [...entries].sort(byNewestFirst);

  if (ordered.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-20 text-center dark:border-gray-700 dark:bg-gray-800/30">
        <CalendarDaysIcon className="mx-auto mb-4 h-12 w-12 text-gray-400" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">{t('calendar.noPreachDates')}</h3>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {ordered.map((entry) => (
          <CalendarEntryCard
            key={entry.id}
            entry={entry}
            series={getSeriesForRef(entry.refId, series)}
            layout="agenda"
            dateLocale={dateLocale}
          />
        ))}
      </div>
    </div>
  );
}
