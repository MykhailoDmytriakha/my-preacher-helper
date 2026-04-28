'use client';

import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Heart,
  NotebookTabs,
  Plus,
  StickyNote,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';

import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { useGroups } from '@/hooks/useGroups';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { useSeries } from '@/hooks/useSeries';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { Group, PrayerRequest, Sermon, Series, StudyNote } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { getContrastColor } from '@/utils/color';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { getEffectiveIsPreached } from '@/utils/preachDateStatus';

import type { TFunction } from 'i18next';

type Tone = 'blue' | 'emerald' | 'amber' | 'rose' | 'gray';

type Metric = {
  label: string;
  value: string;
  helper: string;
  href: string;
  icon: LucideIcon;
  tone: Exclude<Tone, 'gray'>;
};

type SermonRow = {
  id: string;
  title: string;
  verse: string;
  status: string;
  meta: string;
  tone: Tone;
};

type AgendaItem = {
  id: string;
  day: string;
  date: string;
  time: string;
  title: string;
  type: string;
  href: string;
  tone: Tone;
};

type PrayerItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  age: string;
  href: string;
  tone: Tone;
};

type SeriesItem = {
  id: string;
  title: string;
  progress: string;
  next: string;
  status: string;
  value: number;
  color: string;
  tone: Tone;
};

type StudyItem = {
  id: string;
  passage: string;
  references: string[];
  tags: string[];
  href: string;
};

type GroupItem = {
  id: string;
  title: string;
  progress: string;
  next: string;
  value: number;
  status: string;
  tone: Tone;
};

type AttentionItem = {
  id: string;
  item: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
  due: string;
  notes: string;
  action: string;
  href: string;
  tone: Tone;
};

const toneClasses = {
  blue: {
    icon: 'bg-blue-600 text-white',
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200',
    dot: 'bg-blue-500',
    bar: 'bg-blue-600',
  },
  emerald: {
    icon: 'bg-emerald-600 text-white',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-600',
  },
  amber: {
    icon: 'bg-amber-500 text-white',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
  },
  rose: {
    icon: 'bg-rose-500 text-white',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200',
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
  },
  gray: {
    icon: 'bg-gray-500 text-white',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dot: 'bg-gray-400',
    bar: 'bg-gray-500',
  },
} as const;

const panelClass =
  'rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900';
const panelHeaderClass =
  'flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800';
const DEFAULT_SERIES_COLOR = '#2563EB';
const rowLinkClass =
  'transition hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:hover:bg-gray-800/70';

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { sermons } = useDashboardSermons();
  const { series } = useSeries(user?.uid || null);
  const { notes } = useStudyNotes();
  const { prayerRequests } = usePrayerRequests(user?.uid || null);
  const { groups } = useGroups(user?.uid || null);

  const dashboardData = useMemo(
    () => buildDashboardData({ sermons, series, notes, prayerRequests, groups, t, locale: i18n.language }),
    [groups, i18n.language, notes, prayerRequests, sermons, series, t]
  );

  const metrics: Metric[] = [
    {
      label: t('dashboardHome.metrics.activeSermons.label'),
      value: String(dashboardData.activeSermonsCount),
      helper: t('dashboardHome.metrics.activeSermons.helper'),
      href: '/sermons',
      icon: BookOpen,
      tone: 'blue',
    },
    {
      label: t('dashboardHome.metrics.activeSeries.label'),
      value: String(dashboardData.activeSeriesCount),
      helper: t('dashboardHome.metrics.activeSeries.helper'),
      href: '/series',
      icon: NotebookTabs,
      tone: 'emerald',
    },
    {
      label: t('dashboardHome.metrics.studyNotes.label'),
      value: String(dashboardData.studyNotesCount),
      helper: t('dashboardHome.metrics.studyNotes.helper'),
      href: '/studies',
      icon: StickyNote,
      tone: 'emerald',
    },
    {
      label: t('dashboardHome.metrics.upcomingDates.label'),
      value: String(dashboardData.upcomingDatesCount),
      helper: t('dashboardHome.metrics.upcomingDates.helper'),
      href: '/calendar',
      icon: CalendarDays,
      tone: 'blue',
    },
    {
      label: t('dashboardHome.metrics.activePrayers.label'),
      value: String(dashboardData.activePrayersCount),
      helper: t('dashboardHome.metrics.activePrayers.helper'),
      href: '/prayers',
      icon: Heart,
      tone: 'rose',
    },
  ];

  return (
    <div className="space-y-4 pb-8 text-gray-900 dark:text-gray-100">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-3xl">
            {t('dashboardHome.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dashboardHome.subtitle')}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[520px]">
          <Link
            href="/sermons"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            {t('dashboardHome.actions.newSermon')}
          </Link>
          <Link
            href="/studies/new"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-700 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          >
            <Plus className="h-4 w-4" />
            {t('dashboardHome.actions.addStudyNote')}
          </Link>
          <Link
            href="/prayers"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50 dark:border-rose-800 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            <Plus className="h-4 w-4" />
            {t('dashboardHome.actions.addPrayer')}
          </Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label={t('dashboardHome.metrics.label')}>
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.04fr_0.96fr_1.08fr]">
        <SermonsPanel sermons={dashboardData.sermonRows} />
        <AgendaPanel agendaItems={dashboardData.agendaItems} />
        <PrayerFocusPanel prayers={dashboardData.prayerItems} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr_1.08fr]">
        <ActiveSeriesPanel seriesItems={dashboardData.seriesItems} />
        <RecentStudiesPanel studies={dashboardData.studyItems} />
        <LatestGroupsPanel groups={dashboardData.groupItems} />
      </section>

      <NeedsAttentionPanel attentionItems={dashboardData.attentionItems} />
    </div>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  const tone = toneClasses[metric.tone];

  return (
    <Link
      href={metric.href}
      className={`${panelClass} group flex min-h-[96px] items-center gap-4 p-4 transition hover:border-gray-300 hover:shadow-md dark:hover:border-gray-700`}
    >
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-600 dark:text-gray-400">{metric.label}</p>
        <p className="text-2xl font-bold tabular-nums text-gray-950 dark:text-white">{metric.value}</p>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{metric.helper}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-700 dark:group-hover:text-gray-200" />
    </Link>
  );
}

function PanelTitle({
  icon: Icon,
  id,
  title,
}: {
  icon: LucideIcon;
  id?: string;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-gray-700 dark:text-gray-300" />
      <h2 id={id} className="truncate text-sm font-semibold text-gray-950 dark:text-white">{title}</h2>
    </div>
  );
}

function SermonsPanel({ sermons }: { sermons: SermonRow[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="sermons-overview-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={BookOpen} id="sermons-overview-title" title={t('dashboardHome.sections.sermons.title')} />
        <Link href="/sermons" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300">
          {t('dashboardHome.sections.sermons.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {sermons.length === 0 ? (
        <EmptyPanel icon={BookOpen} text={t('dashboardHome.sections.sermons.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 pb-1 dark:divide-gray-800">
          {sermons.map((sermon) => (
            <Link key={sermon.id} href={`/sermons/${sermon.id}`} className={`grid grid-cols-[40px_1fr_auto] gap-3 py-3 ${rowLinkClass}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses[sermon.tone].badge}`}>
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{sermon.title}</p>
                <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{sermon.verse}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    {sermon.meta}
                  </span>
                </div>
              </div>
              <span className={`self-start rounded-md px-2 py-1 text-xs font-medium ${toneClasses[sermon.tone].badge}`}>
                {sermon.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function AgendaPanel({ agendaItems }: { agendaItems: AgendaItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="agenda-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={CalendarDays} id="agenda-title" title={t('dashboardHome.sections.week.title')} />
        <Link href="/calendar" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/70">
          {t('dashboardHome.sections.week.viewCalendar')}
        </Link>
      </div>

      {agendaItems.length === 0 ? (
        <EmptyPanel icon={CalendarDays} text={t('dashboardHome.sections.week.empty')} />
      ) : (
        <div className="p-4">
          <div className="space-y-0">
            {agendaItems.map((item, index) => (
              <Link key={item.id} href={item.href} className={`grid grid-cols-[70px_1fr_auto_18px] gap-3 py-1 ${rowLinkClass}`}>
                <div className="flex gap-2">
                  <div className="flex flex-col items-center">
                    <span className={`mt-1 h-2.5 w-2.5 rounded-full ${toneClasses[item.tone].dot}`} />
                    {index < agendaItems.length - 1 && <span className="mt-1 h-full min-h-[44px] w-px bg-gray-200 dark:bg-gray-800" />}
                  </div>
                  <div className="text-xs">
                    <p className="font-semibold text-gray-500 dark:text-gray-400">{item.day}</p>
                    <p className="mt-0.5 text-gray-400 dark:text-gray-500">{item.date}</p>
                  </div>
                </div>
                <div className="pb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{item.time}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
                </div>
                <div className="pb-4">
                  <span className={`rounded-md px-2 py-1 text-xs font-medium ${toneClasses[item.tone].badge}`}>
                    {item.type}
                  </span>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 text-gray-400" />
              </Link>
            ))}
          </div>
          <Link href="/calendar" className="mt-2 inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-300">
            {t('dashboardHome.sections.week.viewFullCalendar')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </section>
  );
}

function PrayerFocusPanel({ prayers }: { prayers: PrayerItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="prayer-focus-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={Heart} id="prayer-focus-title" title={t('dashboardHome.sections.prayer.title')} />
        <Link href="/prayers" className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/70">
          <Plus className="h-3.5 w-3.5" />
          {t('dashboardHome.sections.prayer.addPrayer')}
        </Link>
      </div>

      {prayers.length === 0 ? (
        <EmptyPanel icon={Heart} text={t('dashboardHome.sections.prayer.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {prayers.map((prayer) => (
            <Link key={prayer.id} href={prayer.href} className={`grid grid-cols-[36px_1fr_18px] gap-3 py-3 ${rowLinkClass}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses[prayer.tone].badge}`}>
                <Heart className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{prayer.title}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${toneClasses[prayer.tone].badge}`}>
                    {prayer.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {prayer.description}
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{prayer.age}</p>
              </div>
              <ChevronRight className="self-center h-4 w-4 text-gray-400" />
            </Link>
          ))}
        </div>
      )}

      <Link href="/prayers" className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-3 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-gray-800 dark:text-rose-300 dark:hover:bg-rose-950/30">
        {t('dashboardHome.sections.prayer.viewAll')}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function ActiveSeriesPanel({ seriesItems }: { seriesItems: SeriesItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="active-series-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={NotebookTabs} id="active-series-title" title={t('dashboardHome.sections.series.title')} />
        <Link href="/series" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300">
          {t('dashboardHome.sections.series.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {seriesItems.length === 0 ? (
        <EmptyPanel icon={NotebookTabs} text={t('dashboardHome.sections.series.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {seriesItems.map((seriesItem) => (
            <Link key={seriesItem.id} href={`/series/${seriesItem.id}`} className={`relative grid grid-cols-[44px_1fr_auto] gap-3 py-3 pl-3 ${rowLinkClass}`}>
              <span
                className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
                style={{ backgroundColor: seriesItem.color }}
                aria-hidden="true"
              />
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg shadow-sm"
                style={{ backgroundColor: seriesItem.color, color: getContrastColor(seriesItem.color) }}
                data-testid={`series-color-${seriesItem.id}`}
              >
                <NotebookTabs className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{seriesItem.title}</p>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{seriesItem.progress}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800">
                  <div className="h-1.5 rounded-full" style={{ width: `${seriesItem.value}%`, backgroundColor: seriesItem.color }} />
                </div>
                <p className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400">{seriesItem.next}</p>
              </div>
              <span
                className={`self-start rounded-md border px-2 py-1 text-xs font-medium ${toneClasses[seriesItem.tone].badge}`}
                style={{ borderColor: seriesItem.color }}
              >
                {seriesItem.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentStudiesPanel({ studies }: { studies: StudyItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="recent-studies-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={StickyNote} id="recent-studies-title" title={t('dashboardHome.sections.studies.title')} />
        <Link href="/studies" className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
          {t('dashboardHome.sections.studies.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {studies.length === 0 ? (
        <EmptyPanel icon={StickyNote} text={t('dashboardHome.sections.studies.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {studies.map((study) => (
            <Link key={study.id} href={study.href} className={`grid grid-cols-[1fr_18px] gap-3 py-3 ${rowLinkClass}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{study.passage}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {study.references.map((reference, index) => (
                    <span key={`reference-${reference}-${index}`} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                      {reference}
                    </span>
                  ))}
                  {study.tags.map((tag, index) => (
                    <span key={`tag-${tag}-${index}`} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronRight className="self-center h-4 w-4 text-gray-400" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function LatestGroupsPanel({ groups }: { groups: GroupItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="latest-groups-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={UsersRound} id="latest-groups-title" title={t('dashboardHome.sections.groups.title')} />
        <Link href="/groups" className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
          {t('dashboardHome.sections.groups.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyPanel icon={UsersRound} text={t('dashboardHome.sections.groups.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.id}`} className={`grid grid-cols-[40px_1fr_auto] gap-3 py-3 ${rowLinkClass}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses[group.tone].icon}`}>
                <UsersRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{group.title}</p>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${toneClasses[group.tone].badge}`}>
                    {group.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{group.progress}</p>
                <div className="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800">
                  <div className={`h-1.5 rounded-full ${toneClasses[group.tone].bar}`} style={{ width: `${group.value}%` }} />
                </div>
              </div>
              <div className="self-center text-right text-xs text-gray-500 dark:text-gray-400">
                {group.next}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function NeedsAttentionPanel({ attentionItems }: { attentionItems: AttentionItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={panelClass} aria-labelledby="needs-attention-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={AlertTriangle} id="needs-attention-title" title={t('dashboardHome.sections.attention.title')} />
      </div>

      {attentionItems.length === 0 ? (
        <EmptyPanel icon={CheckCircle2} text={t('dashboardHome.sections.attention.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">{t('dashboardHome.sections.attention.table.item')}</th>
                <th className="px-4 py-3">{t('dashboardHome.sections.attention.table.category')}</th>
                <th className="px-4 py-3">{t('dashboardHome.sections.attention.table.severity')}</th>
                <th className="px-4 py-3">{t('dashboardHome.sections.attention.table.due')}</th>
                <th className="px-4 py-3">{t('dashboardHome.sections.attention.table.notes')}</th>
                <th className="px-4 py-3 text-right">{t('dashboardHome.sections.attention.table.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {attentionItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.item}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${toneClasses[item.tone].badge}`}>
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${severityColor(item.severity)}`}>
                      {t(`dashboardHome.sections.attention.severity.${item.severity}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{item.due}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.notes}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={item.href} className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-300">
                      {item.action}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Link href="/dashboard" className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 dark:border-gray-800 dark:text-blue-300 dark:hover:bg-blue-950/30">
        {t('dashboardHome.sections.attention.viewAll', { count: attentionItems.length })}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function EmptyPanel({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
        <Icon className="h-6 w-6" />
      </div>
      <p className="max-w-xs text-sm text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}

function buildDashboardData({
  sermons,
  series,
  notes,
  prayerRequests,
  groups,
  t,
  locale,
}: {
  sermons: Sermon[];
  series: Series[];
  notes: StudyNote[];
  prayerRequests: PrayerRequest[];
  groups: Group[];
  t: TFunction;
  locale: string;
}) {
  const now = new Date();
  const twoWeeksFromNow = new Date(now);
  twoWeeksFromNow.setDate(now.getDate() + 14);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(now.getDate() - 14);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const activeSermons = sermons.filter((sermon) => !getEffectiveIsPreached(sermon));
  const activeSeries = series.filter((item) => item.status === 'active');
  const activePrayers = prayerRequests.filter((prayer) => prayer.status === 'active');
  const upcomingEvents = buildCalendarEvents({
    sermons,
    groups,
    start: now,
    end: twoWeeksFromNow,
    locale,
    t,
    sortDirection: 'asc',
  });
  const agendaEvents = upcomingEvents.length > 0
    ? upcomingEvents
    : buildCalendarEvents({
      sermons,
      groups,
      start: twoWeeksAgo,
      end: yesterday,
      locale,
      t,
      sortDirection: 'desc',
    });

  return {
    activeSermonsCount: activeSermons.length,
    activeSeriesCount: activeSeries.length,
    studyNotesCount: notes.length,
    upcomingDatesCount: upcomingEvents.length,
    activePrayersCount: activePrayers.length,
    sermonRows: buildSermonRows(sermons, t, locale),
    agendaItems: agendaEvents.slice(0, 5),
    prayerItems: buildPrayerItems(prayerRequests, t, locale),
    seriesItems: buildSeriesItems(series, sermons, t),
    studyItems: buildStudyItems(notes, t),
    groupItems: buildGroupItems(groups, t, locale),
    attentionItems: buildAttentionItems({ sermons, notes, prayerRequests, groups, t, locale }),
  };
}

function buildSermonRows(sermons: Sermon[], t: TFunction, locale: string): SermonRow[] {
  return [...sermons]
    .sort((a, b) => getTime(b.updatedAt || b.date) - getTime(a.updatedAt || a.date))
    .slice(0, 5)
    .map((sermon) => {
      const isPreached = getEffectiveIsPreached(sermon);
      const plannedDate = getUpcomingPreachDate(sermon);
      const meta = isPreached
        ? t('dashboardHome.sections.sermons.preachedAt', { date: formatDate(plannedDate || sermon.date, locale) })
        : plannedDate
          ? t('dashboardHome.sections.sermons.plannedFor', { date: formatDate(plannedDate, locale) })
          : t('dashboardHome.sections.sermons.updatedAt', { date: formatRelativeDate(sermon.updatedAt || sermon.date, locale, t) });

      return {
        id: sermon.id,
        title: sermon.title || t('dashboardHome.sections.sermons.untitled'),
        verse: sermon.verse || t('dashboardHome.sections.sermons.noVerse'),
        status: isPreached ? t('dashboardHome.sections.sermons.status.preached') : t('dashboardHome.sections.sermons.status.preparing'),
        meta,
        tone: isPreached ? 'emerald' : 'blue',
      };
    });
}

function buildCalendarEvents({
  sermons,
  groups,
  start,
  end,
  locale,
  t,
  sortDirection,
}: {
  sermons: Sermon[];
  groups: Group[];
  start: Date;
  end: Date;
  locale: string;
  t: TFunction;
  sortDirection: 'asc' | 'desc';
}): AgendaItem[] {
  const events: Array<{ id: string; date: string; title: string; type: string; href: string; tone: Tone }> = [];

  sermons.forEach((sermon) => {
    (sermon.preachDates || []).forEach((preachDate) => {
      const date = toDateOnlyKey(preachDate.date);
      if (!date || !isWithinRange(date, start, end)) return;
      events.push({
        id: `${sermon.id}-${preachDate.id}`,
        date,
        title: sermon.title || t('dashboardHome.sections.sermons.untitled'),
        type: t('dashboardHome.sections.week.types.sermon'),
        href: `/sermons/${sermon.id}`,
        tone: preachDate.status === 'preached' ? 'emerald' : 'blue',
      });
    });
  });

  groups.forEach((group) => {
    (group.meetingDates || []).forEach((meetingDate) => {
      const date = toDateOnlyKey(meetingDate.date);
      if (!date || !isWithinRange(date, start, end)) return;
      events.push({
        id: `${group.id}-${meetingDate.id}`,
        date,
        title: group.title,
        type: t('dashboardHome.sections.week.types.group'),
        href: `/groups/${group.id}`,
        tone: 'emerald',
      });
    });
  });

  return events
    .sort((a, b) => sortDirection === 'asc' ? getTime(a.date) - getTime(b.date) : getTime(b.date) - getTime(a.date))
    .map((event) => ({
      ...event,
      day: formatDay(event.date, locale),
      date: formatShortDate(event.date, locale),
      time: formatTime(event.date, locale) || t('dashboardHome.time.allDay'),
    }));
}

function buildPrayerItems(prayerRequests: PrayerRequest[], t: TFunction, locale: string): PrayerItem[] {
  return [...prayerRequests]
    .sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return getTime(b.updatedAt) - getTime(a.updatedAt);
    })
    .slice(0, 4)
    .map((prayer) => ({
      id: prayer.id,
      title: prayer.title,
      description: prayer.description || latestPrayerUpdate(prayer) || t('dashboardHome.sections.prayer.noUpdates'),
      status: t(`dashboardHome.sections.prayer.status.${prayer.status}`),
      age: formatRelativeDate(prayer.updatedAt || prayer.createdAt, locale, t),
      href: `/prayers/${prayer.id}`,
      tone: prayer.status === 'answered' ? 'emerald' : prayer.status === 'not_answered' ? 'gray' : 'rose',
    }));
}

function buildSeriesItems(series: Series[], sermons: Sermon[], t: TFunction): SeriesItem[] {
  const sermonsById = new Map(sermons.map((sermon) => [sermon.id, sermon]));

  return [...series]
    .sort((a, b) => {
      const statusWeight = { active: 0, draft: 1, completed: 2 };
      return statusWeight[a.status] - statusWeight[b.status] || getTime(b.updatedAt) - getTime(a.updatedAt);
    })
    .slice(0, 3)
    .map((item) => {
      const itemIds = item.items?.filter((seriesItem) => seriesItem.type === 'sermon').map((seriesItem) => seriesItem.refId) ?? item.sermonIds ?? [];
      const total = itemIds.length;
      const preached = itemIds.filter((id) => {
        const sermon = sermonsById.get(id);
        return sermon ? getEffectiveIsPreached(sermon) : false;
      }).length;
      const value = total > 0 ? Math.round((preached / total) * 100) : 0;
      const nextSermon = itemIds.map((id) => sermonsById.get(id)).find((sermon) => sermon && !getEffectiveIsPreached(sermon));

      return {
        id: item.id,
        title: item.title || item.theme || item.bookOrTopic || t('dashboardHome.sections.series.untitled'),
        progress: total > 0
          ? t('dashboardHome.sections.series.progress', { preached, total })
          : t('dashboardHome.sections.series.noItems'),
        next: nextSermon
          ? t('dashboardHome.sections.series.next', { title: nextSermon.title })
          : t('dashboardHome.sections.series.noNext'),
        status: t(`dashboardHome.sections.series.status.${item.status}`),
        value,
        color: item.color || DEFAULT_SERIES_COLOR,
        tone: item.status === 'completed' ? 'emerald' : item.status === 'draft' ? 'amber' : 'blue',
      };
    });
}

function buildStudyItems(notes: StudyNote[], t: TFunction): StudyItem[] {
  return [...notes]
    .sort((a, b) => getTime(b.updatedAt) - getTime(a.updatedAt))
    .slice(0, 3)
    .map((note) => ({
      id: note.id,
      passage: getStudyDisplayTitle(note, t),
      references: getStudyReferences(note).slice(0, 2),
      tags: (note.tags || []).length > 0 ? note.tags.slice(0, 3) : [note.type === 'question' ? t('dashboardHome.sections.studies.questionTag') : t('dashboardHome.sections.studies.noteTag')],
      href: `/studies/${note.id}`,
    }));
}

function buildGroupItems(groups: Group[], t: TFunction, locale: string): GroupItem[] {
  return [...groups]
    .filter((group) => group.status === 'active' || group.status === 'completed')
    .sort((a, b) => getTime(b.updatedAt) - getTime(a.updatedAt))
    .slice(0, 3)
    .map((group) => {
      const templates = group.templates || [];
      const total = templates.length;
      const filled = templates.filter((template) => template.status === 'filled').length;
      const value = total > 0 ? Math.round((filled / total) * 100) : 0;
      const nextMeeting = getNextMeetingDate(group);
      const tone: Tone = group.status === 'completed' ? 'gray' : 'emerald';

      return {
        id: group.id,
        title: group.title,
        progress: t('dashboardHome.sections.groups.progress', { percent: value }),
        next: nextMeeting
          ? t('dashboardHome.sections.groups.nextMeeting', { date: formatDate(nextMeeting, locale) })
          : t('dashboardHome.sections.groups.noMeeting'),
        value,
        status: t(`dashboardHome.sections.groups.status.${group.status}`),
        tone,
      };
    });
}

function buildAttentionItems({
  sermons,
  notes,
  prayerRequests,
  groups,
  t,
  locale,
}: {
  sermons: Sermon[];
  notes: StudyNote[];
  prayerRequests: PrayerRequest[];
  groups: Group[];
  t: TFunction;
  locale: string;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  sermons
    .filter((sermon) => !getEffectiveIsPreached(sermon) && !getUpcomingPreachDate(sermon))
    .slice(0, 2)
    .forEach((sermon) => {
      items.push({
        id: `sermon-${sermon.id}`,
        item: t('dashboardHome.sections.attention.items.unscheduledSermon', { title: sermon.title }),
        category: t('navigation.sermons'),
        severity: 'medium',
        due: t('dashboardHome.sections.attention.due.noDate'),
        notes: t('dashboardHome.sections.attention.notes.outlineStarted'),
        action: t('dashboardHome.sections.attention.actions.review'),
        href: `/sermons/${sermon.id}`,
        tone: 'blue',
      });
    });

  notes
    .filter((note) => note.type === 'question')
    .slice(0, 2)
    .forEach((note) => {
      items.push({
        id: `question-${note.id}`,
        item: t('dashboardHome.sections.attention.items.studyQuestion', { title: getStudyDisplayTitle(note, t) }),
        category: t('navigation.studies'),
        severity: 'medium',
        due: '-',
        notes: t('dashboardHome.sections.attention.notes.questionsNeedAnswers'),
        action: t('dashboardHome.sections.attention.actions.openStudy'),
        href: `/studies/${note.id}`,
        tone: 'emerald',
      });
    });

  notes
    .filter((note) => note.isDraft && note.type !== 'question')
    .slice(0, 1)
    .forEach((note) => {
      items.push({
        id: `draft-note-${note.id}`,
        item: t('dashboardHome.sections.attention.items.draftStudy', { title: getStudyDisplayTitle(note, t) }),
        category: t('navigation.studies'),
        severity: 'low',
        due: formatRelativeDate(note.updatedAt, locale, t),
        notes: t('dashboardHome.sections.attention.notes.readyForReview'),
        action: t('dashboardHome.sections.attention.actions.review'),
        href: `/studies/${note.id}`,
        tone: 'emerald',
      });
    });

  prayerRequests
    .filter((prayer) => prayer.status === 'active' && daysSince(prayer.updatedAt || prayer.createdAt) >= 7)
    .slice(0, 2)
    .forEach((prayer) => {
      items.push({
        id: `prayer-${prayer.id}`,
        item: t('dashboardHome.sections.attention.items.stalePrayer', { title: prayer.title }),
        category: t('navigation.prayer'),
        severity: 'high',
        due: t('dashboardHome.sections.attention.due.days', { count: daysSince(prayer.updatedAt || prayer.createdAt) }),
        notes: t('dashboardHome.sections.attention.notes.noUpdate'),
        action: t('dashboardHome.sections.attention.actions.addUpdate'),
        href: `/prayers/${prayer.id}`,
        tone: 'rose',
      });
    });

  groups
    .filter((group) => group.status !== 'completed' && (group.templates || []).some((template) => template.status !== 'filled'))
    .slice(0, 2)
    .forEach((group) => {
      const nextMeeting = getNextMeetingDate(group);

      items.push({
        id: `group-${group.id}`,
        item: t('dashboardHome.sections.attention.items.incompleteGroup', { title: group.title }),
        category: t('navigation.groups'),
        severity: 'medium',
        due: nextMeeting ? formatDate(nextMeeting, locale) : t('dashboardHome.sections.groups.noMeeting'),
        notes: t('dashboardHome.sections.attention.notes.agendaRemaining'),
        action: t('dashboardHome.sections.attention.actions.complete'),
        href: `/groups/${group.id}`,
        tone: 'emerald',
      });
    });

  return items.slice(0, 5);
}

function latestPrayerUpdate(prayer: PrayerRequest) {
  return [...(prayer.updates || [])].sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt))[0]?.text;
}

function getUpcomingPreachDate(sermon: Sermon) {
  const now = new Date();
  return [...(sermon.preachDates || [])]
    .map((date) => toDateOnlyKey(date.date))
    .filter((date): date is string => {
      if (!date) return false;
      return getTime(date) >= startOfDay(now).getTime();
    })
    .sort((a, b) => getTime(a) - getTime(b))[0];
}

function getNextMeetingDate(group: Group) {
  const now = new Date();
  return [...(group.meetingDates || [])]
    .map((date) => toDateOnlyKey(date.date))
    .filter((date): date is string => {
      if (!date) return false;
      return getTime(date) >= startOfDay(now).getTime();
    })
    .sort((a, b) => getTime(a) - getTime(b))[0];
}

function getStudyReferences(note: StudyNote) {
  return note.scriptureRefs
    .map(formatStudyReference)
    .filter((reference): reference is string => Boolean(reference));
}

function formatStudyReference(reference: StudyNote['scriptureRefs'][number]) {
  if (!reference.chapter) return reference.book;
  if (reference.toChapter) return `${reference.book} ${reference.chapter}-${reference.toChapter}`;
  if (!reference.fromVerse) return `${reference.book} ${reference.chapter}`;
  const verse = reference.toVerse ? `${reference.fromVerse}-${reference.toVerse}` : reference.fromVerse;
  return `${reference.book} ${reference.chapter}:${verse}`;
}

function getStudyDisplayTitle(note: StudyNote, t: TFunction) {
  return note.title || getStudyReferences(note)[0] || t('dashboardHome.sections.studies.untitled');
}

function isWithinRange(date: string, start: Date, end: Date) {
  const value = getTime(date);
  return value >= startOfDay(start).getTime() && value <= end.getTime();
}

function formatDate(date: string | undefined, locale: string) {
  if (!date) return '';
  const parsed = parseDateOnly(date);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed);
}

function formatDay(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(parseDateOnly(date)).toUpperCase();
}

function formatShortDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parseDateOnly(date)).toUpperCase();
}

function formatTime(date: string, locale: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime()) || !date.includes('T')) return '';
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(parsed);
}

function formatRelativeDate(date: string | undefined, locale: string, t: TFunction) {
  if (!date) return t('dashboardHome.time.unknown');
  const diff = daysSince(date);
  if (diff <= 0) return t('dashboardHome.time.today');
  if (diff === 1) return t('dashboardHome.time.yesterday');
  if (diff < 14) return t('dashboardHome.time.daysAgo', { count: diff });
  return formatDate(date, locale);
}

function daysSince(date: string | undefined) {
  if (!date) return 0;
  const value = startOfDay(parseDateOnly(date)).getTime();
  const today = startOfDay(new Date()).getTime();
  return Math.max(0, Math.floor((today - value) / 86_400_000));
}

function getTime(date: string | undefined) {
  if (!date) return 0;
  return parseDateOnly(date).getTime();
}

function parseDateOnly(date: string) {
  const dateOnly = toDateOnlyKey(date);
  if (dateOnly) {
    const [year, month, day] = dateOnly.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function severityColor(severity: AttentionItem['severity']) {
  const classes = {
    low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    medium: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
    high: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200',
  };

  return classes[severity];
}
