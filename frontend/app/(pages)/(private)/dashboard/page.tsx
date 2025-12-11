"use client";

import { useMemo, useState } from "react";
import AddSermonModal from "@components/AddSermonModal";
import { Sermon } from "@/models/models";
import DashboardStats from "@components/dashboard/DashboardStats";
import CreateSeriesModal from "@/components/series/CreateSeriesModal";
import { useTranslation } from "react-i18next";
import { ChevronIcon } from "@components/Icons";
import { useDashboardSermons, useSermonMutations } from "@/hooks/useDashboardSermons";
import { useSeries } from "@/hooks/useSeries";
import { useAuth } from "@/providers/AuthProvider";
import SermonCard from "@/components/dashboard/SermonCard";
import { SermonCardSkeleton } from "@/components/skeletons/SermonCardSkeleton";
import { DashboardStatsSkeleton } from "@/components/skeletons/DashboardStatsSkeleton";
import { getThoughtSnippets, matchesSermonQuery, tokenizeQuery, ThoughtSnippet } from "@/utils/sermonSearch";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { sermons, loading } = useDashboardSermons();
  const { deleteSermonFromCache, updateSermonCache, addSermonToCache } = useSermonMutations();
  
  const { series: allSeries, createNewSeries } = useSeries(user?.uid || null);
  
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInThoughts, setSearchInThoughts] = useState(true);
  const [searchInTags, setSearchInTags] = useState(true);
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "alphabetical">("newest");
  const [seriesFilter, setSeriesFilter] = useState<"all" | "inSeries" | "standalone">("all");
  const [activeTab, setActiveTab] = useState<"active" | "preached" | "all">("active");
  const [isMobileSearchVisible, setIsMobileSearchVisible] = useState(false);

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSermonIds, setSelectedSermonIds] = useState<Set<string>>(new Set());
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);

  // Handlers
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

  const handleDeleteSermon = (id: string) => {
    deleteSermonFromCache(id);
  };

  const handleUpdateSermon = (updatedSermon: Sermon) => {
    updateSermonCache(updatedSermon);
  };

  const handleNewSermon = (newSermon: Sermon) => {
    addSermonToCache(newSermon);
  };

  const searchTokens = useMemo(() => tokenizeQuery(searchQuery), [searchQuery]);

  const searchOptions = useMemo(
    () => ({
      searchInTitleVerse: true,
      searchInThoughts,
      searchInTags,
    }),
    [searchInThoughts, searchInTags]
  );

  // Filtering & Sorting
  const { processedSermons, searchSnippetsById } = useMemo(() => {
    let filtered = [...sermons];

    // Series filter
    if (seriesFilter === "inSeries") {
      filtered = filtered.filter((sermon) => sermon.seriesId);
    } else if (seriesFilter === "standalone") {
      filtered = filtered.filter((sermon) => !sermon.seriesId);
    }

    // Tab filter (Active vs Preached vs All)
    if (activeTab === "active") {
      filtered = filtered.filter((s) => !s.isPreached);
    } else if (activeTab === "preached") {
      filtered = filtered.filter((s) => s.isPreached);
    }

    // Search filter
    if (searchTokens.length) {
      filtered = filtered.filter((sermon) =>
        matchesSermonQuery(sermon, searchTokens, searchOptions)
      );
    }

    const sorted = filtered.sort((a, b) => {
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

    const snippets: Record<string, ThoughtSnippet[] | undefined> = {};
    if (searchTokens.length) {
      sorted.forEach((sermon) => {
        const thoughtSnippets = getThoughtSnippets(sermon, searchQuery);
        if (thoughtSnippets.length > 0) {
          snippets[sermon.id] = thoughtSnippets;
        }
      });
    }

    return { processedSermons: sorted, searchSnippetsById: snippets };
  }, [sermons, searchTokens, searchOptions, sortOption, seriesFilter, activeTab, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('dashboard.mySermons')}
          </h1>
          {isMultiSelectMode && (
            <span className="text-sm text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md border border-blue-100 dark:border-blue-800">
              {selectedSermonIds.size} selected
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {!isMultiSelectMode ? (
            <>
              <button
                onClick={toggleMultiSelectMode}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
              >
                {t('workspaces.series.actions.selectSermons')}
              </button>
              <AddSermonModal onNewSermonCreated={handleNewSermon} />
            </>
          ) : (
            <>
              <button
                onClick={() => setShowCreateSeriesModal(true)}
                disabled={selectedSermonIds.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Create Series ({selectedSermonIds.size})
              </button>
              <button
                onClick={toggleMultiSelectMode}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Stats Section */}
      <div className="overflow-x-auto sm:overflow-visible -mx-4 sm:mx-0">
        <div className="px-4 sm:px-0">
          {loading ? (
            <DashboardStatsSkeleton />
          ) : (
            <DashboardStats sermons={sermons} />
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("active")}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === "active"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }
            `}
          >
            {t('dashboard.activeSermons')}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs ${
              activeTab === "active"
                ? "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400"
                : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-300"
            }`}>
              {loading ? "-" : sermons.filter(s => !s.isPreached).length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("preached")}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === "preached"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }
            `}
          >
            {t('dashboard.preached')}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs ${
              activeTab === "preached"
                ? "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400"
                : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-300"
            }`}>
              {loading ? "-" : sermons.filter(s => s.isPreached).length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("all")}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === "all"
                ? "border-green-500 text-green-600 dark:text-green-400"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }
            `}
          >
            {t('dashboard.all')}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs ${
              activeTab === "all"
                ? "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400"
                : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-300"
            }`}>
              {loading ? "-" : sermons.length}
            </span>
          </button>
        </nav>
      </div>
      
      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-3 bg-white dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700/50 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
          <div className="relative w-full flex-1 min-w-[280px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder={t('dashboard.searchSermons')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 border rounded-lg border-gray-200 dark:border-gray-700 
                        dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex gap-3 w-full sm:w-auto sm:items-center mt-3 sm:mt-0">
            <div className="relative flex-1 sm:flex-initial sm:min-w-[160px]">
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as any)}
                className="appearance-none w-full pl-3 pr-10 py-2.5 border rounded-lg border-gray-200 
                          dark:border-gray-700 dark:bg-gray-800 bg-white
                          focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="newest">{t('dashboard.newest')}</option>
                <option value="oldest">{t('dashboard.oldest')}</option>
                <option value="alphabetical">{t('dashboard.alphabetical')}</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
                <ChevronIcon direction="down" className="w-4 h-4" />
              </div>
            </div>

            <div className="relative flex-1 sm:flex-initial sm:min-w-[160px]">
              <select
                value={seriesFilter}
                onChange={(e) => setSeriesFilter(e.target.value as any)}
                className="appearance-none w-full pl-3 pr-10 py-2.5 border rounded-lg border-gray-200
                          dark:border-gray-700 dark:bg-gray-800 bg-white
                          focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">{t('workspaces.series.filters.allSermons')}</option>
                <option value="inSeries">{t('workspaces.series.filters.inSeries')}</option>
                <option value="standalone">{t('workspaces.series.filters.standalone')}</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
                <ChevronIcon direction="down" className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={searchInThoughts}
              onChange={(e) => setSearchInThoughts(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600"
            />
            <span>{t('dashboard.searchInThoughts') ?? 'Search in thoughts'}</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={searchInTags}
              onChange={(e) => setSearchInTags(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600"
            />
            <span>{t('dashboard.searchInTags') ?? 'Search in tags'}</span>
          </label>
        </div>
      </div>
      
      {/* Content Area */}
      {loading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SermonCardSkeleton key={i} />
          ))}
        </div>
      ) : sermons.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
          <div className="mx-auto h-12 w-12 text-gray-400">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">
            {t('dashboard.noSermons')}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {t('dashboard.createFirstSermon')}
          </p>
        </div>
      ) : processedSermons.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto h-12 w-12 text-gray-400">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">
            {t('dashboard.noSearchResults')}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dashboard.tryDifferentSearch')}
          </p>
          <button 
            onClick={() => setSearchQuery("")}
            className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3" data-testid="sermon-grid">
          {processedSermons.map((sermon) => (
            <SermonCard
              key={sermon.id}
              sermon={sermon}
              series={allSeries}
              onDelete={handleDeleteSermon}
              onUpdate={handleUpdateSermon}
              isMultiSelectMode={isMultiSelectMode}
              selectedSermonIds={selectedSermonIds}
              onToggleSermonSelection={toggleSermonSelection}
              searchQuery={searchQuery}
              searchSnippets={searchSnippetsById[sermon.id]}
            />
          ))}
        </div>
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
