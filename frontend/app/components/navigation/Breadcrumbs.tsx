'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import useSermon from '@/hooks/useSermon';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';

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
    href: '/dashboard'
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

export default function Breadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

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

  // Get sermon data if we have sermonId
  const { sermon } = useSermon(sermonId || '');

  // Get series data if we have seriesId
  const { series } = useSeriesDetail(seriesId || '');

  const items = useMemo<BreadcrumbItem[]>(() => {
    if (!pathname || pathname === '/' || pathname === '/dashboard') {
      return [];
    }

    const segments = pathname.split('/')
      .filter(Boolean)
      // Ignore dynamic route groups like "(private)"
      .filter((segment) => !segment.startsWith('(') && !segment.endsWith(')'));

    if (segments.length === 0) {
      return [];
    }

    const crumbs: BreadcrumbItem[] = [
      {
        label: t('navigation.library', { defaultValue: 'Library' }),
        href: '/dashboard'
      }
    ];

    let currentPath = '';

    segments.forEach((segment, index) => {
      if (segment === 'dashboard') {
        return;
      }

      currentPath += `/${segment}`;
      const isLast = index === segments.length - 1;
      const config = segmentLabels[segment];

      if (config) {
        const label = t(config.labelKey, { defaultValue: config.defaultLabel });
        crumbs.push({
          label,
          href: isLast ? undefined : (config.href ?? currentPath),
          isCurrent: isLast
        });
        return;
      }

      const parent = segments[index - 1];
      if (parent && detailParents[parent]) {
        // Special handling for sermons/[id] with sermon context
        if (parent === 'sermons' && sermon) {
          crumbs.push({
            label: sermon.title,
            href: isLast ? undefined : currentPath,
            isCurrent: isLast
          });
          return;
        }

        // Special handling for series/[id] with series context
        if (parent === 'series' && series) {
          crumbs.push({
            label: series.title || `Series ${series.id.slice(-4)}`,
            href: isLast ? undefined : currentPath,
            isCurrent: isLast
          });
          return;
        }

        const detailLabel = t(detailParents[parent].labelKey, {
          defaultValue: detailParents[parent].defaultLabel
        });
        crumbs.push({
          label: detailLabel,
          href: isLast ? undefined : currentPath,
          isCurrent: isLast
        });
        return;
      }

      const fallbackLabel = capitalizeWords(segment);
      crumbs.push({
        label: fallbackLabel,
        href: isLast ? undefined : currentPath,
        isCurrent: isLast
      });
    });

    return crumbs.length > 1 ? crumbs : [];
  }, [pathname, t, sermon, series, searchParams]);

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
