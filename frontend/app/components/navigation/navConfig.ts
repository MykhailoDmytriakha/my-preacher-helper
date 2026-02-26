import {
  BookOpenIcon,
  Squares2X2Icon,
  RectangleStackIcon,
  UsersIcon,
  Cog6ToothIcon,
  CalendarDaysIcon
} from '@heroicons/react/24/outline';

import type { NavItemThemeKey } from '@/utils/themeColors';
import type { ComponentType, SVGProps } from 'react';

export type PrimaryNavItem = {
  key: string;
  href: string;
  labelKey: string;
  defaultLabel: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  matchers: RegExp[];
  theme?: NavItemThemeKey;
  isBeta?: boolean;
};

const dashboardMatcher = /^\/(dashboard|sermons)(\/|$)/;

export const primaryNavItems: PrimaryNavItem[] = [
  {
    key: 'sermons',
    href: '/sermons',
    labelKey: 'navigation.sermons',
    defaultLabel: 'Sermons',
    icon: BookOpenIcon,
    matchers: [dashboardMatcher]
  },
  {
    key: 'series',
    href: '/series',
    labelKey: 'navigation.series',
    defaultLabel: 'Series',
    icon: Squares2X2Icon,
    matchers: [/^\/series(\/|$)/]
  },
  {
    key: 'studies',
    href: '/studies',
    labelKey: 'navigation.studies',
    defaultLabel: 'Studies',
    icon: RectangleStackIcon,
    matchers: [/^\/studies(\/|$)/],
    theme: 'studies'
  },
  {
    key: 'groups',
    href: '/groups',
    labelKey: 'navigation.groups',
    defaultLabel: 'Groups',
    icon: UsersIcon,
    matchers: [/^\/groups(\/|$)/],
    isBeta: true
  },
  {
    key: 'calendar',
    href: '/calendar',
    labelKey: 'navigation.calendar',
    defaultLabel: 'Calendar',
    icon: CalendarDaysIcon,
    matchers: [/^\/calendar(\/|$)/]
  },
  {
    key: 'settings',
    href: '/settings',
    labelKey: 'navigation.settings',
    defaultLabel: 'Settings',
    icon: Cog6ToothIcon,
    matchers: [/^\/settings(\/|$)/]
  }
];

export const isNavItemActive = (pathname: string | null, matchers: RegExp[]) => {
  if (!pathname) return false;
  return matchers.some((regex) => regex.test(pathname));
};
