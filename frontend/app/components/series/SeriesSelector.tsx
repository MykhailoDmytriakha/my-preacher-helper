"use client";

import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useSeries } from '@/hooks/useSeries';
import { useAuth } from '@/providers/AuthProvider';

interface SeriesSelectorProps {
  onClose: () => void;
  onSelect: (seriesId: string) => void;
  currentSeriesId?: string | null;
  mode?: 'add' | 'change';
}

export default function SeriesSelector({ onClose, onSelect, currentSeriesId, mode }: SeriesSelectorProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { series, loading } = useSeries(user?.uid || null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSeries = useMemo(() => {
    if (!searchQuery.trim()) {
      return series.filter(s => s.id !== currentSeriesId);
    }

    const query = searchQuery.toLowerCase();
    return series.filter(s =>
      s.id !== currentSeriesId && (
        (s.title?.toLowerCase().includes(query) ?? false) ||
        s.theme.toLowerCase().includes(query) ||
        s.bookOrTopic.toLowerCase().includes(query)
      )
    );
  }, [series, searchQuery, currentSeriesId]);

  const handleSelect = (seriesId: string) => {
    onSelect(seriesId);
  };

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg mx-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {mode === 'add'
              ? t('workspaces.series.actions.selectSeriesForAdd')
              : mode === 'change'
                ? t('workspaces.series.actions.selectSeriesForChange')
                : t('workspaces.series.actions.selectSeries')
            }
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
            placeholder={t('common.search') || 'Search series...'}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
              <span className="ml-2 text-gray-500 dark:text-gray-400">
                {t('workspaces.series.loadingSeries')}
              </span>
            </div>
          ) : filteredSeries.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                {searchQuery.trim()
                  ? 'No series match your search'
                  : 'No series available'
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
              {filteredSeries.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSelect(s.id)}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Color indicator */}
                    {s.color && (
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: s.color }}
                      />
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {s.title}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {s.theme}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {s.bookOrTopic}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          •
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {s.sermonIds.length} sermons
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
