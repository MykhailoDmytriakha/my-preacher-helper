'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useSeries } from '@/hooks/useSeries';
import { useAuth } from '@/providers/AuthProvider';
import { toast } from 'sonner';
import SermonInSeriesCard from '@/components/series/SermonInSeriesCard';
import EditSeriesModal from '@/components/series/EditSeriesModal';
import AddSermonToSeriesModal from '@/components/series/AddSermonToSeriesModal';
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import '@locales/i18n';

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
    addSermon,
    addSermons,
    removeSermon,
    reorderSeriesSermons,
    updateSeriesDetail
  } = useSeriesDetail(seriesId);

  const { user } = useAuth();
  const { deleteExistingSeries } = useSeries(user?.uid || null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddSermonModal, setShowAddSermonModal] = useState(false);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !series) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    // Create new sermon IDs array with reordered items
    const reorderedSermonIds = [...sermons.map(s => s.id)];
    const [moved] = reorderedSermonIds.splice(sourceIndex, 1);
    reorderedSermonIds.splice(destinationIndex, 0, moved);

    reorderSeriesSermons(reorderedSermonIds);
  };

  const handleRemoveSermon = async (sermonId: string) => {
    if (window.confirm(t('workspaces.series.actions.removeFromSeries') + '?')) {
      await removeSermon(sermonId);
    }
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4 dark:bg-gray-700"></div>
          <div className="h-6 bg-gray-200 rounded w-1/2 mb-2 dark:bg-gray-700"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4 dark:bg-gray-700"></div>
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded dark:bg-gray-700"></div>
          ))}
        </div>
      </div>
    );
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

  const completedSermons = sermons.filter(s => s.isPreached).length;
  const statusColors = {
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <button
            onClick={() => router.push('/series')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Back to Series
          </button>

          <div className="flex items-start gap-4">
            {/* Color indicator */}
            {series.color && (
              <div
                className="w-4 h-16 rounded-full flex-shrink-0 mt-1"
                style={{ backgroundColor: series.color }}
              />
            )}

            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {series.title}
                </h1>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColors[series.status]}`}>
                  {t(`workspaces.series.form.statuses.${series.status}`)}
                </span>
              </div>

              <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
                {series.theme}
              </p>

              {series.description && (
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  {series.description}
                </p>
              )}

              <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
                <span>{t('workspaces.series.detail.sermonCount', { count: sermons.length })}</span>
                {completedSermons > 0 && (
                  <span>{t('workspaces.series.detail.completedCount', { completed: completedSermons, total: sermons.length })}</span>
                )}
                {series.startDate && (
                  <span>Started {new Date(series.startDate).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <PencilIcon className="h-4 w-4" />
            {t('workspaces.series.editSeries')}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-950"
          >
            <TrashIcon className="h-4 w-4" />
            {t('workspaces.series.deleteSeries')}
          </button>
        </div>
      </div>

      {/* Sermons Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('workspaces.series.detail.sermonsInSeries')}
          </h2>
          <button
            onClick={() => setShowAddSermonModal(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            <PlusIcon className="h-4 w-4" />
            {t('workspaces.series.actions.addSermon')}
          </button>
        </div>

        {sermons.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {t('workspaces.series.detail.noSermons')}
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {t('workspaces.series.detail.addSermons')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t('workspaces.series.detail.dragToReorder')}
            </p>

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="sermons-list">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`space-y-2 ${snapshot.isDraggingOver ? 'bg-blue-50 rounded-lg p-2 dark:bg-blue-950/20' : ''}`}
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
          onUpdate={async (seriesId, updates) => {
            await updateSeriesDetail(updates);
            setShowEditModal(false);
          }}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Delete Series
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('workspaces.series.deleteSeriesConfirm')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSeries}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-white hover:bg-red-600"
              >
                Delete
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
          currentSeriesSermonIds={sermons.map(s => s.id)}
        />
      )}
    </div>
  );
}
