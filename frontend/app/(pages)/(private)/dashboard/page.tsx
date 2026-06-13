'use client';

import {
  BookOpen,
  CalendarDays,
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
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import '@locales/i18n';

import AddSermonModal from '@/components/AddSermonModal';
import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import { useDashboardOptimisticSermons } from '@/hooks/useDashboardOptimisticSermons';
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

type Tone = 'blue' | 'emerald' | 'amber' | 'rose' | 'gray' | 'violet' | 'cyan';

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

const toneClasses = {
  blue: {
    icon: 'bg-blue-600 text-white',
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200',
    dot: 'bg-blue-500',
    bar: 'bg-blue-600',
    // card: subtle category-tinted fill + vivid category border (from the color demo)
    card: 'bg-blue-50/60 border-blue-500 dark:bg-blue-950/30 dark:border-blue-600/80',
    rowHover: 'hover:bg-blue-100/60 focus-visible:ring-blue-500/40 dark:hover:bg-blue-900/40',
    link: 'text-blue-600 hover:border-blue-300 hover:bg-blue-100 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-900/40',
  },
  emerald: {
    icon: 'bg-emerald-600 text-white',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-600',
    card: 'bg-emerald-50/60 border-emerald-500 dark:bg-emerald-950/30 dark:border-emerald-600/80',
    rowHover: 'hover:bg-emerald-100/60 focus-visible:ring-emerald-500/40 dark:hover:bg-emerald-900/40',
    link: 'text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/40',
  },
  amber: {
    icon: 'bg-amber-500 text-white',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    card: 'bg-amber-50/60 border-amber-500 dark:bg-amber-950/30 dark:border-amber-600/80',
    rowHover: 'hover:bg-amber-100/60 focus-visible:ring-amber-500/40 dark:hover:bg-amber-900/40',
    link: 'text-amber-600 hover:border-amber-300 hover:bg-amber-100 dark:text-amber-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/40',
  },
  rose: {
    icon: 'bg-rose-500 text-white',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200',
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
    card: 'bg-rose-50/60 border-rose-500 dark:bg-rose-950/30 dark:border-rose-600/80',
    rowHover: 'hover:bg-rose-100/60 focus-visible:ring-rose-500/40 dark:hover:bg-rose-900/40',
    link: 'text-rose-600 hover:border-rose-300 hover:bg-rose-100 dark:text-rose-300 dark:hover:border-rose-700 dark:hover:bg-rose-900/40',
  },
  violet: {
    icon: 'bg-violet-600 text-white',
    badge: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-200',
    dot: 'bg-violet-500',
    bar: 'bg-violet-600',
    card: 'bg-violet-50/60 border-violet-500 dark:bg-violet-950/30 dark:border-violet-600/80',
    rowHover: 'hover:bg-violet-100/60 focus-visible:ring-violet-500/40 dark:hover:bg-violet-900/40',
    link: 'text-violet-600 hover:border-violet-300 hover:bg-violet-100 dark:text-violet-300 dark:hover:border-violet-700 dark:hover:bg-violet-900/40',
  },
  cyan: {
    icon: 'bg-cyan-600 text-white',
    badge: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200',
    dot: 'bg-cyan-500',
    bar: 'bg-cyan-600',
    card: 'bg-cyan-50/60 border-cyan-500 dark:bg-cyan-950/30 dark:border-cyan-600/80',
    rowHover: 'hover:bg-cyan-100/60 focus-visible:ring-cyan-500/40 dark:hover:bg-cyan-900/40',
    link: 'text-cyan-600 hover:border-cyan-300 hover:bg-cyan-100 dark:text-cyan-300 dark:hover:border-cyan-700 dark:hover:bg-cyan-900/40',
  },
  gray: {
    icon: 'bg-gray-500 text-white',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dot: 'bg-gray-400',
    bar: 'bg-gray-500',
    card: 'bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800',
    rowHover: 'hover:bg-gray-100/70 focus-visible:ring-gray-400/40 dark:hover:bg-gray-800/70',
    link: 'text-gray-600 hover:border-gray-300 hover:bg-gray-100 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800/40',
  },
} as const;

// Category-colored card: neutral rounded panel with a tinted fill + vivid border per tone.
const panelBaseClass = 'rounded-lg border shadow-sm';
const tonedCardClass = (tone: Tone) => `${panelBaseClass} ${toneClasses[tone].card}`;
const panelHeaderClass =
  'flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800';
const DEFAULT_SERIES_COLOR = '#2563EB';
// Row hover tinted to the panel's category (visible bg-X-100 over the X-50 card) + matching focus ring.
const rowLink = (tone: Tone) =>
  `transition focus:outline-none focus-visible:ring-2 ${toneClasses[tone].rowHover}`;
// Header "view all" link: transparent at rest, clear bordered+tinted rectangle on hover.
const panelLinkClass = (tone: Tone) =>
  `inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium transition ${toneClasses[tone].link}`;
const quickActionBaseClass =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950';
const quickActionToneClasses = {
  blue:
    'border-blue-300 bg-white text-blue-700 hover:bg-blue-50 focus-visible:ring-blue-500 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-950/40',
  emerald:
    'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-500 dark:border-emerald-700 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40',
  rose:
    'border-rose-300 bg-white text-rose-600 hover:bg-rose-50 focus-visible:ring-rose-500 dark:border-rose-800 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-950/40',
} as const;

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { sermons } = useDashboardSermons();
  const { actions: optimisticSermonActions } = useDashboardOptimisticSermons();
  const { series } = useSeries(user?.uid || null);
  const { uid, notes, createNote } = useStudyNotes();
  const { prayerRequests, createPrayer } = usePrayerRequests(user?.uid || null);
  const { groups } = useGroups(user?.uid || null);
  const [showSermonModal, setShowSermonModal] = useState(false);
  const [showPrayerModal, setShowPrayerModal] = useState(false);
  const [isCreatingStudyNote, setIsCreatingStudyNote] = useState(false);

  const dashboardData = useMemo(
    () => buildDashboardData({ sermons, series, notes, prayerRequests, groups, t, locale: i18n.language }),
    [groups, i18n.language, notes, prayerRequests, sermons, series, t]
  );

  const handleCreatePrayer = async (
    payload: Pick<PrayerRequest, 'title'> &
      Partial<Pick<PrayerRequest, 'description' | 'tags'>>
  ) => {
    if (!user?.uid) {
      throw new Error('User is not authenticated');
    }

    const createdPrayerId = await createPrayer({ userId: user.uid, ...payload });
    router.push(`/prayers/${createdPrayerId}`);
  };

  const handleAddStudyNote = async () => {
    if (!uid) {
      toast.error(t('studiesWorkspace.createError'));
      return;
    }

    setIsCreatingStudyNote(true);
    try {
      const newNote = await createNote({
        userId: uid,
        title: '',
        content: '',
        tags: [],
        scriptureRefs: [],
        type: 'note',
        rootNode: null,
      });
      const query = searchParams.toString();
      router.push(`/studies/${newNote.id}/edit${query ? `?${query}` : ''}`);
    } catch {
      toast.error(t('studiesWorkspace.createError'));
    } finally {
      setIsCreatingStudyNote(false);
    }
  };

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
      tone: 'violet',
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
      label: t('dashboardHome.metrics.activeGroups.label'),
      value: String(dashboardData.activeGroupsCount),
      helper: t('dashboardHome.metrics.activeGroups.helper'),
      href: '/groups',
      icon: UsersRound,
      tone: 'amber',
    },
    {
      label: t('dashboardHome.metrics.upcomingDates.label'),
      value: String(dashboardData.upcomingDatesCount),
      helper: t('dashboardHome.metrics.upcomingDates.helper'),
      href: '/calendar',
      icon: CalendarDays,
      tone: 'cyan',
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
          <button
            type="button"
            onClick={() => setShowSermonModal(true)}
            className={`${quickActionBaseClass} ${quickActionToneClasses.blue}`}
          >
            <Plus className="h-4 w-4" />
            {t('dashboardHome.actions.newSermon')}
          </button>
          <button
            type="button"
            onClick={handleAddStudyNote}
            disabled={isCreatingStudyNote}
            className={`${quickActionBaseClass} ${quickActionToneClasses.emerald} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <Plus className="h-4 w-4" />
            {t('dashboardHome.actions.addStudyNote')}
          </button>
          <button
            type="button"
            onClick={() => setShowPrayerModal(true)}
            className={`${quickActionBaseClass} ${quickActionToneClasses.rose}`}
          >
            <Plus className="h-4 w-4" />
            {t('dashboardHome.actions.addPrayer')}
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-label={t('dashboardHome.metrics.label')}>
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      {/* Row order matches the approved color demo: Sermons · Studies · Calendar */}
      <section className="grid gap-3 xl:grid-cols-6">
        <SermonsPanel sermons={dashboardData.sermonRows} />
        <RecentStudiesPanel studies={dashboardData.studyItems} />
        <AgendaPanel agendaItems={dashboardData.agendaItems} />
      </section>

      {/* Series · Groups · Prayer — same column template as row 1 so panel edges line up */}
      <section className="grid gap-3 xl:grid-cols-6">
        <ActiveSeriesPanel seriesItems={dashboardData.seriesItems} />
        <LatestGroupsPanel groups={dashboardData.groupItems} />
        <PrayerFocusPanel prayers={dashboardData.prayerItems} />
      </section>

      {showSermonModal && (
        <AddSermonModal
          isOpen
          showTriggerButton={false}
          allowPlannedDate
          closeOnSuccess
          onClose={() => setShowSermonModal(false)}
          onCreateRequest={async (input) => {
            // Optimistic + offline-buffered create (same path as /sermons): the
            // sermon is never lost offline and replays on reconnect.
            const createdId = await optimisticSermonActions.createSermon(input);
            // Navigate to the editor only when online — offline the sermon hasn't
            // synced yet and its editor route can't load it; the dashboard stays
            // put and the create flushes on reconnect.
            if (createdId && typeof navigator !== 'undefined' && navigator.onLine) {
              router.push(`/sermons/${createdId}`);
            }
          }}
        />
      )}
      {showPrayerModal && (
        <CreatePrayerModal
          onClose={() => setShowPrayerModal(false)}
          onSubmit={handleCreatePrayer}
          closeOnSuccess={false}
        />
      )}
    </div>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  const tone = toneClasses[metric.tone];

  return (
    <Link
      href={metric.href}
      className={`${tonedCardClass(metric.tone)} group flex min-h-[96px] items-center gap-4 p-4 transition hover:shadow-md hover:brightness-[0.99] dark:hover:brightness-110`}
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
    <section className={`${tonedCardClass('blue')} xl:col-span-2`} aria-labelledby="sermons-overview-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={BookOpen} id="sermons-overview-title" title={t('dashboardHome.sections.sermons.title')} />
        <Link href="/sermons" className={panelLinkClass('blue')}>
          {t('dashboardHome.sections.sermons.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {sermons.length === 0 ? (
        <EmptyPanel icon={BookOpen} text={t('dashboardHome.sections.sermons.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 pb-1 dark:divide-gray-800">
          {sermons.map((sermon) => (
            <Link key={sermon.id} href={`/sermons/${sermon.id}`} className={`grid grid-cols-[40px_1fr_auto] gap-3 py-3 ${rowLink('blue')}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses.blue.badge}`}>
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
              {/* Both statuses stay blue (sermon category); distinguished by intensity:
                  preparing = solid (active work), preached = soft (done). */}
              <span className={`self-start rounded-md px-2 py-1 text-xs font-medium ${
                sermon.tone === 'emerald'
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'bg-blue-600 text-white dark:bg-blue-500'
              }`}>
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
    <section className={`${tonedCardClass('cyan')} xl:col-span-2`} aria-labelledby="agenda-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={CalendarDays} id="agenda-title" title={t('dashboardHome.sections.week.title')} />
        <Link href="/calendar" className={panelLinkClass('cyan')}>
          {t('dashboardHome.sections.week.viewFullCalendar')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {agendaItems.length === 0 ? (
        <EmptyPanel icon={CalendarDays} text={t('dashboardHome.sections.week.empty')} />
      ) : (
        <div className="p-4">
          <div className="space-y-0">
            {agendaItems.map((item, index) => (
              <Link key={item.id} href={item.href} className={`grid grid-cols-[70px_1fr_auto_18px] gap-3 py-1 ${rowLink('cyan')}`}>
                <div className="flex gap-2">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-500" />
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
                  <span className={`rounded-md px-2 py-1 text-xs font-medium ${toneClasses.cyan.badge}`}>
                    {item.type}
                  </span>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PrayerFocusPanel({ prayers }: { prayers: PrayerItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={`${tonedCardClass('rose')} xl:col-span-2`} aria-labelledby="prayer-focus-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={Heart} id="prayer-focus-title" title={t('dashboardHome.sections.prayer.title')} />
        <Link href="/prayers" className={panelLinkClass('rose')}>
          {t('dashboardHome.sections.prayer.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {prayers.length === 0 ? (
        <EmptyPanel icon={Heart} text={t('dashboardHome.sections.prayer.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {prayers.map((prayer) => (
            <Link key={prayer.id} href={prayer.href} className={`grid grid-cols-[36px_1fr_18px] gap-3 py-3 ${rowLink('rose')}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses.rose.badge}`}>
                <Heart className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{prayer.title}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${toneClasses.rose.badge}`}>
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
    </section>
  );
}

function ActiveSeriesPanel({ seriesItems }: { seriesItems: SeriesItem[] }) {
  const { t } = useTranslation();

  return (
    <section className={`${tonedCardClass('violet')} xl:col-span-2`} aria-labelledby="active-series-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={NotebookTabs} id="active-series-title" title={t('dashboardHome.sections.series.title')} />
        <Link href="/series" className={panelLinkClass('violet')}>
          {t('dashboardHome.sections.series.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {seriesItems.length === 0 ? (
        <EmptyPanel icon={NotebookTabs} text={t('dashboardHome.sections.series.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {seriesItems.map((seriesItem) => (
            <Link key={seriesItem.id} href={`/series/${seriesItem.id}`} className={`relative grid grid-cols-[44px_1fr_auto] gap-3 py-3 pl-3 ${rowLink('violet')}`}>
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
                <p className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400">{seriesItem.next}</p>
              </div>
              <span className={`self-start rounded-md px-2 py-1 text-xs font-medium ${toneClasses.violet.badge}`}>
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
    <section className={`${tonedCardClass('emerald')} xl:col-span-2`} aria-labelledby="recent-studies-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={StickyNote} id="recent-studies-title" title={t('dashboardHome.sections.studies.title')} />
        <Link href="/studies" className={panelLinkClass('emerald')}>
          {t('dashboardHome.sections.studies.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {studies.length === 0 ? (
        <EmptyPanel icon={StickyNote} text={t('dashboardHome.sections.studies.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {studies.map((study) => (
            <Link key={study.id} href={study.href} className={`grid grid-cols-[1fr_18px] gap-3 py-3 ${rowLink('emerald')}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{study.passage}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {study.references.map((reference, index) => (
                    <span key={`reference-${reference}-${index}`} className="rounded-md border border-emerald-300 bg-emerald-50/60 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                      {reference}
                    </span>
                  ))}
                  {study.tags.map((tag, index) => (
                    <span key={`tag-${tag}-${index}`} className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
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
    <section className={`${tonedCardClass('amber')} xl:col-span-2`} aria-labelledby="latest-groups-title">
      <div className={panelHeaderClass}>
        <PanelTitle icon={UsersRound} id="latest-groups-title" title={t('dashboardHome.sections.groups.title')} />
        <Link href="/groups" className={panelLinkClass('amber')}>
          {t('dashboardHome.sections.groups.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyPanel icon={UsersRound} text={t('dashboardHome.sections.groups.empty')} />
      ) : (
        <div className="divide-y divide-gray-100 px-4 dark:divide-gray-800">
          {groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.id}`} className={`grid grid-cols-[40px_1fr_auto] gap-3 py-3 ${rowLink('amber')}`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses.amber.icon}`}>
                <UsersRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{group.title}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{group.progress}</p>
                {group.next && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{group.next}</p>
                )}
              </div>
              {/* Status on the right (like sermons/series); amber category, active=solid / completed=soft */}
              <span className={`self-start rounded-md px-2 py-0.5 text-xs font-medium ${
                group.tone === 'emerald'
                  ? 'bg-amber-500 text-white dark:bg-amber-500'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              }`}>
                {group.status}
              </span>
            </Link>
          ))}
        </div>
      )}
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
  const activeGroups = groups.filter((group) => group.status === 'active');
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
    activeGroupsCount: activeGroups.length,
    sermonRows: buildSermonRows(sermons, t, locale),
    agendaItems: agendaEvents.slice(0, 5),
    prayerItems: buildPrayerItems(prayerRequests, t, locale),
    seriesItems: buildSeriesItems(series, sermons, t),
    studyItems: buildStudyItems(notes, t),
    groupItems: buildGroupItems(groups, t, locale),
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
          : '',
        value,
        status: t(`dashboardHome.sections.groups.status.${group.status}`),
        tone,
      };
    });
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

