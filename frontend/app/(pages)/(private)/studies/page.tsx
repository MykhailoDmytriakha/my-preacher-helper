'use client';

import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparklesIcon,
  LinkIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';

import { useStudyNoteBranchStates } from '@/hooks/useStudyNoteBranchStates';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useTags } from '@/hooks/useTags';
import { StudyNote, StudyNoteBranchKind, StudyNoteBranchStatus } from '@/models/models';

import { getBooksForDropdown, BibleLocale } from './bibleData';
import ShareNoteModal from './components/ShareNoteModal';
import StudyNoteCard from './StudyNoteCard';
import { filterAndSortStudyNotes } from './utils/filterStudyNotes';
import {
  buildStudyNoteMetadataSummaryMap,
  buildStudyWorkspaceMetadataCounts,
  buildStudyWorkspaceReviewLanes,
  buildStudyWorkspaceTopSemanticLabels,
  StudyNoteMetadataLabelFilter,
} from './utils/studyNoteMetadataSummary';

type NoteTabType = 'all' | 'notes' | 'questions';
type MetadataBranchKindFilter = StudyNoteBranchKind | '';
type MetadataBranchStatusFilter = StudyNoteBranchStatus | '';
const REVIEW_LANE_COLLAPSED_LIMIT = 4;

export default function StudiesPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const {
    uid,
    notes,
    loading: notesLoading,
    error: notesError,
  } = useStudyNotes();
  const {
    branchStates,
    loading: branchStatesLoading,
    error: branchStatesError,
  } = useStudyNoteBranchStates();
  const {
    shareLinks,
    loading: shareLinksLoading,
    createShareLink,
    deleteShareLink,
  } = useStudyNoteShareLinks();
  const { tags: tagData } = useTags(uid);


  // Get current locale for Bible data
  const bibleLocale: BibleLocale = useMemo(() => {
    const lang = i18n.language?.toLowerCase() || 'en';
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('uk')) return 'uk';
    return 'en';
  }, [i18n.language]);

  // Get localized book list for dropdowns
  const bookList = useMemo(() => getBooksForDropdown(bibleLocale), [bibleLocale]);

  // Tags
  const availableTags = useMemo(() => {
    const allTags = [...(tagData.requiredTags ?? []), ...(tagData.customTags ?? [])];
    return allTags.map((tag) => tag.name);
  }, [tagData.customTags, tagData.requiredTags]);

  // Filters (URL state via nuqs)
  const [searchQueryParam, setSearchQueryParam] = useQueryState('search', { defaultValue: '' });
  const [tagFilter, setTagFilter] = useQueryState('tag', { defaultValue: '' });
  const [bookFilter, setBookFilter] = useQueryState('book', { defaultValue: '' });
  const [branchKindFilter, setBranchKindFilter] = useQueryState<MetadataBranchKindFilter>('branchKind', {
    defaultValue: '',
    parse: (value) => (value || '') as MetadataBranchKindFilter,
  });
  const [branchStatusFilter, setBranchStatusFilter] = useQueryState<MetadataBranchStatusFilter>('branchStatus', {
    defaultValue: '',
    parse: (value) => (value || '') as MetadataBranchStatusFilter,
  });
  const [branchLabelFilter, setBranchLabelFilter] = useQueryState<StudyNoteMetadataLabelFilter>('branchLabel', {
    defaultValue: 'all',
    parse: (value) => (value === 'labeled' ? 'labeled' : 'all'),
  });

  // Type tabs
  const [activeTab, setActiveTab] = useQueryState<NoteTabType>('tab', { defaultValue: 'all', parse: (val) => val as NoteTabType });

  // Note counts by type (computed from all notes, not filtered)
  const noteCounts = useMemo(() => ({
    all: notes.length,
    notes: notes.filter(n => n.type !== 'question').length,
    questions: notes.filter(n => n.type === 'question').length,
  }), [notes]);

  const shareLinksByNoteId = useMemo(
    () => new Map(shareLinks.map((link) => [link.noteId, link])),
    [shareLinks]
  );

  const [shareNote, setShareNote] = useState<StudyNote | null>(null);

  // Expand state
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandedReviewLaneIds, setExpandedReviewLaneIds] = useState<Set<string>>(new Set());


  // Merge available tags with tags from notes
  const tagOptions = useMemo(() => {
    const fromNotes = new Set<string>();
    notes.forEach((n) => n.tags.forEach((tag) => fromNotes.add(tag)));
    return Array.from(new Set([...(availableTags || []), ...Array.from(fromNotes)])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [availableTags, notes]);

  // Trimmed search query for filtering and highlighting
  const searchQuery = useMemo(() => searchQueryParam.trim(), [searchQueryParam]);

  // Tokenized search for multi-word matching (AND across tokens, order-agnostic)
  const searchTokens = useMemo(
    () => searchQuery.toLowerCase().split(/\s+/).filter(Boolean),
    [searchQuery]
  );

  const noteMetadataSummaryByNoteId = useMemo(
    () => buildStudyNoteMetadataSummaryMap(branchStates),
    [branchStates]
  );

  const metadataScopeNotes = useMemo(() => {
    return filterAndSortStudyNotes({
      notes,
      activeTab,
      tagFilter,
      bookFilter,
      searchTokens,
      noteMetadataSummaryByNoteId,
      bibleLocale,
    });
  }, [notes, activeTab, tagFilter, bookFilter, searchTokens, noteMetadataSummaryByNoteId, bibleLocale]);

  const workspaceMetadataCounts = useMemo(
    () => buildStudyWorkspaceMetadataCounts(metadataScopeNotes, noteMetadataSummaryByNoteId),
    [metadataScopeNotes, noteMetadataSummaryByNoteId]
  );

  const topSemanticLabels = useMemo(
    () => buildStudyWorkspaceTopSemanticLabels(metadataScopeNotes, noteMetadataSummaryByNoteId),
    [metadataScopeNotes, noteMetadataSummaryByNoteId]
  );

  // Filter notes
  const filteredNotes = useMemo(() => {
    return filterAndSortStudyNotes({
      notes,
      activeTab,
      tagFilter,
      bookFilter,
      searchTokens,
      branchKindFilter,
      branchStatusFilter,
      branchLabelFilter,
      noteMetadataSummaryByNoteId,
      bibleLocale,
    });
  }, [
    notes,
    activeTab,
    tagFilter,
    bookFilter,
    searchTokens,
    branchKindFilter,
    branchStatusFilter,
    branchLabelFilter,
    noteMetadataSummaryByNoteId,
    bibleLocale,
  ]);

  const visibleNotes = filteredNotes;
  const reviewLanes = useMemo(
    () => buildStudyWorkspaceReviewLanes(metadataScopeNotes, branchStates),
    [branchStates, metadataScopeNotes]
  );
  const workspaceQueryString = useMemo(() => {
    const nextSearchParams = new URLSearchParams();

    if (searchQueryParam.trim()) {
      nextSearchParams.set('search', searchQueryParam.trim());
    }
    if (tagFilter) {
      nextSearchParams.set('tag', tagFilter);
    }
    if (bookFilter) {
      nextSearchParams.set('book', bookFilter);
    }
    if (activeTab !== 'all') {
      nextSearchParams.set('tab', activeTab);
    }
    if (branchKindFilter) {
      nextSearchParams.set('branchKind', branchKindFilter);
    }
    if (branchStatusFilter) {
      nextSearchParams.set('branchStatus', branchStatusFilter);
    }
    if (branchLabelFilter === 'labeled') {
      nextSearchParams.set('branchLabel', 'labeled');
    }

    return nextSearchParams.toString();
  }, [
    activeTab,
    bookFilter,
    branchKindFilter,
    branchLabelFilter,
    branchStatusFilter,
    searchQueryParam,
    tagFilter,
  ]);
  const buildWorkspaceBranchHref = useCallback(
    (noteId: string, branchId: string) => {
      const noteHref = `/studies/${noteId}`;
      const querySuffix = workspaceQueryString ? `?${workspaceQueryString}` : '';
      return `${noteHref}${querySuffix}#branch=${encodeURIComponent(branchId)}`;
    },
    [workspaceQueryString]
  );
  const toggleReviewLaneExpansion = useCallback((laneId: string) => {
    setExpandedReviewLaneIds((currentLaneIds) => {
      const nextLaneIds = new Set(currentLaneIds);

      if (nextLaneIds.has(laneId)) {
        nextLaneIds.delete(laneId);
      } else {
        nextLaneIds.add(laneId);
      }

      return nextLaneIds;
    });
  }, []);

  // Auto-expand all matching notes when searching
  // Auto-expand removed to allow Contextual Search Snippets to be visible in collapsed state.
  // User can manually expand if they want to see the full note.
  useEffect(() => {
    if (!searchQuery) {
      // Collapse all when search is cleared to reset view
      setExpandedNoteIds(new Set());
      setAllExpanded(false);
    }
  }, [searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const booksCount = notes.reduce<Record<string, number>>((acc, note) => {
      note.scriptureRefs.forEach((ref) => {
        acc[ref.book] = (acc[ref.book] || 0) + 1;
      });
      return acc;
    }, {});
    return { total: notes.length, booksCount };
  }, [notes]);

  const booksLeaderboard = useMemo(
    () =>
      Object.entries(stats.booksCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
    [stats.booksCount]
  );

  const branchKindOptions = useMemo(
    () => ([
      { value: '' as const, label: t('studiesWorkspace.branchMetadata.allKinds') },
      { value: 'summary' as const, label: t('studiesWorkspace.outlinePilot.branchKinds.summary') },
      { value: 'insight' as const, label: t('studiesWorkspace.outlinePilot.branchKinds.insight') },
      { value: 'evidence' as const, label: t('studiesWorkspace.outlinePilot.branchKinds.evidence') },
      { value: 'question' as const, label: t('studiesWorkspace.outlinePilot.branchKinds.question') },
      { value: 'application' as const, label: t('studiesWorkspace.outlinePilot.branchKinds.application') },
    ]),
    [t]
  );

  const branchStatusOptions = useMemo(
    () => ([
      { value: '' as const, label: t('studiesWorkspace.branchMetadata.allStatuses') },
      { value: 'active' as const, label: t('studiesWorkspace.outlinePilot.branchStatuses.active') },
      { value: 'tentative' as const, label: t('studiesWorkspace.outlinePilot.branchStatuses.tentative') },
      { value: 'confirmed' as const, label: t('studiesWorkspace.outlinePilot.branchStatuses.confirmed') },
      { value: 'resolved' as const, label: t('studiesWorkspace.outlinePilot.branchStatuses.resolved') },
    ]),
    [t]
  );

  const metadataReviewCards = useMemo(() => ([
    {
      id: 'evidence',
      label: t('studiesWorkspace.branchMetadata.reviewCards.evidence'),
      count: workspaceMetadataCounts.kindNoteCounts.evidence ?? 0,
      onClick: () => setBranchKindFilter('evidence'),
      active: branchKindFilter === 'evidence',
    },
    {
      id: 'question',
      label: t('studiesWorkspace.branchMetadata.reviewCards.questions'),
      count: workspaceMetadataCounts.kindNoteCounts.question ?? 0,
      onClick: () => setBranchKindFilter('question'),
      active: branchKindFilter === 'question',
    },
    {
      id: 'confirmed',
      label: t('studiesWorkspace.branchMetadata.reviewCards.confirmed'),
      count: workspaceMetadataCounts.statusNoteCounts.confirmed ?? 0,
      onClick: () => setBranchStatusFilter('confirmed'),
      active: branchStatusFilter === 'confirmed',
    },
    {
      id: 'application',
      label: t('studiesWorkspace.branchMetadata.reviewCards.applications'),
      count: workspaceMetadataCounts.kindNoteCounts.application ?? 0,
      onClick: () => setBranchKindFilter('application'),
      active: branchKindFilter === 'application',
    },
    {
      id: 'labeled',
      label: t('studiesWorkspace.branchMetadata.reviewCards.labels'),
      count: workspaceMetadataCounts.labeledNotes,
      onClick: () => setBranchLabelFilter('labeled'),
      active: branchLabelFilter === 'labeled',
    },
  ]), [
    t,
    workspaceMetadataCounts,
    branchKindFilter,
    branchStatusFilter,
    branchLabelFilter,
    setBranchKindFilter,
    setBranchStatusFilter,
    setBranchLabelFilter,
  ]);



  const handleExpandAll = () => {
    if (allExpanded) {
      setExpandedNoteIds(new Set());
      setAllExpanded(false);
    } else {
      setExpandedNoteIds(new Set(visibleNotes.map((n) => n.id)));
      setAllExpanded(true);
    }
  };

  const handleAddNote = () => {
    router.push('/studies/new');
  };


  const handleShareNote = useCallback((note: StudyNote) => {
    setShareNote(note);
  }, []);

  const clearFilters = () => {
    setSearchQueryParam('');
    setTagFilter('');
    setBookFilter('');
    setBranchKindFilter('');
    setBranchStatusFilter('');
    setBranchLabelFilter('all');
  };

  const hasMetadataFilters = !!branchKindFilter || !!branchStatusFilter || branchLabelFilter === 'labeled';
  const hasActiveFilters = searchQueryParam || tagFilter || bookFilter || hasMetadataFilters;

  return (
    <section className="space-y-4 md:space-y-6">
      {/* Header */}
      <header className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-100 dark:ring-emerald-800/60">
          <SparklesIcon className="h-4 w-4" />
          {t('workspaces.studies.badge')}
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">
              {t('workspaces.studies.title')}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
              {t('workspaces.studies.description')}
            </p>
          </div>

          {/* Add button */}
          <div className="flex w-full flex-col sm:flex-row gap-2 md:w-auto md:items-center">
            <Link
              href="/studies/share-links"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:w-auto"
            >
              <LinkIcon className="h-4 w-4" />
              {t('studiesWorkspace.shareLinks.manageButton')}
            </Link>
            <button
              onClick={handleAddNote}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 sm:w-auto"
            >
              <PlusIcon className="h-4 w-4" />
              {t('studiesWorkspace.newNote')}
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="h-5 w-5" />
            <span>
              {stats.total} {t('studiesWorkspace.stats.notesLabel')}
            </span>
          </div>
          {booksLeaderboard.length > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">•</span>
              <div className="flex items-center gap-2">
                <BookOpenIcon className="h-4 w-4" />
                <span>{Object.keys(stats.booksCount).length} {t('studiesWorkspace.stats.booksLabel')}</span>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Type Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['all', 'notes', 'questions'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors
              ${activeTab === tab
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
          >
            {t(`studiesWorkspace.tabs.${tab}`)}
            {/* Show count in parentheses for non-question tabs */}
            {tab !== 'questions' && (
              <span className={`ml-1.5 ${activeTab === tab ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                ({noteCounts[tab]})
              </span>
            )}

            {/* Active tab indicator */}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
            )}

            {/* Amber badge for questions (always show if > 0, replaces parentheses count) */}
            {tab === 'questions' && noteCounts.questions > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {noteCounts.questions}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search and Filters */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQueryParam('')}
                className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                aria-label={t('studiesWorkspace.clearSearch')}
              >
                <XMarkIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('studiesWorkspace.clearSearch')}</span>
              </button>
            )}
            <input
              value={searchQueryParam}
              onChange={(e) => setSearchQueryParam(e.target.value)}
              placeholder={t('studiesWorkspace.searchPlaceholder')}
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-12 sm:pr-28 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>

          {/* Filter toggles */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={bookFilter || ''}
              onChange={(e) => setBookFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:w-auto"
            >
              <option value="">{t('studiesWorkspace.filterByBook')}</option>
              {bookList.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </select>

            <select
              value={tagFilter || ''}
              onChange={(e) => setTagFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:w-auto"
            >
              <option value="">{t('studiesWorkspace.filterByTag')}</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:w-auto"
              >
                <XMarkIcon className="h-4 w-4" />
                {t('common.clearFilters') || 'Clear'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4 shadow-sm dark:border-emerald-900/50 dark:from-emerald-950/30 dark:via-gray-900 dark:to-sky-950/20">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              {t('studiesWorkspace.branchMetadata.title')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {branchStatesLoading
                ? t('studiesWorkspace.branchMetadata.loading')
                : t('studiesWorkspace.branchMetadata.hint', { count: workspaceMetadataCounts.notesWithMetadata })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-gray-900/60 dark:text-emerald-200">
              {t('studiesWorkspace.branchMetadata.notesWithMetadata')} · {workspaceMetadataCounts.notesWithMetadata}
            </span>
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-white/80 px-2.5 py-1 font-semibold text-violet-700 dark:border-violet-800 dark:bg-gray-900/60 dark:text-violet-200">
              {t('studiesWorkspace.branchMetadata.labeledNotes')} · {workspaceMetadataCounts.labeledNotes}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.branchMetadata.kindFilter')}
            </span>
            <select
              data-testid="studies-branch-kind-filter"
              value={branchKindFilter}
              onChange={(e) => setBranchKindFilter(e.target.value as MetadataBranchKindFilter)}
              disabled={branchStatesLoading}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {branchKindOptions.map((option) => (
                <option key={`workspace-branch-kind-${option.value || 'all'}`} value={option.value}>
                  {option.label}
                  {option.value ? ` (${workspaceMetadataCounts.kindNoteCounts[option.value] ?? 0})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.branchMetadata.statusFilter')}
            </span>
            <select
              data-testid="studies-branch-status-filter"
              value={branchStatusFilter}
              onChange={(e) => setBranchStatusFilter(e.target.value as MetadataBranchStatusFilter)}
              disabled={branchStatesLoading}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {branchStatusOptions.map((option) => (
                <option key={`workspace-branch-status-${option.value || 'all'}`} value={option.value}>
                  {option.label}
                  {option.value ? ` (${workspaceMetadataCounts.statusNoteCounts[option.value] ?? 0})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2 lg:justify-end">
            <button
              type="button"
              data-testid="studies-branch-label-filter"
              onClick={() => setBranchLabelFilter(branchLabelFilter === 'labeled' ? 'all' : 'labeled')}
              disabled={branchStatesLoading}
              className={`inline-flex items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium transition disabled:opacity-60 ${
                branchLabelFilter === 'labeled'
                  ? 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-100'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {t('studiesWorkspace.branchMetadata.labeledOnly')} ({workspaceMetadataCounts.labeledNotes})
            </button>
            {hasMetadataFilters && (
              <button
                type="button"
                onClick={() => {
                  setBranchKindFilter('');
                  setBranchStatusFilter('');
                  setBranchLabelFilter('all');
                }}
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {t('studiesWorkspace.branchMetadata.clear')}
              </button>
            )}
          </div>
        </div>

        {branchStatesError && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            {t('studiesWorkspace.branchMetadata.error')}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700 dark:text-gray-200">
            {t('studiesWorkspace.branchMetadata.reviewTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t('studiesWorkspace.branchMetadata.reviewHint')}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {metadataReviewCards.map((card) => (
            <button
              key={card.id}
              type="button"
              data-testid={`studies-metadata-review-card-${card.id}`}
              onClick={card.onClick}
              className={`rounded-2xl border p-4 text-left transition ${
                card.active
                  ? 'border-emerald-300 bg-emerald-50 shadow-sm dark:border-emerald-700 dark:bg-emerald-900/30'
                  : 'border-gray-200 bg-gray-50 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/30'
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                {card.label}
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
                {card.count}
              </div>
            </button>
          ))}
        </div>

        {topSemanticLabels.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.branchMetadata.topLabels')}
            </div>
            <div className="flex flex-wrap gap-2">
              {topSemanticLabels.map((labelEntry) => (
                <button
                  key={`workspace-top-label-${labelEntry.label}`}
                  type="button"
                  data-testid={`studies-top-label-${labelEntry.label}`}
                  onClick={() => setSearchQueryParam(labelEntry.label)}
                  className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700 transition hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200 dark:hover:bg-violet-900/50"
                >
                  {labelEntry.label}
                  <span className="ml-2 rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-violet-700 dark:bg-gray-900/70 dark:text-violet-200">
                    {labelEntry.noteCount}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {reviewLanes.some((lane) => lane.totalItems > 0) && (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700 dark:text-gray-200">
              {t('studiesWorkspace.branchMetadata.reviewQueuesTitle')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('studiesWorkspace.branchMetadata.reviewQueuesHint')}
            </p>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {reviewLanes
              .filter((lane) => lane.totalItems > 0)
              .map((lane) => {
                const isLaneExpanded = expandedReviewLaneIds.has(lane.id);
                const visibleLaneItems = isLaneExpanded
                  ? lane.items
                  : lane.items.slice(0, REVIEW_LANE_COLLAPSED_LIMIT);

                return (
                  <section
                    key={`workspace-review-lane-${lane.id}`}
                    data-testid={`studies-review-lane-${lane.id}`}
                    className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-800/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                        {t(`studiesWorkspace.branchMetadata.reviewLanes.${lane.id === 'question' ? 'questions' : lane.id === 'application' ? 'applications' : lane.id === 'labeled' ? 'labels' : lane.id}`)}
                      </div>
                      <div className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold tabular-nums text-gray-700 shadow-sm dark:bg-gray-900/80 dark:text-gray-200">
                        {lane.items.length}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {visibleLaneItems.map((item) => (
                        <Link
                          key={`workspace-review-branch-${lane.id}-${item.branchId}`}
                          data-testid={`studies-review-branch-${lane.id}-${item.branchId}`}
                          href={buildWorkspaceBranchHref(item.noteId, item.branchId)}
                          className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 transition hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-gray-700 dark:bg-gray-900/70 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {item.branchTitle}
                            </div>
                            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {item.noteTitle}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {item.branchKind && (
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                                  {t(`studiesWorkspace.outlinePilot.branchKinds.${item.branchKind}`)}
                                </span>
                              )}
                              {item.branchStatus && (
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                                  {t(`studiesWorkspace.outlinePilot.branchStatuses.${item.branchStatus}`)}
                                </span>
                              )}
                              {item.semanticLabel && (
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200">
                                  {item.semanticLabel}
                                </span>
                              )}
                              {!item.isResolved && (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                                  {t('studiesWorkspace.branchMetadata.anchorNeedsRefresh')}
                                </span>
                              )}
                            </div>
                          </div>

                          <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
                        </Link>
                      ))}
                    </div>

                    {lane.items.length > REVIEW_LANE_COLLAPSED_LIMIT && (
                      <button
                        type="button"
                        data-testid={`studies-review-lane-toggle-${lane.id}`}
                        onClick={() => toggleReviewLaneExpansion(lane.id)}
                        className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        {isLaneExpanded
                          ? t('studiesWorkspace.branchMetadata.showLessLaneItems')
                          : t('studiesWorkspace.branchMetadata.showAllLaneItems', { count: lane.items.length })}
                      </button>
                    )}
                  </section>
                );
              })}
          </div>
        </div>
      )}

      {/* Results header with expand/collapse */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {hasActiveFilters ? (
            <span>
              {t('studiesWorkspace.matchingNotes')}: <strong>{visibleNotes.length}</strong>
            </span>
          ) : (
            <span>
              {t('studiesWorkspace.allNotes')}: <strong>{visibleNotes.length}</strong>
            </span>
          )}
        </div>

        {visibleNotes.length > 0 && (
          <button
            onClick={handleExpandAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {allExpanded ? (
              <>
                <ChevronUpIcon className="h-4 w-4" />
                {t('studiesWorkspace.collapseAll') || 'Collapse all'}
              </>
            ) : (
              <>
                <ChevronDownIcon className="h-4 w-4" />
                {t('studiesWorkspace.expandAll') || 'Expand all'}
              </>
            )}
          </button>
        )}
      </div>

      {/* Notes list */}
      {notesError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {notesError.message}
        </div>
      )}

      {notesLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : visibleNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 py-12 dark:border-gray-700 dark:bg-gray-900">
          <ClipboardDocumentListIcon className="h-12 w-12 text-gray-400 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            {hasActiveFilters
              ? t('studiesWorkspace.noMatchingNotes') || 'No notes match your filters'
              : t('studiesWorkspace.noNotes')}
          </p>
          {!hasActiveFilters && (
            <button
              onClick={handleAddNote}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('studiesWorkspace.createFirstNote') || 'Create your first note'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleNotes.map((note) => (
            <StudyNoteCard
              key={note.id}
              note={note}
              metadataSummary={noteMetadataSummaryByNoteId.get(note.id)}
              bibleLocale={bibleLocale}
              isExpanded={expandedNoteIds.has(note.id)}
              onEdit={(n) => router.push(`/studies/${n.id}${window.location.search}`)}
              searchQuery={searchQuery}
              onShare={handleShareNote}
              hasShareLink={shareLinksByNoteId.has(note.id)}
            />
          ))}
        </div>
      )}

      <ShareNoteModal
        isOpen={shareNote !== null}
        note={shareNote}
        shareLink={shareNote ? shareLinksByNoteId.get(shareNote.id) : undefined}
        loading={shareLinksLoading}
        onClose={() => setShareNote(null)}
        onCreate={createShareLink}
        onDelete={deleteShareLink}
      />
    </section>
  );
}
