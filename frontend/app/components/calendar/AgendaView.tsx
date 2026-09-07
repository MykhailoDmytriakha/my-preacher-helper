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

import { Chip } from '@/components/ui/Chip';
import { Group, GroupMeetingDate, Sermon, Series } from '@/models/models';
import { getContrastColor } from '@/utils/color';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getEffectivePreachDateStatus } from '@/utils/preachDateStatus';
import { getSeriesForRef } from '@/utils/seriesMembership';

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

  // DERIVED from series.items (sole truth); the deprecated back-refs are ignored.
  const getSermonSeries = (sermon: Sermon) => getSeriesForRef(sermon.id, series);
  const getGroupSeries = (group: Group) => getSeriesForRef(group.id, series);

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
          const sermonDateStatus = isSermon
            ? getEffectivePreachDateStatus(event.preachDate, Boolean(event.sermon.isPreached))
            : null;
          const isPlannedSermon = sermonDateStatus === 'planned';
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
                    <Chip weight="bold" tone="blue" size="xs" className="uppercase tracking-wider">
                      {t(`calendar.outcomes.${outcome}`)}
                    </Chip>
                  )}
                  {isSermon && (
                    <Chip weight="bold"
                      tone={isPlannedSermon ? 'amber' : 'emerald'}
                      size="xs"
                      className="uppercase tracking-wider"
                    >
                      {isPlannedSermon
                        ? t('calendar.status.planned', { defaultValue: 'Planned' })
                        : t('calendar.status.preached', { defaultValue: 'Preached' })}
                    </Chip>
                  )}
                </div>

                {linkedSeries && (
                  <div className="mb-2">
                    <Chip
                      tone="custom"
                      size="sm"
                      className="max-w-[170px]"
                      style={{
                        backgroundColor: linkedSeries.color || '#3B82F6',
                        color: getContrastColor(linkedSeries.color || '#3B82F6'),
                      }}
                    >
                      <span className="block truncate">{linkedSeries.title}</span>
                    </Chip>
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
