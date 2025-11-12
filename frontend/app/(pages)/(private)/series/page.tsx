'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useSeries } from '@/hooks/useSeries';
import SeriesCard from '@/components/series/SeriesCard';
import CreateSeriesModal from '@/components/series/CreateSeriesModal';
import { PlusIcon } from '@heroicons/react/24/outline';
import '@locales/i18n';

export default function SeriesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { series, loading, error, createNewSeries } = useSeries(user?.uid || null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleCreateSeries = async (seriesData: Parameters<typeof createNewSeries>[0]) => {
    await createNewSeries(seriesData);
    setShowCreateModal(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2 dark:bg-gray-700"></div>
          <div className="h-8 bg-gray-200 rounded w-1/2 mb-4 dark:bg-gray-700"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4 dark:bg-gray-700"></div>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">{t('workspaces.series.loadingSeries')}</p>
        </div>
      </div>
    );
  }

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t('navigation.series')}
        </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
          {t('workspaces.series.description')}
        </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 transition-colors"
        >
          <PlusIcon className="h-5 w-5" />
          {t('workspaces.series.newSeries')}
        </button>
      </div>

      {/* Series Grid */}
      {series.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4 dark:bg-gray-800">
            <PlusIcon className="h-12 w-12 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t('workspaces.series.noSeries')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('workspaces.series.createFirstSeries')}
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 text-white hover:bg-blue-600 transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            {t('workspaces.series.newSeries')}
          </button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
      </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateSeriesModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateSeries}
        />
      )}
      </div>
  );
}
