'use client';

import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react';
import {
  AdjustmentsHorizontalIcon,
  ArrowsUpDownIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useQueryState } from 'nuqs';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import MarkAnsweredModal from '@/components/prayer/MarkAnsweredModal';
import PrayerRequestCard from '@/components/prayer/PrayerRequestCard';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import {
  filterPrayerRequests,
  getDefaultPrayerSortKey,
  getPrayerSortOptions,
  normalizePrayerFilterStatus,
  normalizePrayerSortKey,
  PrayerFilterStatus,
  PrayerSortKey,
  resolvePrayerSortKey,
} from '@/utils/prayerFilters';
import '@locales/i18n';

const LS_SEARCH_UPDATES = 'prayers:searchInUpdates';
const LS_SEARCH_TAGS = 'prayers:searchInTags';
const LS_SEARCH_ANSWERS = 'prayers:searchInAnswers';

const TAB_BASE_CLASSES =
  'whitespace-nowrap font-medium transition-colors text-sm px-3 py-2 rounded-md border';
const TAB_INACTIVE_CLASSES =
  'border-gray-200 text-gray-600 hover:text-gray-700 hover:border-gray-300 bg-white dark:bg-gray-900/40 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200';
const BADGE_INACTIVE_CLASSES = 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-300';
const SELECT_CLASSES =
  'w-full appearance-none px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors';
const CHECKBOX_CLASSES =
  'w-4 h-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500 dark:bg-gray-900 dark:border-gray-600 transition-colors cursor-pointer';

export default function PrayerPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { prayerRequests, loading, createPrayer, updatePrayer, deletePrayer, addUpdate, setStatus } =
    usePrayerRequests(user?.uid ?? null);

  const [showCreate, setShowCreate] = useState(false);
  const [editingPrayer, setEditingPrayer] = useState<PrayerRequest | null>(null);
  const [addingUpdateForId, setAddingUpdateForId] = useState<string | null>(null);
  const [markingAnsweredId, setMarkingAnsweredId] = useState<string | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const [filterStatus, setFilterStatus] = useQueryState<PrayerFilterStatus>('filter', {
    defaultValue: 'active',
    parse: (value) => normalizePrayerFilterStatus(value),
  });
  const [sortKey, setSortKey] = useQueryState<PrayerSortKey>('sort', {
    defaultValue: 'updatedAt',
    parse: (value) => normalizePrayerSortKey(value),
  });
  const [searchQuery, setSearchQuery] = useQueryState('q', { defaultValue: '' });

  const [searchInUpdates, setSearchInUpdates] = useState(() => {
    try {
      return localStorage.getItem(LS_SEARCH_UPDATES) !== 'false';
    } catch {
      return true;
    }
  });
  const [searchInTags, setSearchInTags] = useState(() => {
    try {
      return localStorage.getItem(LS_SEARCH_TAGS) !== 'false';
    } catch {
      return true;
    }
  });
  const [searchInAnswerText, setSearchInAnswerText] = useState(() => {
    try {
      return localStorage.getItem(LS_SEARCH_ANSWERS) !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (searchQuery.trim()) {
      setIsSearchExpanded(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SEARCH_UPDATES, String(searchInUpdates));
    } catch {}
  }, [searchInUpdates]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_SEARCH_TAGS, String(searchInTags));
    } catch {}
  }, [searchInTags]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_SEARCH_ANSWERS, String(searchInAnswerText));
    } catch {}
  }, [searchInAnswerText]);

  const previousFilterStatusRef = useRef<PrayerFilterStatus>(normalizePrayerFilterStatus(filterStatus));
  const effectiveFilterStatus = normalizePrayerFilterStatus(filterStatus);
  const previousFilterStatus = previousFilterStatusRef.current;
  const effectiveSortKey = resolvePrayerSortKey(
    effectiveFilterStatus,
    sortKey,
    previousFilterStatus
  );
  const defaultSortKey = getDefaultPrayerSortKey(effectiveFilterStatus);

  useEffect(() => {
    if (sortKey !== effectiveSortKey) {
      void setSortKey(effectiveSortKey);
    }
    previousFilterStatusRef.current = effectiveFilterStatus;
  }, [effectiveFilterStatus, effectiveSortKey, setSortKey, sortKey]);

  const handleFilterStatusChange = (nextFilterStatus: PrayerFilterStatus) => {
    void setFilterStatus(nextFilterStatus);
  };

  const counts = useMemo(
    () => ({
      all: prayerRequests.length,
      active: prayerRequests.filter((prayer) => prayer.status === 'active').length,
      answered: prayerRequests.filter((prayer) => prayer.status === 'answered').length,
      not_answered: prayerRequests.filter((prayer) => prayer.status === 'not_answered').length,
    }),
    [prayerRequests]
  );

  const sortLabels: Record<PrayerSortKey, string> = {
    updatedAt: t('prayer.sort.updatedAt'),
    createdAt: t('prayer.sort.createdAt'),
    answeredAt: t('prayer.sort.answeredAt'),
  };

  const sortOptions = getPrayerSortOptions(effectiveFilterStatus).map((key) => ({
    key,
    label: sortLabels[key],
  }));

  const filtered = useMemo(
    () =>
      filterPrayerRequests(prayerRequests, {
        filterStatus: effectiveFilterStatus,
        searchQuery,
        sortKey: effectiveSortKey,
        searchInUpdates,
        searchInTags,
        searchInAnswerText,
      }),
    [
      effectiveFilterStatus,
      effectiveSortKey,
      prayerRequests,
      searchInAnswerText,
      searchInTags,
      searchInUpdates,
      searchQuery,
    ]
  );

  const handleCreate = async (
    payload: Pick<PrayerRequest, 'title'> &
      Partial<Pick<PrayerRequest, 'description' | 'tags'>>
  ) => {
    if (!user?.uid) return;
    await createPrayer({ userId: user.uid, ...payload });
    toast.success(t('prayer.toast.created'));
  };

  const handleEdit = async (
    payload: Pick<PrayerRequest, 'title'> &
      Partial<Pick<PrayerRequest, 'description' | 'tags'>>
  ) => {
    if (!editingPrayer) return;
    await updatePrayer(editingPrayer.id, payload);
    toast.success(t('prayer.toast.updated'));
    setEditingPrayer(null);
  };

  const handleDelete = async (id: string) => {
    await deletePrayer(id);
    toast.success(t('prayer.toast.deleted'));
  };

  const handleSetStatus = async (id: string, status: PrayerStatus) => {
    if (status === 'answered') {
      setMarkingAnsweredId(id);
      return;
    }

    await setStatus(id, status);
    toast.success(t('prayer.toast.statusChanged'));
  };

  const handleMarkAnswered = async (answerText?: string) => {
    if (!markingAnsweredId) return;
    await setStatus(markingAnsweredId, 'answered', answerText);
    toast.success(t('prayer.toast.statusChanged'));
    setMarkingAnsweredId(null);
  };

  const handleAddUpdate = async (text: string) => {
    if (!addingUpdateForId) return;
    await addUpdate(addingUpdateForId, text);
    toast.success(t('prayer.toast.updateAdded'));
    setAddingUpdateForId(null);
  };

  const hasFilterChanges =
    effectiveSortKey !== defaultSortKey ||
    !searchInUpdates ||
    !searchInTags ||
    !searchInAnswerText;

  const activeFilterCount =
    (effectiveSortKey !== defaultSortKey ? 1 : 0) +
    (!searchInUpdates ? 1 : 0) +
    (!searchInTags ? 1 : 0) +
    (!searchInAnswerText ? 1 : 0);

  const handleResetFilters = () => {
    void setSortKey(defaultSortKey);
    setSearchInUpdates(true);
    setSearchInTags(true);
    setSearchInAnswerText(true);

    try {
      localStorage.removeItem(LS_SEARCH_UPDATES);
      localStorage.removeItem(LS_SEARCH_TAGS);
      localStorage.removeItem(LS_SEARCH_ANSWERS);
    } catch {}
  };

  const filterTabs: { key: PrayerFilterStatus; label: string }[] = [
    { key: 'all', label: t('prayer.filter.all') },
    { key: 'active', label: t('prayer.filter.active') },
    { key: 'answered', label: t('prayer.filter.answered') },
    { key: 'not_answered', label: t('prayer.filter.not_answered') },
  ];

  const searchPrayersLabel = t('prayer.search.placeholder');

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <HeartIcon className="h-6 w-6 flex-shrink-0 text-rose-500" />
          <h1 className="bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-2xl font-bold leading-tight text-transparent sm:text-3xl">
            {t('prayer.title')}
          </h1>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-600"
        >
          <PlusIcon className="h-4 w-4" />
          {t('prayer.add')}
        </button>
      </div>

      <div className="relative z-40 mb-3 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-2 dark:border-gray-700">
          <nav className="flex flex-wrap gap-2" aria-label={t('prayer.filter.label')}>
            {filterTabs.map(({ key, label }) => {
              const isActive = effectiveFilterStatus === key;
              const activeClasses =
                key === 'active'
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/30 dark:text-rose-300'
                  : key === 'answered'
                    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/40 dark:bg-green-900/30 dark:text-green-300'
                    : key === 'not_answered'
                      ? 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                      : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-900/30 dark:text-blue-300';
              const activeBadgeClasses =
                key === 'active'
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-400'
                  : key === 'answered'
                    ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
                    : key === 'not_answered'
                      ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                      : 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400';

              return (
                <button
                  key={key}
                  onClick={() => handleFilterStatusChange(key)}
                  className={`${TAB_BASE_CLASSES} ${isActive ? activeClasses : TAB_INACTIVE_CLASSES}`}
                >
                  {label}
                  {counts[key] > 0 && (
                    <span
                      className={`ml-2 rounded-full px-2.5 py-0.5 text-xs ${
                        isActive ? activeBadgeClasses : BADGE_INACTIVE_CLASSES
                      }`}
                    >
                      {counts[key]}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div
              className="relative group/search"
              onFocus={() => setIsSearchExpanded(true)}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node) &&
                  !searchQuery.trim()
                ) {
                  setIsSearchExpanded(false);
                }
              }}
            >
              <form
                role="search"
                aria-label={t('dashboard.searchPanel.title')}
                onSubmit={(event) => event.preventDefault()}
                className={`flex items-center overflow-hidden rounded-xl border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isSearchExpanded
                    ? 'w-[280px] bg-white shadow-sm dark:bg-gray-800/80 sm:w-[320px] border-gray-200 dark:border-gray-700/80'
                    : 'w-10 border-transparent bg-transparent'
                }`}
              >
                <label htmlFor="prayer-search-input" className="sr-only">
                  {searchPrayersLabel}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchExpanded(true);
                    document.getElementById('prayer-search-input')?.focus();
                  }}
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
                    isSearchExpanded
                      ? 'text-rose-500'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                  }`}
                  aria-label={searchPrayersLabel}
                >
                  <MagnifyingGlassIcon className="h-5 w-5" />
                </button>
                <input
                  id="prayer-search-input"
                  type="search"
                  placeholder={searchPrayersLabel}
                  value={searchQuery}
                  onChange={(event) => void setSearchQuery(event.target.value)}
                  className={`w-full bg-transparent py-2 text-sm text-gray-900 outline-none transition-opacity duration-300 dark:text-gray-100 sm:text-base ${
                    isSearchExpanded
                      ? 'opacity-100 pr-16 placeholder-gray-400 dark:placeholder-gray-500'
                      : 'pointer-events-none opacity-0'
                  }`}
                  tabIndex={isSearchExpanded ? 0 : -1}
                />

                <div
                  className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 transition-opacity duration-300 ${
                    isSearchExpanded ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => void setSearchQuery('')}
                      aria-label={t('dashboard.clearSearch')}
                      className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  )}

                  <Popover className="relative z-30 flex">
                    {({ open }) => (
                      <>
                        <PopoverButton
                          aria-label={t('prayer.search.settings')}
                          className={`flex items-center justify-center rounded-full p-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-500 ${
                            open || !searchInUpdates || !searchInTags || !searchInAnswerText
                              ? 'bg-rose-50 text-rose-500 dark:bg-rose-900/40'
                              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                          }`}
                        >
                          <AdjustmentsHorizontalIcon className="h-4 w-4" />
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
                          <PopoverPanel className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-gray-100 bg-white p-3 shadow-lg focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                            <div className="space-y-3">
                              <label className="group flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={searchInUpdates}
                                  onChange={(event) => setSearchInUpdates(event.target.checked)}
                                  className={CHECKBOX_CLASSES}
                                />
                                <span className="text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-gray-100">
                                  {t('prayer.search.inUpdates')}
                                </span>
                              </label>
                              <label className="group flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={searchInTags}
                                  onChange={(event) => setSearchInTags(event.target.checked)}
                                  className={CHECKBOX_CLASSES}
                                />
                                <span className="text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-gray-100">
                                  {t('prayer.search.inTags')}
                                </span>
                              </label>
                              <label className="group flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={searchInAnswerText}
                                  onChange={(event) => setSearchInAnswerText(event.target.checked)}
                                  className={CHECKBOX_CLASSES}
                                />
                                <span className="text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-gray-100">
                                  {t('prayer.search.inAnswers')}
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

            <Popover className="relative z-30">
              {({ open }) => (
                <>
                  <PopoverButton
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-medium shadow-sm outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-rose-500 ${
                      open || hasFilterChanges
                        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/40 dark:text-rose-300'
                        : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700/80 dark:bg-gray-800/80 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                    }`}
                    aria-label={t('common.filters')}
                  >
                    <ArrowsUpDownIcon className="h-5 w-5" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-gray-900">
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
                    <PopoverPanel className="absolute right-0 z-40 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl focus:outline-none dark:border-gray-700 dark:bg-gray-800">
                      <div className="space-y-5 p-4">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {t('prayer.sort.label')}
                          </label>
                          <select
                            value={effectiveSortKey}
                            onChange={(event) =>
                              void setSortKey(event.target.value as PrayerSortKey)
                            }
                            className={SELECT_CLASSES}
                          >
                            {sortOptions.map(({ key, label }) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {hasFilterChanges && (
                          <div className="border-t border-gray-100 pt-3 dark:border-gray-700/50">
                            <button
                              type="button"
                              onClick={handleResetFilters}
                              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
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

        {hasFilterChanges && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            {effectiveSortKey !== defaultSortKey && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] font-medium text-rose-700 shadow-sm dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-300">
                <span>
                  {t('prayer.sort.label')}: {sortLabels[effectiveSortKey]}
                </span>
                <button
                  type="button"
                  onClick={() => void setSortKey(defaultSortKey)}
                  className="rounded-full p-0.5 transition-colors hover:bg-rose-200 dark:hover:bg-rose-800"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            )}

            {!searchInUpdates && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] font-medium text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <span className="line-through opacity-70">{t('prayer.search.inUpdates')}</span>
                <button
                  type="button"
                  onClick={() => setSearchInUpdates(true)}
                  className="rounded-full p-0.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            )}

            {!searchInTags && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] font-medium text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <span className="line-through opacity-70">{t('prayer.search.inTags')}</span>
                <button
                  type="button"
                  onClick={() => setSearchInTags(true)}
                  className="rounded-full p-0.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            )}

            {!searchInAnswerText && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] font-medium text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <span className="line-through opacity-70">{t('prayer.search.inAnswers')}</span>
                <button
                  type="button"
                  onClick={() => setSearchInAnswerText(true)}
                  className="rounded-full p-0.5 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            )}

            {activeFilterCount > 1 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="ml-1 inline-flex items-center px-2 py-1 text-xs font-semibold text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {t('filters.clear', 'Очистить все')}
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-gray-400 dark:text-gray-500">
          <HeartIcon className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">
            {prayerRequests.length === 0 ? t('prayer.empty') : t('prayer.emptyFiltered')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((prayer) => (
            <PrayerRequestCard
              key={prayer.id}
              prayer={prayer}
              searchQuery={searchQuery}
              onSetStatus={handleSetStatus}
              onDelete={handleDelete}
              onAddUpdate={(id) => setAddingUpdateForId(id)}
              onEdit={(selectedPrayer) => setEditingPrayer(selectedPrayer)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePrayerModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}
      {editingPrayer && (
        <CreatePrayerModal
          mode="edit"
          initialValues={editingPrayer}
          onClose={() => setEditingPrayer(null)}
          onSubmit={handleEdit}
        />
      )}
      {addingUpdateForId && (
        <AddUpdateModal
          onClose={() => setAddingUpdateForId(null)}
          onSubmit={handleAddUpdate}
        />
      )}
      {markingAnsweredId && (
        <MarkAnsweredModal
          onClose={() => setMarkingAnsweredId(null)}
          onSubmit={handleMarkAnswered}
        />
      )}
    </div>
  );
}
