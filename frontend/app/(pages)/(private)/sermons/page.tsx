"use client";

import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react';
import { AdjustmentsHorizontalIcon, MagnifyingGlassIcon, XMarkIcon, ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
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
const SELECT_CLASSES = "w-full appearance-none px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors";
const CHECKBOX_CLASSES = "w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:bg-gray-900 dark:border-gray-600 transition-colors cursor-pointer";

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
    try { return (localStorage.getItem(LS_SORT) as SortOption) || "recentlyUpdated"; } catch { return "recentlyUpdated"; }
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

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  // Auto-expand search if there's a pre-filled query on load
  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      setIsSearchExpanded(true);
    }
    // Only run on init to handle search queries coming from URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    sortOption !== "recentlyUpdated" ||
    seriesFilter !== "all" ||
    !searchInThoughts ||
    !searchInTags;

  const activeFilterCount =
    (sortOption !== "recentlyUpdated" ? 1 : 0) +
    (seriesFilter !== "all" ? 1 : 0) +
    (!searchInThoughts ? 1 : 0) +
    (!searchInTags ? 1 : 0);

  const handleResetFilters = () => {
    setSortOption("recentlyUpdated");
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
  const searchSermonsLabel = t('dashboard.searchSermons');

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

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-4 mb-3 relative z-40">
        {/* Row 1: Tabs + Interactive Icons/Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 pb-2">
          {/* Left Side: Tabs */}
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

          {/* Right Side: Search and Filters Container */}
          <div className="flex items-center gap-2">
            {/* Collapsible Search */}
            <div className="relative group/search"
              onFocus={() => setIsSearchExpanded(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node) && !searchQuery.trim()) {
                  setIsSearchExpanded(false);
                }
              }}
            >
              <form
                role="search"
                aria-label={t('dashboard.searchPanel.title')}
                onSubmit={(event) => event.preventDefault()}
                className={`flex items-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                ${isSearchExpanded
                    ? 'w-[280px] sm:w-[320px] bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/80 rounded-xl shadow-sm'
                    : 'w-10 bg-transparent border border-transparent rounded-xl'}`}
              >
                <label htmlFor="dashboard-search-input" className="sr-only">
                  {searchSermonsLabel}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchExpanded(true);
                    document.getElementById('dashboard-search-input')?.focus();
                  }}
                  className={`flex-shrink-0 w-10 h-10 flex items-center justify-center transition-colors 
                    ${isSearchExpanded ? 'text-blue-500' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl'}`}
                  aria-label={searchSermonsLabel}
                >
                  <MagnifyingGlassIcon className="w-5 h-5" />
                </button>
                <input
                  id="dashboard-search-input"
                  type="search"
                  placeholder={searchSermonsLabel}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full py-2 bg-transparent text-sm sm:text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none
                    transition-opacity duration-300 ${isSearchExpanded ? 'opacity-100 pr-16' : 'opacity-0'}`}
                  tabIndex={isSearchExpanded ? 0 : -1}
                />

                <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-opacity duration-300 ${isSearchExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label={t('dashboard.clearSearch')}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  )}

                  {/* Search Modifiers Dropdown */}
                  <Popover className="relative z-30 flex">
                    {({ open }) => (
                      <>
                        <PopoverButton
                          aria-label={t('dashboard.searchSettings', 'Настройки поиска')}
                          className={`p-1.5 flex items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${open || !searchInThoughts || !searchInTags
                            ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/40'
                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-700'
                            }`}
                        >
                          <AdjustmentsHorizontalIcon className="w-4 h-4" />
                        </PopoverButton>
                        <Transition
                          as={Fragment}
                          enter="transition ease-out duration-200"
                          enterFrom="opacity-0 translate-y-1"
                          enterTo="opacity-100 translate-y-0"
                          leave="transition ease-in duration-150"
                          leaveFrom="opacity-100 translate-y-0"
                          leaveTo="opacity-0 translate-y-1"
                        >
                          <PopoverPanel className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg p-3 z-40 focus:outline-none">
                            <div className="space-y-3">
                              <label className="flex items-center gap-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={searchInThoughts}
                                  onChange={(e) => setSearchInThoughts(e.target.checked)}
                                  className={CHECKBOX_CLASSES}
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
                                  {t('dashboard.searchInThoughts')}
                                </span>
                              </label>
                              <label className="flex items-center gap-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={searchInTags}
                                  onChange={(e) => setSearchInTags(e.target.checked)}
                                  className={CHECKBOX_CLASSES}
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
                                  {t('dashboard.searchInTags')}
                                </span>
                              </label>
                            </div>
                          </PopoverPanel>
                        </Transition>
                      </>
                    )}
                  </Popover>
                </div>
              </form>
            </div>

            {/* Compact Popover for Filters */}
            <Popover className="relative z-30">
              {({ open }) => (
                <>
                  <PopoverButton
                    className={`flex items-center justify-center w-10 h-10 border rounded-xl shadow-sm text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                    ${open || hasFilterChanges
                        ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/40 dark:border-blue-500/30 dark:text-blue-300"
                        : "bg-white border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:bg-gray-800/80 dark:border-gray-700/80 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800"
                      }
                  `}
                    aria-label={t('common.filters')}
                  >
                    <ArrowsUpDownIcon className="w-5 h-5" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold shadow-sm ring-2 ring-white dark:ring-gray-900">
                        {activeFilterCount}
                      </span>
                    )}
                  </PopoverButton>

                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-200"
                    enterFrom="opacity-0 translate-y-1"
                    enterTo="opacity-100 translate-y-0"
                    leave="transition ease-in duration-150"
                    leaveFrom="opacity-100 translate-y-0"
                    leaveTo="opacity-0 translate-y-1"
                  >
                    <PopoverPanel className="absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-100 dark:border-gray-700 focus:outline-none overflow-hidden">
                      <div className="p-4 space-y-5">
                        {/* Sort Options */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('filters.sortOrder')}
                          </label>
                          <select
                            value={sortOption}
                            onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
                            className={SELECT_CLASSES}
                          >
                            <option value="newest">{t('dashboard.newest')}</option>
                            <option value="oldest">{t('dashboard.oldest')}</option>
                            <option value="alphabetical">{t('dashboard.alphabetical')}</option>
                            <option value="recentlyUpdated">{t('dashboard.recentlyUpdated')}</option>
                          </select>
                        </div>

                        {/* Series Filter */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Серии
                          </label>
                          <select
                            value={seriesFilter}
                            onChange={(e) => setSeriesFilter(e.target.value as typeof seriesFilter)}
                            className={SELECT_CLASSES}
                          >
                            <option value="all">{t('workspaces.series.filters.allSermons')}</option>
                            <option value="inSeries">{t('workspaces.series.filters.inSeries')}</option>
                            <option value="standalone">{t('workspaces.series.filters.standalone')}</option>
                          </select>
                        </div>

                        {/* Modifiers (Moved to Search Settings inside the Search Input) */}

                        {/* Reset Button */}
                        {hasFilterChanges && (
                          <div className="pt-3 border-t border-gray-100 dark:border-gray-700/50">
                            <button
                              type="button"
                              onClick={handleResetFilters}
                              className="w-full py-2.5 text-sm font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/50 dark:hover:bg-gray-800 rounded-lg transition-colors border border-gray-200 dark:border-gray-700 shadow-sm"
                            >
                              {t('filters.resetFilters')}
                            </button>
                          </div>
                        )}
                      </div>
                    </PopoverPanel>
                  </Transition>
                </>
              )}
            </Popover>
          </div>
        </div>

        {/* Active Filter Pills (Chips) */}
        {hasFilterChanges && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            {sortOption !== "newest" && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-500/30 shadow-sm">
                <span>{t('filters.sortOrder')}: {t(`dashboard.${sortOption}`)}</span>
                <button
                  type="button"
                  onClick={() => setSortOption("newest")}
                  className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            )}

            {seriesFilter !== "all" && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-500/30 shadow-sm">
                <span>Серии: {t(`workspaces.series.filters.${seriesFilter}`)}</span>
                <button
                  type="button"
                  onClick={() => setSeriesFilter("all")}
                  className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            )}

            {!searchInThoughts && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 shadow-sm">
                <span className="line-through opacity-70">{t('dashboard.searchInThoughts')}</span>
                <button
                  type="button"
                  onClick={() => setSearchInThoughts(true)}
                  className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            )}

            {!searchInTags && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 shadow-sm">
                <span className="line-through opacity-70">{t('dashboard.searchInTags')}</span>
                <button
                  type="button"
                  onClick={() => setSearchInTags(true)}
                  className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            )}

            {activeFilterCount > 1 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center px-2 py-1 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 underline decoration-gray-300 underline-offset-2 transition-colors ml-1"
              >
                {t('filters.clear', 'Очистить все')}
              </button>
            )}
          </div>
        )}
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
