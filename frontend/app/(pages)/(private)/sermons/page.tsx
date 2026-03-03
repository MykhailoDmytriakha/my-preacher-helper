"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import DashboardContent from "@/components/dashboard/DashboardContent";
import DashboardStats from "@/components/dashboard/DashboardStats";
import { DashboardStatsSkeleton } from "@/components/skeletons/DashboardStatsSkeleton";
import { useDashboardOptimisticSermons } from "@/hooks/useDashboardOptimisticSermons";
import { useDashboardSermons, useSermonMutations } from "@/hooks/useDashboardSermons";
import { useFilteredSermons } from "@/hooks/useFilteredSermons";
import { useSeries } from "@/hooks/useSeries";
import { Sermon } from "@/models/models";
import { useAuth } from "@/providers/AuthProvider";
import { getEffectiveIsPreached } from "@/utils/preachDateStatus";
import AddSermonModal from "@components/AddSermonModal";
import { ChevronIcon } from "@components/Icons";

// localStorage keys for user preferences
const LS_SORT = "sermons:sort";
const LS_SERIES = "sermons:seriesFilter";
const LS_IN_THOUGHTS = "sermons:searchInThoughts";
const LS_IN_TAGS = "sermons:searchInTags";

// Tab styling constants
const TAB_BASE_CLASSES =
  "whitespace-nowrap font-medium transition-colors text-sm px-3 py-2 rounded-md border";
const TAB_INACTIVE_CLASSES =
  "border-gray-200 text-gray-600 hover:text-gray-700 hover:border-gray-300 bg-white dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
const BADGE_INACTIVE_CLASSES = "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-300";

export default function SermonsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { sermons, loading } = useDashboardSermons();
  const { deleteSermonFromCache, updateSermonCache } = useSermonMutations();
  const { syncStatesById, actions: optimisticActions } = useDashboardOptimisticSermons();

  const { series: allSeries } = useSeries(user?.uid || null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as "active" | "preached" | "all") || "active";

  const handleTabChange = (tab: "active" | "preached" | "all") => {
    // Basic validation to keep URL clean, though logic handles fallback
    if (tab === "active") {
      router.push("/sermons");
    } else {
      router.push(`/sermons?tab=${tab}`);
    }
  };

  // State — search in URL, preferences in localStorage
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");

  type SortOption = "newest" | "oldest" | "alphabetical" | "recentlyUpdated";
  type SeriesFilter = "all" | "inSeries" | "standalone";

  const [sortOption, setSortOption] = useState<SortOption>(() => {
    try { return (localStorage.getItem(LS_SORT) as SortOption) || "newest"; } catch { return "newest"; }
  });
  const [seriesFilter, setSeriesFilter] = useState<SeriesFilter>(() => {
    try { return (localStorage.getItem(LS_SERIES) as SeriesFilter) || "all"; } catch { return "all"; }
  });
  const [searchInThoughts, setSearchInThoughts] = useState(() => {
    try { return localStorage.getItem(LS_IN_THOUGHTS) !== "false"; } catch { return true; }
  });
  const [searchInTags, setSearchInTags] = useState(() => {
    try { return localStorage.getItem(LS_IN_TAGS) !== "false"; } catch { return true; }
  });

  // Persist preferences to localStorage
  useEffect(() => { try { localStorage.setItem(LS_SORT, sortOption); } catch { } }, [sortOption]);
  useEffect(() => { try { localStorage.setItem(LS_SERIES, seriesFilter); } catch { } }, [seriesFilter]);
  useEffect(() => { try { localStorage.setItem(LS_IN_THOUGHTS, String(searchInThoughts)); } catch { } }, [searchInThoughts]);
  useEffect(() => { try { localStorage.setItem(LS_IN_TAGS, String(searchInTags)); } catch { } }, [searchInTags]);

  // Sync search query to URL (debounced, replace to not pollute history)
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchQuery.trim()) {
        params.set("q", searchQuery);
      } else {
        params.delete("q");
      }
      router.replace(`/sermons?${params.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);
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
    try {
      localStorage.removeItem(LS_SORT);
      localStorage.removeItem(LS_SERIES);
      localStorage.removeItem(LS_IN_THOUGHTS);
      localStorage.removeItem(LS_IN_TAGS);
    } catch { }
  };

  const handleDeleteSermon = (id: string) => {
    deleteSermonFromCache(id);
  };

  const handleUpdateSermon = (updatedSermon: Sermon) => {
    updateSermonCache(updatedSermon);
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
          <AddSermonModal
            onCreateRequest={optimisticActions.createSermon}
            allowPlannedDate
          />
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
      <div className="flex flex-col gap-5 mb-2">
        {/* Row 1: Search input */}
        <form
          role="search"
          aria-label={t('dashboard.searchPanel.title')}
          onSubmit={(event) => event.preventDefault()}
          className="relative w-full group"
        >
          <label htmlFor="dashboard-search-input" className="sr-only">
            {t('dashboard.searchSermons')}
          </label>
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-blue-500 text-gray-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            id="dashboard-search-input"
            type="search"
            placeholder={t('dashboard.searchSermons')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-12 py-3.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/80 rounded-2xl
                      text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500
                      shadow-sm hover:shadow-md focus:shadow-md focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all duration-200"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={t('dashboard.clearSearch')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </form>

        {/* Row 2: Sort + Series + contextual search modifiers + reset */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-1">
          <div className="flex flex-wrap items-center gap-3">
            {/* Sort dropdown */}
            <div className="relative group/sort">
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
                className={`appearance-none pl-4 pr-9 py-2 border rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer shadow-sm hover:shadow
                  focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                  ${sortOption !== "newest"
                    ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                    : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
              >
                <option value="newest">{t('dashboard.newest')}</option>
                <option value="oldest">{t('dashboard.oldest')}</option>
                <option value="alphabetical">{t('dashboard.alphabetical')}</option>
                <option value="recentlyUpdated">{t('dashboard.recentlyUpdated')}</option>
              </select>
              <div className={`absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none transition-colors
                ${sortOption !== "newest" ? "text-blue-500 dark:text-blue-400" : "text-gray-400 group-hover/sort:text-gray-600 dark:text-gray-500 dark:group-hover/sort:text-gray-300"}`}>
                <ChevronIcon direction="down" className="w-4 h-4" />
              </div>
            </div>

            {/* Series filter dropdown */}
            <div className="relative group/series">
              <select
                value={seriesFilter}
                onChange={(e) => setSeriesFilter(e.target.value as typeof seriesFilter)}
                className={`appearance-none pl-4 pr-9 py-2 border rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer shadow-sm hover:shadow
                  focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                  ${seriesFilter !== "all"
                    ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                    : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
              >
                <option value="all">{t('workspaces.series.filters.allSermons')}</option>
                <option value="inSeries">{t('workspaces.series.filters.inSeries')}</option>
                <option value="standalone">{t('workspaces.series.filters.standalone')}</option>
              </select>
              <div className={`absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none transition-colors
                ${seriesFilter !== "all" ? "text-blue-500 dark:text-blue-400" : "text-gray-400 group-hover/series:text-gray-600 dark:text-gray-500 dark:group-hover/series:text-gray-300"}`}>
                <ChevronIcon direction="down" className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search modifiers — visible only when search query is active */}
            {searchQuery.trim().length > 0 && (
              <div className="flex items-center gap-4 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50 shadow-sm">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 cursor-pointer select-none hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={searchInThoughts}
                    onChange={(e) => setSearchInThoughts(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 transition-all cursor-pointer"
                  />
                  {t('dashboard.searchInThoughts')}
                </label>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 cursor-pointer select-none hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={searchInTags}
                    onChange={(e) => setSearchInTags(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 transition-all cursor-pointer"
                  />
                  {t('dashboard.searchInTags')}
                </label>
              </div>
            )}

            {/* Reset — visible only when filters differ from defaults */}
            {hasFilterChanges && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200
                         bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-200 dark:border-gray-700 shadow-sm"
              >
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 w-4 h-4 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                    {activeFilterCount}
                  </span>
                )}
                {t('filters.resetFilters')}
              </button>
            )}
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
        syncStatesById={syncStatesById}
        optimisticActions={optimisticActions}
      />
    </div>
  );
}
