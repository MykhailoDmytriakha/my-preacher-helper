"use client";

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bars3Icon, BookOpenIcon, UserGroupIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import { Chip } from '@/components/ui/Chip';
import { formatDate } from '@utils/dateFormatter';
import { getEffectiveIsPreached } from '@utils/preachDateStatus';

import type { Group, SeriesItem, Sermon } from '@/models/models';

type ResolvedSeriesItem = {
  item: SeriesItem;
  sermon?: Sermon;
  group?: Group;
};

interface SeriesItemCardProps {
  resolvedItem: ResolvedSeriesItem;
  position: number;
  onRemove?: (type: 'sermon' | 'group', refId: string) => void;
  id: string;
}

const sermonPreview = (sermon: Sermon) =>
  sermon.preparation?.thesis?.oneSentence || sermon.thoughts?.[0]?.text || '';

export default function SeriesItemCard({
  resolvedItem,
  position,
  onRemove,
  id,
}: SeriesItemCardProps) {
  const { t } = useTranslation();
  const { item, sermon, group } = resolvedItem;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  const isSermon = item.type === 'sermon';
  const sermonIsPreached = sermon ? getEffectiveIsPreached(sermon) : false;
  const title = isSermon ? sermon?.title : group?.title;
  const href = isSermon ? `/sermons/${item.refId}` : `/groups/${item.refId}`;
  const subtitle = isSermon ? sermon?.verse : group?.description;
  const preview = isSermon && sermon ? sermonPreview(sermon) : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative flex gap-4 rounded-xl border border-gray-200 bg-white/90 p-4 shadow-sm ring-1 ring-gray-100 dark:border-gray-700 dark:bg-gray-900/70 dark:ring-gray-800 ${isDragging ? 'shadow-lg ring-2 ring-blue-500/40' : 'hover:shadow-md'
        }`}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-800/70">
          {position}
        </div>
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300 touch-none outline-none"
          title={t('workspaces.series.detail.dragToReorder')}
        >
          <Bars3Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Chip
            tone={isSermon ? 'blue' : 'emerald'}
            size="sm"
            icon={isSermon ? <BookOpenIcon className="h-3.5 w-3.5" /> : <UserGroupIcon className="h-3.5 w-3.5" />}
          >
            {isSermon ? t('navigation.sermons', { defaultValue: 'Sermons' }) : t('navigation.groups', { defaultValue: 'Groups' })}
          </Chip>
          {isSermon && sermonIsPreached && (
            <Chip tone="emerald" size="sm">
              {t('dashboard.preached')}
            </Chip>
          )}
          {!isSermon && (group?.meetingDates || []).length > 0 && (
            <Chip tone="amber" size="sm">
              {t('calendar.analytics.totalPreachings', { defaultValue: 'Meetings' })}: {(group?.meetingDates || []).length}
            </Chip>
          )}
        </div>

        <Link href={href} className="block">
          <h3 className="text-lg font-semibold text-gray-900 transition-colors hover:text-blue-600 dark:text-gray-50 dark:hover:text-blue-400">
            {title || t('common.unknown', { defaultValue: 'Unknown item' })}
          </h3>
        </Link>

        {subtitle && (
          <div className="line-clamp-1 text-sm italic text-gray-600 dark:text-gray-400">
            <MarkdownDisplay content={subtitle} compact className="!text-sm !italic prose-p:my-0" />
          </div>
        )}

        {preview && (
          <div className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
            <MarkdownDisplay content={preview} compact className="!text-sm prose-p:my-0" />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Chip tone="neutral" size="sm">
            {isSermon ? formatDate(sermon?.date || '') : formatDate(group?.updatedAt || '')}
          </Chip>
          {isSermon && (
            <Chip tone="blue" size="sm">
              {sermon?.thoughts?.length || 0} {t('dashboard.thoughts')}
            </Chip>
          )}
          {!isSermon && (
            <Chip tone="violet" size="sm">
              {(group?.flow || []).length} {t('workspaces.groups.itemsLabel.flowSteps', { defaultValue: 'flow steps' })}
            </Chip>
          )}
        </div>
      </div>

      {onRemove && (
        <button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove(item.type, item.refId);
          }}
          className="self-start rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-300"
          title={t('workspaces.series.actions.removeFromSeries')}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
