"use client";

import { useMemo, useState } from "react";
import AddSermonModal from "@components/AddSermonModal";
import { Sermon } from "@/models/models";
import SermonList from "@components/dashboard/SermonList";
import DashboardStats from "@components/dashboard/DashboardStats";
import CreateSeriesModal from "@/components/series/CreateSeriesModal";
import { useTranslation } from "react-i18next";
import { ChevronIcon } from "@components/Icons";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useDashboardSermons } from "@/hooks/useDashboardSermons";
import { useSeries } from "@/hooks/useSeries";
import { useAuth } from "@/providers/AuthProvider";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { sermons, setSermons, loading } = useDashboardSermons();
  const { series: allSeries, createNewSeries } = useSeries(user?.uid || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "alphabetical">("newest");
  const [seriesFilter, setSeriesFilter] = useState<"all" | "inSeries" | "standalone">("all");
  const [isMobileSearchVisible, setIsMobileSearchVisible] = useState(false);

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSermonIds, setSelectedSermonIds] = useState<Set<string>>(new Set());
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);

  // Multi-select functions
  const toggleMultiSelectMode = () => {
    setIsMultiSelectMode(!isMultiSelectMode);
    setSelectedSermonIds(new Set());
  };

  const toggleSermonSelection = (sermonId: string) => {
    const newSelected = new Set(selectedSermonIds);
    if (newSelected.has(sermonId)) {
      newSelected.delete(sermonId);
    } else {
      newSelected.add(sermonId);
    }
    setSelectedSermonIds(newSelected);
  };

  const handleCreateSeries = async (seriesData: Parameters<typeof createNewSeries>[0]) => {
    await createNewSeries(seriesData);
    setShowCreateSeriesModal(false);
    setIsMultiSelectMode(false);
    setSelectedSermonIds(new Set());
  };

  const selectedSermons = sermons.filter(s => selectedSermonIds.has(s.id));
  
  const sortedAndFilteredSermons = useMemo(() => {
    let filtered = searchQuery
      ? sermons.filter((sermon) =>
          sermon.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          sermon.verse.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : sermons;

    // Apply series filter
    if (seriesFilter === "inSeries") {
      filtered = filtered.filter(sermon => sermon.seriesId);
    } else if (seriesFilter === "standalone") {
      filtered = filtered.filter(sermon => !sermon.seriesId);
    }

    return [...filtered].sort((a, b) => {
      if (a.isPreached && !b.isPreached) return 1;
      if (!a.isPreached && b.isPreached) return -1;

      switch (sortOption) {
        case "newest":
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        case "oldest":
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        case "alphabetical":
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }, [sermons, searchQuery, sortOption]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header with responsive styling */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          {t('dashboard.mySermons')}
        </h1>
          {isMultiSelectMode && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {selectedSermonIds.size} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {!isMultiSelectMode ? (
            <>
              <button
                onClick={toggleMultiSelectMode}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {t('workspaces.series.actions.selectSermons')}
              </button>
          <AddSermonModal
            onNewSermonCreated={(newSermon: Sermon) =>
              setSermons((prevSermons) => [newSermon, ...prevSermons])
            }
          />
            </>
          ) : (
            <>
              <button
                onClick={() => setShowCreateSeriesModal(true)}
                disabled={selectedSermonIds.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create Series ({selectedSermonIds.size})
              </button>
              <button
                onClick={toggleMultiSelectMode}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Dashboard Stats with responsive grid */}
      {sermons.length > 0 && (
        <div className="overflow-x-auto sm:overflow-visible -mx-4 sm:mx-0">
          <div className="px-4 sm:px-0">
            <DashboardStats sermons={sermons} />
          </div>
        </div>
      )}
      
      {/* Mobile search toggle */}
      <div className="block sm:hidden">
        <button 
          onClick={() => setIsMobileSearchVisible(!isMobileSearchVisible)}
          className="w-full py-2 px-4 bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-between"
        >
          <span className="text-gray-700 dark:text-gray-300">
            {isMobileSearchVisible ? t('common.hideSearch') : t('common.showSearch')}
          </span>
          <ChevronIcon 
            direction={isMobileSearchVisible ? "up" : "down"} 
            className="w-5 h-5 text-gray-500" 
          />
        </button>
      </div>

      {/* Search and Sort Options with responsive layout */}
      <div className={`${isMobileSearchVisible || 'hidden sm:flex'} flex-col sm:flex-row gap-4 sm:items-center`}>
        <div className="relative flex-grow">
          <input
            type="text"
            placeholder={t('dashboard.searchSermons')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full p-3 pr-10 border rounded-md border-gray-300 dark:border-gray-700 
                      dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          )}
        </div>
        
        <div className="relative min-w-[180px]">
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as "newest" | "oldest" | "alphabetical")}
            className="appearance-none w-full p-3 pr-10 border rounded-md border-gray-300 
                      dark:border-gray-700 dark:bg-gray-800 bg-white dark:bg-gray-800
                      focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="newest">{t('dashboard.newest')}</option>
            <option value="oldest">{t('dashboard.oldest')}</option>
            <option value="alphabetical">{t('dashboard.alphabetical')}</option>
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
            <ChevronIcon direction="down" className="w-5 h-5 text-gray-500" />
          </div>
        </div>

        {/* Series Filter */}
        <div className="relative w-full sm:w-48">
          <select
            value={seriesFilter}
            onChange={(e) => setSeriesFilter(e.target.value as "all" | "inSeries" | "standalone")}
            className="appearance-none w-full p-3 pr-10 border rounded-md border-gray-300
                      dark:border-gray-700 dark:bg-gray-800 bg-white dark:bg-gray-800
                      focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">{t('workspaces.series.filters.allSermons')}</option>
            <option value="inSeries">{t('workspaces.series.filters.inSeries')}</option>
            <option value="standalone">{t('workspaces.series.filters.standalone')}</option>
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
            <ChevronIcon direction="down" className="w-5 h-5 text-gray-500" />
          </div>
        </div>
      </div>
      
      {/* Empty State */}
      {sermons.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('dashboard.noSermons')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('dashboard.createFirstSermon')}
          </p>
        </div>
      ) : sortedAndFilteredSermons.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('dashboard.noSearchResults')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('dashboard.tryDifferentSearch')}
          </p>
        </div>
      ) : (
        <SermonList 
          sermons={sortedAndFilteredSermons} 
          onDelete={(id: string) => setSermons((prev) => prev.filter((s) => s.id !== id))}
          onUpdate={(updatedSermon: Sermon) => setSermons(prev => 
            prev.map(s => s.id === updatedSermon.id ? updatedSermon : s)
          )} 
          series={allSeries}
          isMultiSelectMode={isMultiSelectMode}
          selectedSermonIds={selectedSermonIds}
          onToggleSermonSelection={toggleSermonSelection}
        />
      )}

      {/* Create Series Modal */}
      {showCreateSeriesModal && (
        <CreateSeriesModal
          onClose={() => setShowCreateSeriesModal(false)}
          onCreate={handleCreateSeries}
          initialSermonIds={Array.from(selectedSermonIds)}
        />
      )}
    </div>
  );
}
