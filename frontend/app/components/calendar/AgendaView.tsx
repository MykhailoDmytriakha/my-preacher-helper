"use client";

import {
  BookOpenIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  MapPinIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import { enUS, ru, uk } from 'date-fns/locale';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Group, GroupMeetingDate, Sermon, Series } from '@/models/models';
import { getContrastColor } from '@/utils/color';

interface AgendaViewProps {
  sermons: Sermon[];
  groups?: Group[];
  series?: Series[];
}

type SermonEvent = {
  kind: 'sermon';
  id: string;
  date: string;
  sermon: Sermon;
  preachDate: NonNullable<Sermon['preachDates']>[number];
};

type GroupEvent = {
  kind: 'group';
  id: string;
  date: string;
  group: Group;
  meetingDate: GroupMeetingDate;
};

export default function AgendaView({ sermons, groups = [], series = [] }: AgendaViewProps) {
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
    (sermon.preachDates || []).map((preachDate) => ({
      kind: 'sermon',
      id: `sermon-${sermon.id}-${preachDate.id}`,
      date: preachDate.date,
      sermon,
      preachDate,
    }))
  );

  const groupEvents: GroupEvent[] = groups.flatMap((group) =>
    (group.meetingDates || []).map((meetingDate) => ({
      kind: 'group',
      id: `group-${group.id}-${meetingDate.id}`,
      date: meetingDate.date,
      group,
      meetingDate,
    }))
  );

  const allEvents = [...sermonEvents, ...groupEvents].sort((a, b) => b.date.localeCompare(a.date));

  if (allEvents.length === 0) {
    return (
      <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/30 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
        <CalendarDaysIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('calendar.noPreachDates')}
        </h3>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {allEvents.map((event) => {
          const eventDate = parseISO(event.date);
          const isSermon = event.kind === 'sermon';
          const title = isSermon ? event.sermon.title : event.group.title;
          const href = isSermon ? `/sermons/${event.sermon.id}` : `/groups/${event.group.id}`;
          const description = isSermon ? event.sermon.verse : event.group.description;
          const location = isSermon
            ? event.preachDate.church?.name
              ? `${event.preachDate.church.name}${event.preachDate.church.city ? `, ${event.preachDate.church.city}` : ''}`
              : undefined
            : event.meetingDate.location;
          const audience = isSermon ? event.preachDate.audience : event.meetingDate.audience;
          const outcome = isSermon ? event.preachDate.outcome : event.meetingDate.outcome;
          const linkedSeries = isSermon ? getSermonSeries(event.sermon) : getGroupSeries(event.group);

          return (
            <Link
              key={event.id}
              href={href}
              className="group flex flex-col sm:flex-row sm:items-center gap-4 p-6 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex flex-col items-center justify-center w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50 flex-shrink-0">
                <span className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">
                  {format(eventDate, 'MMM', { locale: getDateLocale() })}
                </span>
                <span className="text-xl font-bold text-blue-900 dark:text-blue-100 leading-none">
                  {format(eventDate, 'd')}
                </span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400">
                  {format(eventDate, 'yyyy')}
                </span>
              </div>

              <div className="flex-grow min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  {isSermon ? (
                    <BookOpenIcon className="h-4 w-4 text-blue-500 dark:text-blue-300" />
                  ) : (
                    <UserGroupIcon className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
                  )}
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                    {title}
                  </h3>
                  {outcome && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {t(`calendar.outcomes.${outcome}`)}
                    </span>
                  )}
                </div>

                {linkedSeries && (
                  <div className="mb-2">
                    <span
                      className="inline-flex items-center max-w-[170px] rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: linkedSeries.color || '#3B82F6',
                        color: getContrastColor(linkedSeries.color || '#3B82F6'),
                      }}
                    >
                      <span className="truncate">{linkedSeries.title}</span>
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-2 text-sm text-gray-500 dark:text-gray-400">
                  {location && (
                    <div className="flex items-center gap-1.5">
                      <MapPinIcon className="w-4 h-4 text-blue-500" />
                      <span>{location}</span>
                    </div>
                  )}
                  {audience && (
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="w-4 h-4" />
                      <span>{audience}</span>
                    </div>
                  )}
                  {description && (
                    <div className="break-words whitespace-pre-line flex-1">{description}</div>
                  )}
                </div>
              </div>

              <div className="flex-shrink-0 self-center hidden sm:block">
                <ChevronRightIcon className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
