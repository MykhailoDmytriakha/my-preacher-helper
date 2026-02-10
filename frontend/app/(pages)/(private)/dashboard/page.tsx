"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import DashboardContent from "@/components/dashboard/DashboardContent";
import DashboardStats from "@/components/dashboard/DashboardStats";
import { DashboardStatsSkeleton } from "@/components/skeletons/DashboardStatsSkeleton";
import { useDashboardSermons, useSermonMutations } from "@/hooks/useDashboardSermons";
import { useFilteredSermons } from "@/hooks/useFilteredSermons";
import { useSeries } from "@/hooks/useSeries";
import { Sermon } from "@/models/models";
import { useAuth } from "@/providers/AuthProvider";
import { getEffectiveIsPreached } from "@/utils/preachDateStatus";
import AddSermonModal from "@components/AddSermonModal";
import { ChevronIcon } from "@components/Icons";

// Tab styling constants
const TAB_BASE_CLASSES =
  "whitespace-nowrap font-medium transition-colors text-sm px-3 py-2 rounded-md border";
const TAB_INACTIVE_CLASSES =
  "border-gray-200 text-gray-600 hover:text-gray-700 hover:border-gray-300 bg-white dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
const BADGE_INACTIVE_CLASSES = "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-300";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { sermons, loading } = useDashboardSermons();
  const { deleteSermonFromCache, updateSermonCache, addSermonToCache } = useSermonMutations();

  const { series: allSeries } = useSeries(user?.uid || null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as "active" | "preached" | "all") || "active";

  const handleTabChange = (tab: "active" | "preached" | "all") => {
    // Basic validation to keep URL clean, though logic handles fallback
    if (tab === "active") {
      router.push("/dashboard");
    } else {
      router.push(`/dashboard?tab=${tab}`);
    }
  };

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInThoughts, setSearchInThoughts] = useState(true);
  const [searchInTags, setSearchInTags] = useState(true);
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "alphabetical">("newest");
  const [seriesFilter, setSeriesFilter] = useState<"all" | "inSeries" | "standalone">("all");
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);

  const hasFilterChanges =
    sortOption !== "newest" ||
    seriesFilter !== "all" ||
    !searchInThoughts ||
    !searchInTags;

  const activeFilterCount =
    (searchQuery.trim().length > 0 ? 1 : 0) +
    (sortOption !== "newest" ? 1 : 0) +
    (seriesFilter !== "all" ? 1 : 0) +
    (!searchInThoughts || !searchInTags ? 1 : 0);

  const handleResetFilters = () => {
    setSortOption("newest");
    setSeriesFilter("all");
    setSearchInThoughts(true);
    setSearchInTags(true);
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

  // Filtering & Sorting
  const { processedSermons, searchSnippetsById } = useFilteredSermons(
    sermons,
    {
      searchQuery,
      searchInThoughts,
      searchInTags,
      sortOption,
      seriesFilter,
      activeTab,
    },
    t
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('dashboard.mySermons')}
          </h1>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <AddSermonModal onNewSermonCreated={handleNewSermon} allowPlannedDate />
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
      <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
        <nav className="flex flex-wrap gap-2" aria-label="Tabs">
          <button
            onClick={() => handleTabChange("active")}
            className={`
              ${TAB_BASE_CLASSES}
              ${activeTab === "active"
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-900/30 dark:text-blue-300"
                : TAB_INACTIVE_CLASSES
              }
            `}
          >
            {t('dashboard.activeSermons')}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs ${activeTab === "active"
              ? "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400"
              : BADGE_INACTIVE_CLASSES
              }`}>
              {loading ? "-" : sermons.filter((sermon) => !getEffectiveIsPreached(sermon)).length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange("preached")}
            className={`
              ${TAB_BASE_CLASSES}
              ${activeTab === "preached"
                ? "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-500/40 dark:bg-purple-900/30 dark:text-purple-300"
                : TAB_INACTIVE_CLASSES
              }
            `}
          >
            {t('dashboard.preached')}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs ${activeTab === "preached"
              ? "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400"
              : BADGE_INACTIVE_CLASSES
              }`}>
              {loading ? "-" : sermons.filter((sermon) => getEffectiveIsPreached(sermon)).length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange("all")}
            className={`
              ${TAB_BASE_CLASSES}
              ${activeTab === "all"
                ? "border-green-200 bg-green-50 text-green-700 dark:border-green-500/40 dark:bg-green-900/30 dark:text-green-300"
                : TAB_INACTIVE_CLASSES
              }
            `}
          >
            {t('dashboard.all')}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs ${activeTab === "all"
              ? "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400"
              : BADGE_INACTIVE_CLASSES
              }`}>
              {loading ? "-" : sermons.length}
            </span>
          </button>
        </nav>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-3 bg-white dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700/50 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t('dashboard.searchPanel.title')}
            </h2>
            {activeFilterCount > 0 && (
              <span
                className="inline-flex items-center justify-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                aria-label={`${t('filters.activeFilters')}: ${activeFilterCount}`}
              >
                {activeFilterCount}
              </span>
            )}
            {hasFilterChanges && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs font-semibold text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
              >
                {t('filters.resetFilters')}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsSearchPanelOpen((prev) => !prev)}
            aria-expanded={isSearchPanelOpen}
            aria-controls="dashboard-search-panel"
            aria-label={isSearchPanelOpen ? t('dashboard.searchPanel.hide') : t('dashboard.searchPanel.show')}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <ChevronIcon className={`h-5 w-5 transform ${isSearchPanelOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div
          id="dashboard-search-panel"
          className={isSearchPanelOpen ? "flex flex-col gap-3" : "hidden"}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
            <form
              role="search"
              aria-label={t('dashboard.searchPanel.title')}
              onSubmit={(event) => event.preventDefault()}
              className="relative w-full flex-1 min-w-[280px]"
            >
              <label htmlFor="dashboard-search-input" className="sr-only">
                {t('dashboard.searchSermons')}
              </label>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                id="dashboard-search-input"
                type="search"
                placeholder={t('dashboard.searchSermons')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border rounded-lg border-gray-200 dark:border-gray-700 
                          dark:bg-gray-800 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label={t('dashboard.clearSearch')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </form>
            <div className="flex gap-3 w-full sm:w-auto sm:items-center mt-3 sm:mt-0">
              <div className="relative flex-1 sm:flex-initial sm:min-w-[160px]">
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
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
                  onChange={(e) => setSeriesFilter(e.target.value as typeof seriesFilter)}
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
      </div>

      {/* Content Area */}
      <DashboardContent
        loading={loading}
        sermons={sermons}
        processedSermons={processedSermons}
        searchSnippetsById={searchSnippetsById}
        allSeries={allSeries}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onDeleteSermon={handleDeleteSermon}
        onUpdateSermon={handleUpdateSermon}
      />
    </div>
  );
}
