import {
  BookOpenIcon,
  HomeIcon,
  Squares2X2Icon,
  RectangleStackIcon,
  UsersIcon,
  Cog6ToothIcon,
  CalendarDaysIcon,
  HeartIcon,
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
};

export const primaryNavItems: PrimaryNavItem[] = [
  {
    key: 'dashboard',
    href: '/dashboard',
    labelKey: 'navigation.dashboard',
    defaultLabel: 'Dashboard',
    icon: HomeIcon,
    matchers: [/^\/dashboard(\/|$)/]
  },
  {
    key: 'sermons',
    href: '/sermons',
    labelKey: 'navigation.sermons',
    defaultLabel: 'Sermons',
    icon: BookOpenIcon,
    matchers: [/^\/sermons(\/|$)/]
  },
  {
    key: 'series',
    href: '/series',
    labelKey: 'navigation.series',
    defaultLabel: 'Series',
    icon: Squares2X2Icon,
    matchers: [/^\/series(\/|$)/],
    theme: 'series'
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
    theme: 'groups'
  },
  {
    /**
     * The pastor's plane, not the prayer journal. The journal is the first ROOM inside it
     * (`/prayers`), which is why the heart stays lit on both paths: leaving the plane for a
     * room must not look like leaving the section. The theme key is still `prayer` on
     * purpose — it names the rose palette this section has always had, and renaming it
     * would touch every surface that reads `NAV_ITEM_THEMES`.
     */
    key: 'care',
    href: '/care',
    labelKey: 'navigation.care',
    defaultLabel: 'Heart matters',
    icon: HeartIcon,
    matchers: [/^\/care(\/|$)/, /^\/prayers(\/|$)/],
    theme: 'prayer' as const,
  },
  {
    key: 'calendar',
    href: '/calendar',
    labelKey: 'navigation.calendar',
    defaultLabel: 'Calendar',
    icon: CalendarDaysIcon,
    matchers: [/^\/calendar(\/|$)/],
    theme: 'calendar'
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
