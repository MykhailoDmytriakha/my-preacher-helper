'use client';

import {
  PlusIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChevronIcon } from '@/components/Icons';
import CreateSeriesModal from '@/components/series/CreateSeriesModal';
import SeriesCard from '@/components/series/SeriesCard';
import { SeriesGridSkeleton } from '@/components/skeletons/SeriesCardSkeleton';
import { useSeries } from '@/hooks/useSeries';
import { useAuth } from '@/providers/AuthProvider';
import '@locales/i18n';

type StatusFilter = 'all' | 'draft' | 'active' | 'completed';
type SortOption = 'recent' | 'title' | 'sermons';

export default function SeriesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { series, loading, error, createNewSeries, refreshSeries } = useSeries(user?.uid || null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortOption>('recent');

  const handleCreateSeries = async (seriesData: Parameters<typeof createNewSeries>[0]) => {
    await createNewSeries(seriesData);
    setShowCreateModal(false);
  };

  const filteredSeries = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    let result = [...series];

    if (statusFilter !== 'all') {
      result = result.filter((item) => item.status === statusFilter);
    }

    if (normalizedSearch) {
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(normalizedSearch) ||
          item.bookOrTopic?.toLowerCase().includes(normalizedSearch) ||
          item.theme?.toLowerCase().includes(normalizedSearch)
      );
    }

    result.sort((a, b) => {
      if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sort === 'sermons') return (b.sermonIds?.length || 0) - (a.sermonIds?.length || 0);

      // default recent: startDate desc then updatedAt
      const aDate = new Date(a.startDate || a.updatedAt || '').getTime();
      const bDate = new Date(b.startDate || b.updatedAt || '').getTime();
      return bDate - aDate;
    });

    return result;
  }, [series, statusFilter, searchTerm, sort]);

  const stats = useMemo(() => {
    const active = series.filter((s) => s.status === 'active').length;
    const completed = series.filter((s) => s.status === 'completed').length;
    const drafts = series.filter((s) => s.status === 'draft').length;
    return { total: series.length, active, completed, drafts };
  }, [series]);

  if (error) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t('navigation.series')}
          </h1>
        </header>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>Failed to load series. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-2 max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700 ring-1 ring-blue-100 dark:bg-blue-900/40 dark:text-blue-100 dark:ring-blue-800/60">
            <SparklesIcon className="h-4 w-4" />
            {t('navigation.series')}
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">
            {t('workspaces.series.title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
            {t('workspaces.series.description')}
          </p>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={refreshSeries}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <ArrowPathIcon className="h-5 w-5" />
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <PlusIcon className="h-5 w-5" />
            {t('workspaces.series.newSeries')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="rounded-full bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
            <BookOpenIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('workspaces.series.stats.total')}</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-50">{stats.total}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200">
            <ClipboardDocumentListIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('workspaces.series.stats.active')}</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-50">{stats.active}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="rounded-full bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200">
            <ClockIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('workspaces.series.stats.drafts')}</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-50">{stats.drafts}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="rounded-full bg-purple-100 p-2.5 text-purple-700 dark:bg-purple-900/60 dark:text-purple-200">
            <CheckCircleIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('workspaces.series.stats.completed')}</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-50">{stats.completed}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-800/50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-grow">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('common.search', { defaultValue: 'Search by title, book, theme...' })}
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              >
                <span aria-hidden>×</span>
                <span className="sr-only">Clear search</span>
              </button>
            )}
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <div className="relative flex-1 sm:min-w-[180px]">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="appearance-none w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-3 pr-10 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="all">{t('workspaces.series.filter.allStatuses')}</option>
                <option value="active">{t('workspaces.series.form.statuses.active')}</option>
                <option value="draft">{t('workspaces.series.form.statuses.draft')}</option>
                <option value="completed">{t('workspaces.series.form.statuses.completed')}</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                <ChevronIcon direction="down" className="h-4 w-4" />
              </div>
            </div>

            <div className="relative flex-1 sm:min-w-[180px]">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="appearance-none w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-3 pr-10 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="recent">{t('workspaces.series.sort.newest')}</option>
                <option value="title">{t('workspaces.series.sort.titleAZ')}</option>
                <option value="sermons">{t('workspaces.series.sort.mostSermons')}</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                <ChevronIcon direction="down" className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <SeriesGridSkeleton />
      ) : filteredSeries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-14 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200">
            <PlusIcon className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('workspaces.series.noSeries')}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('workspaces.series.createFirstSeries')}
          </p>
          <div className="mt-5 flex justify-center">
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <PlusIcon className="h-5 w-5" />
              {t('workspaces.series.newSeries')}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="series-grid">
          {filteredSeries.map((s) => (
            <Link key={s.id} href={`/series/${s.id}`} className="block">
              <SeriesCard series={s} />
            </Link>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateSeriesModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateSeries} />
      )}
    </div>
  );
}
