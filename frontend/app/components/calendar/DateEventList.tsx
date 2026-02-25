"use client";

import {
  BookOpenIcon,
  CalendarDaysIcon,
  MapPinIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import { enUS, ru, uk } from 'date-fns/locale';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Group, GroupMeetingDate, PreachDate, Sermon, Series } from '@/models/models';
import { getContrastColor } from '@/utils/color';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getEffectivePreachDateStatus } from '@/utils/preachDateStatus';

interface DateEventListProps {
  month: Date;
  sermons: Sermon[];
  groups?: Group[];
  series?: Series[];
}

type SermonEvent = {
  kind: 'sermon';
  id: string;
  date: string;
  sermon: Sermon;
  preachDate: PreachDate;
};

type GroupEvent = {
  kind: 'group';
  id: string;
  date: string;
  group: Group;
  meetingDate: GroupMeetingDate;
};

export default function DateEventList({ month, sermons, groups = [], series = [] }: DateEventListProps) {
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

  const getSermonSeries = (sermon: Sermon) => {
    if (sermon.seriesId && sermon.seriesId.trim()) {
      return series.find((entry) => entry.id === sermon.seriesId);
    }
    return series.find((entry) => (entry.sermonIds || []).includes(sermon.id));
  };

  const getGroupSeries = (group: Group) => {
    if (group.seriesId && group.seriesId.trim()) {
      return series.find((entry) => entry.id === group.seriesId);
    }
    return series.find((entry) =>
      (entry.items || []).some((item) => item.type === 'group' && item.refId === group.id)
    );
  };

  const sermonEvents: SermonEvent[] = sermons.flatMap((sermon) =>
    (sermon.preachDates || []).flatMap((preachDate) => {
      const dateKey = toDateOnlyKey(preachDate.date);
      if (!dateKey) {
        return [];
      }

      return [{
        kind: 'sermon' as const,
        id: `sermon-${sermon.id}-${preachDate.id}`,
        date: dateKey,
        sermon,
        preachDate: {
          ...preachDate,
          date: dateKey,
        },
      }];
    })
  );

  const groupEvents: GroupEvent[] = groups.flatMap((group) =>
    (group.meetingDates || []).flatMap((meetingDate) => {
      const dateKey = toDateOnlyKey(meetingDate.date);
      if (!dateKey) {
        return [];
      }

      return [{
        kind: 'group' as const,
        id: `group-${group.id}-${meetingDate.id}`,
        date: dateKey,
        group,
        meetingDate: {
          ...meetingDate,
          date: dateKey,
        },
      }];
    })
  );

  const eventsByDate = [...sermonEvents, ...groupEvents].reduce(
    (acc, event) => {
      if (!acc[event.date]) {
        acc[event.date] = [];
      }
      acc[event.date].push(event);
      return acc;
    },
    {} as Record<string, Array<SermonEvent | GroupEvent>>
  );

  const sortedDates = Object.keys(eventsByDate).sort();
  const totalEvents = sermonEvents.length + groupEvents.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formattedMonth}</h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {totalEvents} {t('calendar.totalSermonsWord', { count: totalEvents })}
        </span>
      </div>

      <div className="space-y-6">
        {sortedDates.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">{t('calendar.noPreachDates')}</p>
          </div>
        ) : (
          sortedDates.map((dateStr) => {
            const date = parseISO(dateStr);
            const formattedDate = format(date, 'PPPP', { locale: getDateLocale() });
            const dayEvents = eventsByDate[dateStr].sort((a, b) => a.kind.localeCompare(b.kind));

            return (
              <div key={dateStr} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-md font-medium text-gray-700 dark:text-gray-300">{formattedDate}</h3>
                </div>

                <div className="grid gap-3">
                  {dayEvents.map((event) => {
                    const isSermon = event.kind === 'sermon';
                    const title = isSermon ? event.sermon.title : event.group.title;
                    const href = isSermon ? `/sermons/${event.sermon.id}` : `/groups/${event.group.id}`;
                    const subtitle = isSermon ? event.sermon.verse : event.group.description;
                    const location = isSermon
                      ? event.preachDate.church.name
                        ? `${event.preachDate.church.name}${event.preachDate.church.city ? `, ${event.preachDate.church.city}` : ''}`
                        : undefined
                      : event.meetingDate.location;
                    const audience = isSermon ? event.preachDate.audience : event.meetingDate.audience;
                    const outcome = isSermon ? event.preachDate.outcome : event.meetingDate.outcome;
                    const sermonDateStatus = isSermon
                      ? getEffectivePreachDateStatus(event.preachDate, Boolean(event.sermon.isPreached))
                      : null;
                    const isPlannedSermon = sermonDateStatus === 'planned';
                    const linkedSeries = isSermon ? getSermonSeries(event.sermon) : getGroupSeries(event.group);

                    return (
                      <Link
                        key={event.id}
                        href={href}
                        className="group block bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-sm hover:shadow-md overflow-hidden"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-start gap-2 overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {isSermon ? (
                                <BookOpenIcon className="h-4 w-4 text-blue-600 dark:text-blue-300 flex-shrink-0 mt-0.5" />
                              ) : (
                                <UserGroupIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-300 flex-shrink-0 mt-0.5" />
                              )}
                              <h4 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate min-w-0">
                                {title}
                              </h4>
                            </div>
                            {outcome && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 flex-shrink-0 whitespace-nowrap">
                                {t(`calendar.outcomes.${outcome}`)}
                              </span>
                            )}
                            {isSermon && (
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex-shrink-0 whitespace-nowrap ${isPlannedSermon
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  }`}
                              >
                                {isPlannedSermon
                                  ? t('calendar.status.planned', { defaultValue: 'Planned' })
                                  : t('calendar.status.preached', { defaultValue: 'Preached' })}
                              </span>
                            )}
                          </div>

                          {linkedSeries && (
                            <div>
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full font-medium text-xs max-w-[120px]"
                                style={{
                                  backgroundColor: linkedSeries.color || '#3B82F6',
                                  color: getContrastColor(linkedSeries.color || '#3B82F6'),
                                }}
                              >
                                <span className="truncate">{linkedSeries.title}</span>
                              </span>
                            </div>
                          )}

                          {subtitle && (
                            <div className="flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400 min-w-0 overflow-hidden">
                              <CalendarDaysIcon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                              <div className="break-words whitespace-pre-line flex-1 min-w-0 overflow-hidden">{subtitle}</div>
                            </div>
                          )}

                          {(location || audience) && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400 overflow-hidden">
                              {location && (
                                <div className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 min-w-0 max-w-full">
                                  <MapPinIcon className="w-4 h-4 flex-shrink-0" />
                                  <span className="truncate">{location}</span>
                                </div>
                              )}
                              {audience && (
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <UserIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                  <span className="truncate">{audience}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
