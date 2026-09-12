'use client';

import { BookOpenIcon, ChatBubbleLeftRightIcon, UserGroupIcon } from '@heroicons/react/24/outline';

import { CALENDAR_KINDS, type CalendarKind } from '@/utils/calendarEntries';

import type { ComponentType, SVGProps } from 'react';

/**
 * WHAT EACH KIND LOOKS LIKE — in one place, so a day dot, a legend button, a month count and a
 * card icon cannot drift apart. The colours are the ones each section already wears elsewhere in
 * the application: sermons blue, groups emerald, the brothers' council indigo, as on the pastor's
 * plane. A fourth section joins by adding its line here and a builder in `calendarEntries.ts`.
 */
export type CalendarKindStyle = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** The dot in a day cell and beside a count. */
  dot: string;
  iconColor: string;
  /** The legend button when the kind is shown. */
  legendOn: string;
  legendLabel: string;
  /** The date block an agenda row carries on its left, in the kind's own colour. */
  dateBadge: string;
  dateBadgeMonth: string;
  dateBadgeDay: string;
  /** Translation keys: the legend name and the plural word for a count. */
  legendKey: string;
  countKey: string;
};

export const CALENDAR_KIND_STYLE: Record<CalendarKind, CalendarKindStyle> = {
  sermon: {
    icon: BookOpenIcon,
    dot: 'bg-blue-500',
    iconColor: 'text-blue-600 dark:text-blue-300',
    legendOn: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/40 dark:hover:bg-blue-900/60',
    legendLabel: 'text-blue-700 dark:text-blue-300',
    dateBadge: 'border-blue-100 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-900/20',
    dateBadgeMonth: 'text-blue-600 dark:text-blue-400',
    dateBadgeDay: 'text-blue-900 dark:text-blue-100',
    legendKey: 'calendar.legend.sermons',
    countKey: 'calendar.totalSermonsWord',
  },
  group: {
    icon: UserGroupIcon,
    dot: 'bg-emerald-500',
    iconColor: 'text-emerald-600 dark:text-emerald-300',
    legendOn: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60',
    legendLabel: 'text-emerald-700 dark:text-emerald-300',
    dateBadge: 'border-emerald-100 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-900/20',
    dateBadgeMonth: 'text-emerald-600 dark:text-emerald-400',
    dateBadgeDay: 'text-emerald-900 dark:text-emerald-100',
    legendKey: 'calendar.legend.groups',
    countKey: 'calendar.totalGroupsWord',
  },
  council: {
    icon: ChatBubbleLeftRightIcon,
    dot: 'bg-indigo-500',
    iconColor: 'text-indigo-600 dark:text-indigo-300',
    legendOn: 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:hover:bg-indigo-900/60',
    legendLabel: 'text-indigo-700 dark:text-indigo-300',
    dateBadge: 'border-indigo-100 bg-indigo-50 dark:border-indigo-800/50 dark:bg-indigo-900/20',
    dateBadgeMonth: 'text-indigo-600 dark:text-indigo-400',
    dateBadgeDay: 'text-indigo-900 dark:text-indigo-100',
    legendKey: 'calendar.legend.councils',
    countKey: 'calendar.totalCouncilsWord',
  },
};

/** Every kind shown by default; a person turns one off and the calendar remembers nothing else. */
export const allKindsShown = (): Record<CalendarKind, boolean> =>
  Object.fromEntries(CALENDAR_KINDS.map((kind) => [kind, true])) as Record<CalendarKind, boolean>;
