'use client';

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { ArrowPathIcon, ClockIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import AddSermonModal from '@/components/AddSermonModal';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import AddGroupToSeriesModal from '@/components/series/AddGroupToSeriesModal';
import AddSermonToSeriesModal from '@/components/series/AddSermonToSeriesModal';
import EditSeriesModal from '@/components/series/EditSeriesModal';
import SeriesItemCard from '@/components/series/SeriesItemCard';
import { SeriesDetailSkeleton } from '@/components/skeletons/SeriesDetailSkeleton';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useAuth } from '@/providers/AuthProvider';
import { debugLog } from '@/utils/debugMode';
import { getEffectiveIsPreached } from '@/utils/preachDateStatus';

type ModalState = 'add-sermon' | 'add-group' | 'create-new-sermon' | null;

const MODAL_STATES = {
  ADD_SERMON: 'add-sermon' as const,
  ADD_GROUP: 'add-group' as const,
  CREATE_NEW_SERMON: 'create-new-sermon' as const,
};

const TRANSLATION_KEYS = {
  DELETE_SERIES: 'workspaces.series.deleteSeries',
};

type PendingRemoval = {
  type: 'sermon' | 'group';
  refId: string;
} | null;

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const seriesId = typeof id === 'string' ? id : '';

  const {
    series,
    items,
    sermons,
    groups,
    loading,
    error,
    addSermons,
    addGroup,
    removeItem,
    reorderMixedItems,
    updateSeriesDetail,
    refreshSeriesDetail,
    isRefetching,
  } = useSeriesDetail(seriesId);

  const [optimisticItems, setOptimisticItems] = useState(items);

  const { user } = useAuth();
  const { deleteExistingSeries } = useSeries(user?.uid || null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);

  // Sync optimistic items with server items when server items change
  // but only when not fetching (to avoid interrupting DND state)
  useEffect(() => {
    if (!isRefetching) {
      setOptimisticItems(items);
    }
  }, [items, isRefetching]);

  const showAddSermonModal = modalState === MODAL_STATES.ADD_SERMON;
  const showAddGroupModal = modalState === MODAL_STATES.ADD_GROUP;
  const showCreateSermonModal = modalState === MODAL_STATES.CREATE_NEW_SERMON;

  const openAddSermonModal = () => setModalState(MODAL_STATES.ADD_SERMON);
  const openAddGroupModal = () => setModalState(MODAL_STATES.ADD_GROUP);
  const openCreateSermonModal = () => setModalState(MODAL_STATES.CREATE_NEW_SERMON);
  const closeModals = () => setModalState(null);
  const cancelCreateSermon = () => setModalState(MODAL_STATES.ADD_SERMON);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !series) {
      return;
    }

    const oldIndex = optimisticItems.findIndex((item) => item.item.id === active.id);
    const newIndex = optimisticItems.findIndex((item) => item.item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // 1. Update optimistic UI immediately
    const nextItems = arrayMove(optimisticItems, oldIndex, newIndex);
    setOptimisticItems(nextItems);

    // 2. Persist to backend
    const nextItemIds = nextItems.map((entry) => entry.item.id);

    try {
      await reorderMixedItems(nextItemIds);
    } catch (errorValue) {
      console.error('Error reordering series items:', errorValue);
      toast.error(t('workspaces.series.errors.reorderFailed'));
      // Rollback on error
      setOptimisticItems(items);
    }
  };

  const handleDeleteSeries = async () => {
    if (!series) return;
    try {
      await deleteExistingSeries(series.id);
      toast.success(t('workspaces.series.seriesDeleted'));
      router.push('/series');
    } catch (errorValue) {
      console.error('Error deleting series:', errorValue);
      toast.error(t('workspaces.series.errors.deleteFailed'));
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleAddSermons = async (sermonIds: string[]) => {
    try {
      await addSermons(sermonIds);
      toast.success(t('workspaces.series.sermonsAdded', { count: sermonIds.length }));
    } catch (errorValue) {
      console.error('Error adding sermons to series:', errorValue);
      toast.error(t('workspaces.series.errors.addSermonFailed'));
      throw errorValue;
    }
  };

  const handleAddGroups = async (groupIds: string[]) => {
    if (!series) return;
    try {
      await Promise.all(
        groupIds.map((groupId, index) => addGroup(groupId, (series.items?.length || 0) + index))
      );
      toast.success(
        t('workspaces.series.groupsAdded', {
          count: groupIds.length,
          defaultValue: `${groupIds.length} groups added`,
        })
      );
    } catch (errorValue) {
      console.error('Error adding groups to series:', errorValue);
      toast.error(
        t('workspaces.series.errors.addGroupFailed', {
          defaultValue: 'Failed to add groups to series',
        })
      );
      throw errorValue;
    }
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemoval) return;
    try {
      await removeItem(pendingRemoval.type, pendingRemoval.refId);
      setPendingRemoval(null);
    } catch (errorValue) {
      console.error('Error removing item from series:', errorValue);
      toast.error(
        t('workspaces.series.errors.removeSermonFailed', {
          defaultValue: 'Failed to remove item from series',
        })
      );
    }
  };

  const stats = useMemo(() => {
    const total = items.length;
    const sermonsCount = items.filter((entry) => entry.item.type === 'sermon').length;
    const groupsCount = items.filter((entry) => entry.item.type === 'group').length;
    const completedSermons = items.filter(
      (entry) => entry.item.type === 'sermon' && Boolean(entry.sermon && getEffectiveIsPreached(entry.sermon))
    ).length;
    const conductedGroups = items.filter(
      (entry) => entry.item.type === 'group' && (entry.group?.meetingDates || []).length > 0
    ).length;
    return { total, sermonsCount, groupsCount, completedSermons, conductedGroups };
  }, [items]);

  if (loading) {
    return <SeriesDetailSkeleton />;
  }

  if (error || !series) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.push('/series')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          {t('navigation.series')}
        </button>

        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>{t('workspaces.series.errors.updateFailed', { defaultValue: 'Series not found or failed to load.' })}</p>
        </div>
      </div>
    );
  }

  const statusColors = {
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  };

  return (
    <div className="space-y-7">
      <div className="overflow-hidden rounded-3xl border border-gray-200/70 bg-gradient-to-br from-blue-600/10 via-indigo-600/10 to-cyan-600/10 p-6 shadow-sm dark:border-gray-800 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-cyan-500/10">
        <div className="flex flex-col gap-6">
          {/* Top Section: Back Button and Title */}
          <div className="space-y-4">
            <button
              onClick={() => router.push('/series')}
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
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColors[series.status]}`}>
                      {t(`workspaces.series.form.statuses.${series.status}`)}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900/70 dark:text-gray-200 dark:ring-gray-800">
                      <SparklesIcon className="h-4 w-4 text-amber-500" />
                      {series.bookOrTopic}
                    </span>
                    {series.seriesKind && (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800/60">
                        {t(`workspaces.series.kind.${series.seriesKind}`, {
                          defaultValue: series.seriesKind,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons: Always in a dedicated row below the title */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={openAddSermonModal}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:w-auto sm:min-w-[180px]"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addSermon')}
            </button>
            <button
              onClick={openAddGroupModal}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 sm:w-auto sm:min-w-[180px]"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addGroup', { defaultValue: 'Add group' })}
            </button>
            <button
              onClick={() => setShowEditModal(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:w-auto sm:min-w-[180px]"
            >
              <PencilIcon className="h-4 w-4" />
              {t('workspaces.series.editSeries')}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 dark:border-red-700/60 dark:bg-red-900/40 dark:text-red-200 sm:w-auto sm:min-w-[180px]"
            >
              <TrashIcon className="h-4 w-4" />
              {t(TRANSLATION_KEYS.DELETE_SERIES)}
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
                {t('workspaces.series.detail.sermonCount', {
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
            {t('calendar.analytics.totalPreachings', { defaultValue: 'Meetings' })}
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
              {t('workspaces.series.detail.dragToReorder')}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={openAddSermonModal}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addSermon')}
            </button>
            <button
              onClick={openAddGroupModal}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.series.actions.addGroup', { defaultValue: 'Add group' })}
            </button>
            <button
              onClick={refreshSeriesDetail}
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={optimisticItems.map((entry) => entry.item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {optimisticItems.map((entry, index) => (
                  <SeriesItemCard
                    key={entry.item.id}
                    id={entry.item.id}
                    position={index + 1}
                    resolvedItem={entry}
                    onRemove={(type, refId) => setPendingRemoval({ type, refId })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {showEditModal && (
        <EditSeriesModal
          series={series}
          onClose={() => setShowEditModal(false)}
          onUpdate={async (_id, updates) => {
            await updateSeriesDetail(updates);
            setShowEditModal(false);
          }}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t(TRANSLATION_KEYS.DELETE_SERIES)}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('workspaces.series.deleteSeriesConfirm')}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleDeleteSeries}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {t(TRANSLATION_KEYS.DELETE_SERIES)}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('workspaces.series.actions.removeFromSeries')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {pendingRemoval.type === 'sermon'
                    ? t('workspaces.series.detail.removeSermonHint', {
                      defaultValue: 'This sermon will be detached from the series.',
                    })
                    : t('workspaces.series.detail.removeGroupHint', {
                      defaultValue: 'This group will be detached from the series.',
                    })}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingRemoval(null)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleConfirmRemove}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {t('workspaces.series.actions.removeFromSeries')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSermonModal && (
        <AddSermonToSeriesModal
          onClose={closeModals}
          onCreateNewSermon={openCreateSermonModal}
          onAddSermons={handleAddSermons}
          currentSeriesSermonIds={sermons.map((sermon) => sermon.id)}
          seriesId={seriesId}
        />
      )}

      {showAddGroupModal && (
        <AddGroupToSeriesModal
          onClose={closeModals}
          onAddGroups={handleAddGroups}
          currentSeriesGroupIds={groups.map((group) => group.id)}
        />
      )}

      {showCreateSermonModal && (
        <AddSermonModal
          showTriggerButton={false}
          isOpen
          onCancel={cancelCreateSermon}
          preSelectedSeriesId={seriesId}
          onNewSermonCreated={async (newSermon) => {
            debugLog('New sermon created, starting to add to series:', newSermon.id);
            try {
              await handleAddSermons([newSermon.id]);
              closeModals();
              setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['series-detail', seriesId] });
              }, 100);
            } catch (errorValue) {
              console.error('Error adding new sermon to series:', errorValue);
            }
          }}
        />
      )}
    </div>
  );
}
