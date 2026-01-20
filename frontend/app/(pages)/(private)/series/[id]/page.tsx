'use client';

import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { SparklesIcon, ClockIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import AddSermonToSeriesModal from '@/components/series/AddSermonToSeriesModal';
import EditSeriesModal from '@/components/series/EditSeriesModal';
import SermonInSeriesCard from '@/components/series/SermonInSeriesCard';
import { SeriesDetailSkeleton } from '@/components/skeletons/SeriesDetailSkeleton';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useAuth } from '@/providers/AuthProvider';


import '@locales/i18n';

// Translation keys constants
const TRANSLATION_KEYS = {
  ADD_SERMON: 'workspaces.series.actions.addSermon',
} as const;

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const seriesId = typeof id === 'string' ? id : '';

  const {
    series,
    sermons,
    loading,
    error,
    addSermons,
    removeSermon,
    reorderSeriesSermons,
    updateSeriesDetail,
    refreshSeriesDetail
  } = useSeriesDetail(seriesId);

  const { user } = useAuth();
  const { deleteExistingSeries } = useSeries(user?.uid || null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddSermonModal, setShowAddSermonModal] = useState(false);
  const [sermonToRemove, setSermonToRemove] = useState<string | null>(null);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !series) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    const reorderedSermonIds = [...sermons.map((s) => s.id)];
    const [moved] = reorderedSermonIds.splice(sourceIndex, 1);
    reorderedSermonIds.splice(destinationIndex, 0, moved);

    reorderSeriesSermons(reorderedSermonIds);
  };

  const handleRemoveSermon = async (sermonId: string) => {
    setSermonToRemove(sermonId);
  };

  const handleAddSermonsToSeries = async (sermonIds: string[]) => {
    try {
      await addSermons(sermonIds);
      toast.success(t('workspaces.series.sermonsAdded', { count: sermonIds.length }));
    } catch (error) {
      console.error('Error adding sermons to series:', error);
      toast.error(t('workspaces.series.errors.addSermonFailed'));
    }
  };

  const handleDeleteSeries = async () => {
    if (!series) return;

    if (window.confirm(t('workspaces.series.deleteSeriesConfirm'))) {
      try {
        await deleteExistingSeries(series.id);
        toast.success(t('workspaces.series.seriesDeleted'));
        router.push('/series');
      } catch (error) {
        console.error('Error deleting series:', error);
        toast.error(t('workspaces.series.errors.deleteFailed'));
      }
    }
    setShowDeleteConfirm(false);
  };

  const progress = useMemo(() => {
    const total = sermons.length;
    const completed = sermons.filter((s) => s.isPreached).length;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
    return { total, completed, percent };
  }, [sermons]);

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
          Back to Series
        </button>

        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>Series not found or failed to load.</p>
        </div>
      </div>
    );
  }

  const completedSermons = sermons.filter((s) => s.isPreached).length;
  const statusColors = {
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  };

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-gray-200/70 bg-gradient-to-br from-blue-600/10 via-indigo-600/10 to-purple-600/10 p-6 shadow-sm dark:border-gray-800 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-purple-500/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <button
              onClick={() => router.push('/series')}
              className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-900/80 dark:text-gray-200 dark:ring-gray-800"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {t('navigation.series')}
            </button>

            <div className="flex items-start gap-3">
              {series.color && (
                <div className="mt-1 h-14 w-2 rounded-full shadow-inner" style={{ background: series.color }} />
              )}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{series.title}</h1>
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColors[series.status]}`}>
                    {t(`workspaces.series.form.statuses.${series.status}`)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900/70 dark:text-gray-200 dark:ring-gray-800">
                    <SparklesIcon className="h-4 w-4 text-amber-500" />
                    {series.bookOrTopic}
                  </span>
                </div>
                <p className="text-gray-700 dark:text-gray-300">{series.theme}</p>
                {series.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 max-w-3xl">{series.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                  <span>{t('workspaces.series.detail.sermonCount', { count: sermons.length })}</span>
                  {completedSermons > 0 && (
                    <span>{t('workspaces.series.detail.completedCount', { completed: completedSermons, total: sermons.length })}</span>
                  )}
                  {series.startDate && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 ring-1 ring-gray-200 dark:bg-gray-900/70 dark:ring-gray-800">
                      <ClockIcon className="h-4 w-4 text-emerald-500" />
                      {new Date(series.startDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowAddSermonModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t(TRANSLATION_KEYS.ADD_SERMON)}
            </button>
            <button
              onClick={() => setShowEditModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              <PencilIcon className="h-4 w-4" />
              {t('workspaces.series.editSeries')}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 dark:border-red-700/60 dark:bg-red-900/40 dark:text-red-200"
            >
              <TrashIcon className="h-4 w-4" />
              {t('workspaces.series.deleteSeries')}
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('workspaces.series.detail.sermonsInSeries')}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{progress.total}</span>
              <span className="text-xs text-gray-500">{t('workspaces.series.detail.sermonCount', { count: progress.total })}</span>
            </div>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('dashboard.preached')}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-300">{progress.completed}</span>
              <span className="text-xs text-gray-500">{t('dashboard.preached')}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ring-gray-200 dark:ring-gray-700">
              <span className={`h-2 w-2 rounded-full ${series.status === 'completed' ? 'bg-emerald-500' : series.status === 'active' ? 'bg-blue-500' : 'bg-gray-400'}`} />
              {t(`workspaces.series.form.statuses.${series.status}`)}
            </div>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200 backdrop-blur dark:bg-gray-900/80 dark:ring-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Last updated</p>
            <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {series.updatedAt ? new Date(series.updatedAt).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Sermons Section */}
      <div className="space-y-4 rounded-2xl border border-gray-200/70 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('workspaces.series.detail.sermonsInSeries')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('workspaces.series.detail.dragToReorder')}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddSermonModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t(TRANSLATION_KEYS.ADD_SERMON)}
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

        {sermons.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white/60 px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-900/60">
            <p className="text-gray-600 dark:text-gray-300">{t('workspaces.series.detail.noSermons')}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('workspaces.series.detail.addSermons')}</p>
            <button
              onClick={() => setShowAddSermonModal(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t(TRANSLATION_KEYS.ADD_SERMON)}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="sermons-list">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`space-y-3 rounded-xl border border-dashed border-gray-200 p-3 dark:border-gray-700 ${
                      snapshot.isDraggingOver ? 'bg-blue-50/80 dark:bg-blue-900/20' : 'bg-white/40 dark:bg-gray-900/40'
                    }`}
                  >
                    {sermons.map((sermon, index) => (
                      <Draggable key={sermon.id} draggableId={sermon.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={provided.draggableProps.style}
                          >
                            <SermonInSeriesCard
                              sermon={sermon}
                              position={index + 1}
                              onRemove={handleRemoveSermon}
                              isDragging={snapshot.isDragging}
                              dragHandleProps={provided.dragHandleProps}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <EditSeriesModal
          series={series}
          onClose={() => setShowEditModal(false)}
          onUpdate={async (_seriesId, updates) => {
            await updateSeriesDetail(updates);
            setShowEditModal(false);
          }}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('workspaces.series.deleteSeries')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspaces.series.deleteSeriesConfirm')}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSeries}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Sermon Confirmation */}
      {sermonToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('workspaces.series.actions.removeFromSeries')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspaces.series.detail.dragToReorder', { defaultValue: 'This sermon will be detached from the series.' })}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSermonToRemove(null)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await removeSermon(sermonToRemove);
                  setSermonToRemove(null);
                }}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {t('workspaces.series.actions.removeFromSeries')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Sermon Modal */}
      {showAddSermonModal && series && (
        <AddSermonToSeriesModal
          onClose={() => setShowAddSermonModal(false)}
          onAddSermons={handleAddSermonsToSeries}
          currentSeriesSermonIds={sermons.map((s) => s.id)}
          seriesId={seriesId}
        />
      )}
    </div>
  );
}
