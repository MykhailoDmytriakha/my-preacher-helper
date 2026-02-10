'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupDetail } from '@/hooks/useGroupDetail';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import useSermon from '@/hooks/useSermon';
import { debugLog } from '@/utils/debugMode';
import '@locales/i18n';

// Route constants
const ROUTES = {
  DASHBOARD: '/dashboard',
} as const;

type BreadcrumbItem = {
  label: string;
  href?: string;
  isCurrent?: boolean;
};

type SegmentConfig = {
  labelKey: string;
  defaultLabel: string;
  href?: string;
};

const segmentLabels: Record<string, SegmentConfig> = {
  settings: {
    labelKey: 'navigation.settings',
    defaultLabel: 'Settings',
    href: '/settings'
  },
  sermons: {
    labelKey: 'navigation.sermons',
    defaultLabel: 'Sermons',
    href: ROUTES.DASHBOARD
  },
  plan: {
    labelKey: 'navigation.plan',
    defaultLabel: 'Plan'
  },
  structure: {
    labelKey: 'navigation.structure',
    defaultLabel: 'ThoughtsBySection',
  },
  series: {
    labelKey: 'navigation.series',
    defaultLabel: 'Series',
    href: '/series'
  },
  groups: {
    labelKey: 'navigation.groups',
    defaultLabel: 'Groups',
    href: '/groups'
  },
  studies: {
    labelKey: 'navigation.studies',
    defaultLabel: 'Studies',
    href: '/studies'
  }
};

const detailParents: Record<string, SegmentConfig> = {
  sermons: {
    labelKey: 'navigation.sermonDetail',
    defaultLabel: 'Sermon'
  },
  series: {
    labelKey: 'navigation.seriesDetail',
    defaultLabel: 'Series Detail'
  },
  groups: {
    labelKey: 'navigation.groupDetail',
    defaultLabel: 'Group'
  },
  studies: {
    labelKey: 'navigation.studyDetail',
    defaultLabel: 'Study'
  }
};

const HUMANIZE_REGEX = /-/g;

const capitalizeWords = (value: string) =>
  value.replace(HUMANIZE_REGEX, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

type SermonData = ReturnType<typeof useSermon>['sermon'];
type SeriesData = ReturnType<typeof useSeriesDetail>['series'];
type GroupData = ReturnType<typeof useGroupDetail>['group'];

const shouldSkipRootSegment = (segment: string, index: number) =>
  segment === 'dashboard' || (index === 0 && Boolean(segmentLabels[segment]));

type BuildSegmentCrumbParams = {
  segment: string;
  parent?: string;
  currentPath: string;
  isLast: boolean;
  t: TranslateFn;
  sermon: SermonData;
  series: SeriesData;
  group: GroupData;
};

type DetailLabelContext = {
  sermon: SermonData;
  series: SeriesData;
  group: GroupData;
};

type DetailLabelResolver = (context: DetailLabelContext) => string | null;

const detailLabelResolvers: Record<string, DetailLabelResolver> = {
  sermons: ({ sermon }) => sermon?.title || null,
  series: ({ series }) => (series ? series.title || `Series ${series.id.slice(-4)}` : null),
  groups: ({ group }) => group?.title || null,
};

const buildCrumb = (label: string, isLast: boolean, currentPath: string, hrefOverride?: string) => ({
  label,
  href: isLast ? undefined : (hrefOverride ?? currentPath),
  isCurrent: isLast,
});

const resolveDetailLabel = (
  parent: string,
  t: TranslateFn,
  context: DetailLabelContext
): string | null => {
  const detailConfig = detailParents[parent];
  if (!detailConfig) {
    return null;
  }

  const resolvedLabel = detailLabelResolvers[parent]?.(context);
  if (resolvedLabel) {
    return resolvedLabel;
  }

  return t(detailConfig.labelKey, { defaultValue: detailConfig.defaultLabel });
};

const buildSegmentCrumb = ({
  segment,
  parent,
  currentPath,
  isLast,
  t,
  sermon,
  series,
  group,
}: BuildSegmentCrumbParams): BreadcrumbItem => {
  const config = segmentLabels[segment];
  if (config) {
    return buildCrumb(
      t(config.labelKey, { defaultValue: config.defaultLabel }),
      isLast,
      currentPath,
      config.href
    );
  }

  if (parent) {
    const detailLabel = resolveDetailLabel(parent, t, { sermon, series, group });
    if (detailLabel) {
      return buildCrumb(detailLabel, isLast, currentPath);
    }
  }

  return buildCrumb(capitalizeWords(segment), isLast, currentPath);
};

export default function Breadcrumbs({ forceShow = false }: { forceShow?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const isPreachingMode = searchParams?.get('planView') === 'preaching';
  const shouldHide = isPreachingMode && !forceShow;

  // Get sermonId from different sources
  const sermonId = useMemo(() => {
    // Legacy fallback: /structure?sermonId=XXX
    const querySermonId = searchParams?.get('sermonId');
    if (querySermonId) return querySermonId;

    // For /sermons/XXX
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 'sermons' && segments[1]) {
      return segments[1];
    }

    return null;
  }, [pathname, searchParams]);

  // Get seriesId from URL
  const seriesId = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 'series' && segments[1]) {
      return segments[1];
    }
    return null;
  }, [pathname]);

  // Get groupId from URL
  const groupId = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 'groups' && segments[1]) {
      return segments[1];
    }
    return null;
  }, [pathname]);

  // Get sermon data if we have sermonId
  const { sermon } = useSermon(sermonId || '');

  // Get series data if we have seriesId
  const { series } = useSeriesDetail(seriesId || '');

  // Get group data if we have groupId
  const { group } = useGroupDetail(groupId || '');

  const items = useMemo<BreadcrumbItem[]>(() => {
    if (shouldHide) {
      return [];
    }

    if (!pathname || pathname === '/' || pathname === ROUTES.DASHBOARD) {
      return [];
    }

    const segments = pathname.split('/')
      .filter(Boolean)
      // Ignore dynamic route groups like "(private)"
      .filter((segment) => !segment.startsWith('(') && !segment.endsWith(')'));

    if (segments.length === 0) {
      return [];
    }

    // Determine the root breadcrumb based on the first segment (context-dependent)
    const firstSegment = segments[0];
    const rootConfig = segmentLabels[firstSegment];

    const crumbs: BreadcrumbItem[] = [];

    // Add root breadcrumb based on context
    if (rootConfig) {
      crumbs.push({
        label: t(rootConfig.labelKey, { defaultValue: rootConfig.defaultLabel }),
        href: rootConfig.href
      });
    } else if (firstSegment === 'dashboard') {
      // For dashboard sub-routes, use Sermons as root
      crumbs.push({
        label: t('navigation.sermons', { defaultValue: 'Sermons' }),
        href: ROUTES.DASHBOARD
      });
    }

    let currentPath = '';

    segments.forEach((segment, index) => {
      currentPath += `/${segment}`;

      // Skip root segments that are already handled as the first breadcrumb
      if (shouldSkipRootSegment(segment, index)) {
        return;
      }

      const isLast = index === segments.length - 1;
      const parent = segments[index - 1];
      crumbs.push(buildSegmentCrumb({ segment, parent, currentPath, isLast, t, sermon, series, group }));
    });

    // Handle "Preaching" mode overlay
    if (searchParams?.get('planView') === 'preaching' && crumbs.length > 0) {
      // Modify the last existing crumb (Plan) to be a link
      const lastCrumb = crumbs[crumbs.length - 1];
      if (lastCrumb) {
        lastCrumb.isCurrent = false;
        // Reconstruct href for the plan page (assuming the last segment path is correct)
        // If the last segment was 'plan', currentPath already points to /sermons/ID/plan
        lastCrumb.href = crumbs[crumbs.length - 1].href || pathname || undefined;
      }

      // Append Preaching crumb
      crumbs.push({
        label: t('navigation.breadcrumb.preaching', { defaultValue: 'Preaching' }),
        href: undefined,
        isCurrent: true
      });
    }

    // Log the computed crumbs (debug only)
    debugLog('Breadcrumbs computed:', {
      path: pathname,
      sermonId,
      sermonTitle: sermon?.title,
      groupId,
      groupTitle: group?.title,
      itemsLength: crumbs.length,
      items: JSON.stringify(crumbs)
    });

    return crumbs.length > 1 ? crumbs : [];
  }, [pathname, searchParams, sermon, sermonId, series, group, groupId, shouldHide, t]);

  if (shouldHide) {
    return null;
  }

  if (items.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="py-3" data-testid="breadcrumbs">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center">
              {item.href && !item.isCurrent ? (
                <Link
                  href={item.href}
                  prefetch
                  className="rounded px-1 py-0.5 text-gray-500 transition hover:text-gray-900 dark:hover:text-gray-100"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={`px-1 py-0.5 font-medium ${isLast ? 'text-gray-900 dark:text-gray-100' : ''}`}
                  aria-current={item.isCurrent ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {index < items.length - 1 && (
                <span className="mx-1 text-gray-400" aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
