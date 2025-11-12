"use client";

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Sermon } from '@/models/models';
import { XMarkIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { formatDate } from '@utils/dateFormatter';

interface AddSermonToSeriesModalProps {
  onClose: () => void;
  onAddSermons: (sermonIds: string[]) => void;
  currentSeriesSermonIds: string[];
}

export default function AddSermonToSeriesModal({
  onClose,
  onAddSermons,
  currentSeriesSermonIds
}: AddSermonToSeriesModalProps) {
  const { t } = useTranslation();
  const { sermons, loading: sermonsLoading } = useDashboardSermons();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSermonIds, setSelectedSermonIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  // Filter sermons that are not already in the series
  const availableSermons = useMemo(() => {
    return sermons.filter(sermon => !currentSeriesSermonIds.includes(sermon.id));
  }, [sermons, currentSeriesSermonIds]);

  // Filter by search query
  const filteredSermons = useMemo(() => {
    if (!searchQuery.trim()) {
      return availableSermons;
    }

    const query = searchQuery.toLowerCase();
    return availableSermons.filter(sermon =>
      sermon.title.toLowerCase().includes(query) ||
      sermon.verse.toLowerCase().includes(query)
    );
  }, [availableSermons, searchQuery]);

  const handleToggleSermon = (sermonId: string) => {
    const newSelected = new Set(selectedSermonIds);
    if (newSelected.has(sermonId)) {
      newSelected.delete(sermonId);
    } else {
      newSelected.add(sermonId);
    }
    setSelectedSermonIds(newSelected);
  };

  const handleAddSelected = async () => {
    if (selectedSermonIds.size === 0) return;

    setIsAdding(true);
    try {
      await onAddSermons(Array.from(selectedSermonIds));
      onClose();
    } catch (error) {
      console.error('Error adding sermons to series:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl mx-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t('workspaces.series.actions.addSermon')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('common.search') || 'Search sermons...'}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {sermonsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
              <span className="ml-2 text-gray-500 dark:text-gray-400">
                Loading sermons...
              </span>
            </div>
          ) : filteredSermons.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                {searchQuery.trim()
                  ? 'No sermons match your search'
                  : 'No sermons available to add'
                }
              </p>
              {searchQuery.trim() && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-blue-500 hover:text-blue-600"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSermons.map((sermon) => (
                <div
                  key={sermon.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedSermonIds.has(sermon.id)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => handleToggleSermon(sermon.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="flex-shrink-0 mt-0.5">
                      <input
                        type="checkbox"
                        checked={selectedSermonIds.has(sermon.id)}
                        onChange={() => handleToggleSermon(sermon.id)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {sermon.title}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {sermon.verse}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(sermon.date)}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          •
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {sermon.thoughts?.length || 0} thoughts
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {selectedSermonIds.size} sermon{selectedSermonIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            <button
              onClick={handleAddSelected}
              disabled={selectedSermonIds.size === 0 || isAdding}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isAdding ? (
                <>
                  <div className="w-4 h-4 border-t-2 border-b-2 border-white rounded-full animate-spin"></div>
                  Adding...
                </>
              ) : (
                <>
                  <PlusIcon className="h-4 w-4" />
                  Add Selected
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
