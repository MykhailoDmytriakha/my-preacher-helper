'use client';

import { ArrowLeftIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon, ClockIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import { Chip } from '@/components/ui/Chip';
import { getEffectiveIsPreached } from '@/utils/preachDateStatus';

import type { Group, Series, SeriesItem, Sermon } from '@/models/models';
import type { ChipTone } from '@/utils/chipClasses';

export type ResolvedSeriesItem = { item: SeriesItem; sermon?: Sermon; group?: Group };
const SERIES_STATUS_TONES: Record<string, ChipTone> = { draft: 'neutral', active: 'blue', completed: 'emerald' };

/** Shared presentation; opening ancestors, delivery and draft ownership belong to callers. */
export function SeriesDetailView({ series, items, onBack, onAddSermons, onAddGroups, onEdit, onDelete, onRefresh,
  feedback, itemsContent, reorderHint, children }: {
  series: Series; items: ResolvedSeriesItem[];
  onBack: () => void; onAddSermons: () => void; onAddGroups: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void;
  feedback?: ReactNode; itemsContent: ReactNode; reorderHint?: ReactNode; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const stats = useMemo(() => ({ total: items.length,
    sermonsCount: items.filter(entry => entry.item.type === 'sermon').length,
    groupsCount: items.filter(entry => entry.item.type === 'group').length,
    completedSermons: items.filter(entry => entry.item.type === 'sermon' && Boolean(entry.sermon && getEffectiveIsPreached(entry.sermon))).length,
    conductedGroups: items.filter(entry => entry.item.type === 'group' && (entry.group?.meetingDates || []).length > 0).length,
  }), [items]);
  return <div className="space-y-7">
    {feedback}
      <div className="overflow-hidden rounded-3xl border border-gray-200/70 bg-gradient-to-br from-blue-600/10 via-indigo-600/10 to-cyan-600/10 p-6 shadow-sm dark:border-gray-800 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-cyan-500/10">
        <div className="flex flex-col gap-6">
          {/* Top Section: Back Button and Title */}
          <div className="space-y-4">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-900/80 dark:text-gray-200 dark:ring-gray-800"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {t('navigation.series')}
            </button>

            <div className="flex items-start gap-4">
              {series.color && (
                <div className="mt-1 h-10 w-1.5 rounded-full shadow-inner" style={{ background: series.color }} />
              )}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{series.title}</h1>
                  <div className="flex flex-wrap gap-2">
                    <Chip tone={SERIES_STATUS_TONES[series.status] ?? 'neutral'}>
                      {t(`workspaces.series.form.statuses.${series.status}`)}
                    </Chip>
                    <Chip tone="neutral" className="gap-2 uppercase tracking-wide" icon={<SparklesIcon className="h-4 w-4 text-amber-500" />}>
                      {series.bookOrTopic}
                    </Chip>
                    {series.seriesKind && (
                      <Chip tone="emerald">
                        {t(`workspaces.series.kind.${series.seriesKind}`, {
                          defaultValue: series.seriesKind,
                        })}
                      </Chip>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons: Always in a dedicated row below the title */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onAddSermons}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:w-auto sm:min-w-[180px]"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addSermon')}
            </button>
            <button
              onClick={onAddGroups}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 sm:w-auto sm:min-w-[180px]"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addGroup', { defaultValue: 'Add group' })}
            </button>
            <button
              onClick={onEdit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:w-auto sm:min-w-[180px]"
            >
              <PencilIcon className="h-4 w-4" />
              {t('workspaces.series.editSeries')}
            </button>
            <button
              onClick={onDelete}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 dark:border-red-700/60 dark:bg-red-900/40 dark:text-red-200 sm:w-auto sm:min-w-[180px]"
            >
              <TrashIcon className="h-4 w-4" />
              {t('workspaces.series.deleteSeries')}
            </button>
          </div>

          {/* Bottom Section: Theme, Description and Stats bar */}
          <div className="flex flex-col gap-4 border-t border-gray-100/50 pt-6 dark:border-gray-800/50">
            <div className="space-y-2">
              <p className="font-medium text-gray-700 dark:text-gray-300">{series.theme}</p>
              {series.description && (
                <MarkdownDisplay
                  content={series.description}
                  className="max-w-none text-gray-600 dark:text-gray-400"
                  compact
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/40 px-3 py-1 ring-1 ring-gray-100/50 dark:bg-gray-900/40 dark:ring-gray-800/50">
                {t('workspaces.series.detail.itemCount', {
                  count: stats.total,
                  defaultValue: `${stats.total} items`,
                })}
              </span>
              {series.startDate && (
                <span className="inline-flex items-center gap-2 rounded-full bg-white/40 px-3 py-1 ring-1 ring-gray-100/50 dark:bg-gray-900/40 dark:ring-gray-800/50">
                  <ClockIcon className="h-4 w-4 text-emerald-500" />
                  {new Date(series.startDate).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('workspaces.series.detail.sermonsInSeries', { defaultValue: 'Items in series' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</span>
        </div>
        <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('navigation.sermons', { defaultValue: 'Sermons' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-blue-600 dark:text-blue-300">
            {stats.sermonsCount}
          </span>
        </div>
        <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('navigation.groups', { defaultValue: 'Groups' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-emerald-600 dark:text-emerald-300">
            {stats.groupsCount}
          </span>
        </div>
        <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('dashboard.preached', { defaultValue: 'Preached' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-purple-600 dark:text-purple-300">
            {stats.completedSermons}
          </span>
        </div>
        <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('workspaces.series.detail.conductedMeetings', { defaultValue: 'Meetings' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-amber-600 dark:text-amber-300">
            {stats.conductedGroups}
          </span>
        </div>
      </div>
      <div className="space-y-4 rounded-2xl border border-gray-200/70 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('workspaces.series.detail.sermonsInSeries', { defaultValue: 'Items in series' })}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {reorderHint ?? t('workspaces.series.detail.dragToReorder')}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onAddSermons}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addSermon')}
            </button>
            <button
              onClick={onAddGroups}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addGroup', { defaultValue: 'Add group' })}
            </button>
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <ArrowPathIcon className="h-4 w-4" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white/60 px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-900/60">
            <p className="text-gray-600 dark:text-gray-300">
              {t('workspaces.series.detail.noSermons', { defaultValue: 'No items in this series yet.' })}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('workspaces.series.detail.addSermons', {
                defaultValue: 'Add sermons and groups to start building this series.',
              })}
            </p>
          </div>
        ) : (
          itemsContent
        )}
      </div>

    {children}
  </div>;
}
