"use client";

import { XMarkIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import AddSermonModal from '@/components/AddSermonModal';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { matchesSermonQuery, tokenizeQuery } from '@/utils/sermonSearch';
import { formatDate } from '@utils/dateFormatter';

interface AddSermonToSeriesModalProps {
  onClose: () => void;
  onAddSermons: (sermonIds: string[]) => void;
  currentSeriesSermonIds: string[];
  seriesId: string;
}

export default function AddSermonToSeriesModal({
  onClose,
  onAddSermons,
  currentSeriesSermonIds,
  seriesId
}: AddSermonToSeriesModalProps) {
  const { t } = useTranslation();
  const { sermons, loading: sermonsLoading } = useDashboardSermons();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSermonIds, setSelectedSermonIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [showCreateSermonModal, setShowCreateSermonModal] = useState(false);

  const availableSermons = useMemo(
    () => sermons.filter((sermon) => !currentSeriesSermonIds.includes(sermon.id)),
    [sermons, currentSeriesSermonIds]
  );

  const filteredSermons = useMemo(() => {
    if (!searchQuery.trim()) return availableSermons;
    const tokens = tokenizeQuery(searchQuery);
    return availableSermons.filter((sermon) =>
      matchesSermonQuery(sermon, tokens, {
        searchInTitleVerse: true,
        searchInThoughts: true,
        searchInTags: true,
      })
    );
  }, [availableSermons, searchQuery]);

  const handleToggleSermon = (sermonId: string) => {
    const next = new Set(selectedSermonIds);
    if (next.has(sermonId)) {
      next.delete(sermonId);
    } else {
      next.add(sermonId);
    }
    setSelectedSermonIds(next);
  };

  const handleAddSelected = async () => {
    if (selectedSermonIds.size === 0) return;
    setIsAdding(true);
    try {
      await onAddSermons(Array.from(selectedSermonIds));
      onClose();
    } finally {
      setIsAdding(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800 flex flex-col">
        <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-500" />
        <div className="p-6 sm:p-7 flex flex-col flex-1 overflow-hidden">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-900/30 dark:text-blue-100 dark:ring-blue-800/60">
                {t('workspaces.series.actions.addSermon')}
              </p>
              <h2 className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">
                {t('workspaces.series.detail.selectSermonsTitle')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('workspaces.series.detail.selectSermonsDescription')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="relative mb-4">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.search') || 'Search sermons...'}
              className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            {sermonsLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-b-transparent border-blue-600 mr-3" />
                {t('workspaces.series.loadingSeries')}
              </div>
            ) : filteredSermons.length === 0 ? (
              <div className="text-center py-10 text-gray-500 dark:text-gray-400">
                {searchQuery.trim()
                  ? t('workspaces.series.detail.noSermonsFound')
                  : t('workspaces.series.detail.noSermonsAvailable')}
                {searchQuery.trim() && (
                  <div>
                    <button
                      onClick={() => setSearchQuery('')}
                      className="mt-2 text-blue-600 hover:text-blue-700"
                    >
                      {t('workspaces.series.detail.clearSearch')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSermons.map((sermon) => {
                  const preview =
                    sermon.preparation?.thesis?.oneSentence || sermon.thoughts?.[0]?.text || '';
                  return (
                    <div
                      key={sermon.id}
                      className={`cursor-pointer rounded-xl border p-3 transition bg-white/80 dark:bg-gray-800/70 ${
                        selectedSermonIds.has(sermon.id)
                          ? 'border-blue-500 ring-2 ring-blue-500/20'
                          : 'border-gray-200 hover:border-blue-200 hover:shadow-sm dark:border-gray-700'
                      }`}
                      onClick={() => handleToggleSermon(sermon.id)}
                    >
                      <div className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={selectedSermonIds.has(sermon.id)}
                          onChange={() => handleToggleSermon(sermon.id)}
                          className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 shadow-sm focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                              {sermon.title}
                            </h3>
                            {sermon.isPreached && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                                {t('dashboard.preached')}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1 italic">
                            {sermon.verse}
                          </p>
                          {preview && (
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                              {preview}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
                              {formatDate(sermon.date)}
                            </span>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                              {sermon.thoughts?.length || 0} {t('dashboard.thoughts')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-800">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('workspaces.series.actions.selectedCount', { count: selectedSermonIds.size })}
            </span>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                onClick={() => setShowCreateSermonModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700"
              >
                <PlusIcon className="h-4 w-4" />
                {t('addSermon.createNewSermon')}
              </button>
              <button
                onClick={handleAddSelected}
                disabled={selectedSermonIds.size === 0 || isAdding}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                {isAdding ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-white" />
                    {t('workspaces.series.actions.adding')}
                  </>
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4" />
                    {t('workspaces.series.actions.addSelected')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create New Sermon Modal */}
      <AddSermonModal
        showTriggerButton={false}
        isOpen={showCreateSermonModal}
        onClose={() => setShowCreateSermonModal(false)}
        preSelectedSeriesId={seriesId}
        onNewSermonCreated={(newSermon) => {
          // Add the new sermon to the series
          onAddSermons([newSermon.id]);
          setShowCreateSermonModal(false);
        }}
      />
    </div>
  );

  return createPortal(modalContent, document.body);
}
