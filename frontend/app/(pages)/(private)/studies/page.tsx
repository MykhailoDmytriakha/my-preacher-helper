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
import { useDeferredValue, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';

import { ScriptureWrittenIn } from '@/components/bible/ScriptureLinks';
import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import { CommentDialog, type CommentTarget } from '@/components/CommentDialog';
import { CommentIcon } from '@/components/Icons';
import Select from '@/components/ui/Select';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useTags } from '@/hooks/useTags';
import { ScriptureReference, StudyNote } from '@/models/models';
import { resolveAppLocale } from '@/utils/appLocale';
import { getBooksForDropdown } from '@/utils/bibleBooks';
import { newClientId } from '@/utils/clientId';
import { isKnownOffline } from '@/utils/connectivity';
import { studyNoteLanguage } from '@/utils/documentLanguage';
import { formatScriptureReference, scriptureReferenceSearchText, studyNoteSearchText } from '@/utils/scriptureReference';
import { inStudies, inStudyNoteTab, STUDY_NOTE_TABS, type StudyNoteTab } from '@/utils/studyNoteTabs';

import { CommentCard } from './CommentCard';
import ShareNoteModal from './components/ShareNoteModal';
import ScriptureRefPicker from './ScriptureRefPicker';
import StudyNoteCard from './StudyNoteCard';

import type { AppLocale } from '@/utils/appLocale';

export default function StudiesPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const {
    uid,
    notes: allNotes,
    loading: notesLoading,
    error: notesError,
  } = useStudyNotes();
  // What stands in Studies: every list, count, tag and book below is read from these.
  const notes = useMemo(() => allNotes.filter(inStudies), [allNotes]);
  const {
    shareLinks,
    loading: shareLinksLoading,
    createShareLink,
    deleteShareLink,
  } = useStudyNoteShareLinks();
  const { tags: tagData } = useTags(uid);


  // Get current locale for Bible data
  const bibleLocale: AppLocale = useMemo(() => resolveAppLocale(i18n.language), [i18n.language]);

  // Get localized book list for dropdowns
  const bookList = useMemo(() => getBooksForDropdown(bibleLocale), [bibleLocale]);

  // Tags
  const availableTags = useMemo(() => {
    const allTags = [...(tagData.requiredTags ?? []), ...(tagData.customTags ?? [])];
    return allTags.map((tag) => tag.name);
  }, [tagData.customTags, tagData.requiredTags]);

  // Filters (URL state via nuqs)
  // nuqs owns the URL param (persistence across navigation), but the input's
  // displayed value + filtering read from a LOCAL mirror. Reason: nuqs's
  // optimistic→URL reconciliation makes searchQueryParam briefly bounce back to
  // the old value on a real Escape/clear keypress (verified: value + list +
  // highlights flash old→new→old). Local state clears synchronously in one
  // render, so nothing rendered ever bounces. See applySearch below.
  const [searchQueryParam, setSearchQueryParam] = useQueryState('search', { defaultValue: '', throttleMs: 0 });
  const [tagFilter, setTagFilter] = useQueryState('tag', { defaultValue: '' });
  const [bookFilter, setBookFilter] = useQueryState('book', { defaultValue: '' });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(searchQueryParam);
  // Single writer: local mirror (instant, drives UI) + URL param (persistence).
  const applySearch = useCallback((value: string) => {
    setSearch(value);
    void setSearchQueryParam(value);
  }, [setSearchQueryParam]);
  // Adopt URL→local only on external changes (back-nav restore) while the user
  // is NOT typing — this ignores nuqs's transient bounce during a focused clear.
  useEffect(() => {
    if (searchQueryParam !== search && document.activeElement !== searchInputRef.current) {
      setSearch(searchQueryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQueryParam]);

  // Type tabs
  const [activeTab, setActiveTab] = useQueryState<StudyNoteTab>('tab', { defaultValue: 'all', parse: (val) => val as StudyNoteTab });

  // Note counts by type (computed from all notes, not filtered)
  const noteCounts = useMemo(() => ({
    all: notes.length,
    notes: notes.filter(n => inStudyNoteTab(n, 'notes')).length,
    comments: notes.filter(n => inStudyNoteTab(n, 'comments')).length,
    questions: notes.filter(n => inStudyNoteTab(n, 'questions')).length,
  }), [notes]);

  const shareLinksByNoteId = useMemo(
    () => new Map(shareLinks.map((link) => [link.noteId, link])),
    [shareLinks]
  );

  const [shareNote, setShareNote] = useState<StudyNote | null>(null);
  // A comment opens in its window, edited only there; a new one chooses its verse or chapter first.
  const [commentWindow, setCommentWindow] = useState<{ kind: 'edit'; id: string } | { kind: 'new'; reference: ScriptureReference | null; choosing?: boolean } | null>(null);

  // Expand state
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());


  // Merge available tags with tags from notes
  const tagOptions = useMemo(() => {
    const fromNotes = new Set<string>();
    notes.forEach((n) => n.tags.forEach((tag) => fromNotes.add(tag)));
    return Array.from(new Set([...(availableTags || []), ...Array.from(fromNotes)])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [availableTags, notes]);

  /**
   * The field answers the keystroke at once; the list follows when the browser is free
   * (BUG-20260809-studies-search-lag). Filtering, snippets and highlighting of every card ran
   * inside the keystroke itself, so with a few hundred notes each letter froze the field for
   * a noticeable moment. The list below is built from this deferred value and memoized, so the
   * urgent render of a keystroke reuses it untouched and a newer letter interrupts a stale one.
   */
  const deferredSearch = useDeferredValue(search);
  const searchQuery = useMemo(() => deferredSearch.trim(), [deferredSearch]);
  // The results still describe an earlier query: say so, and keep bulk actions off them until they catch up.
  const resultsCatchingUp = search !== deferredSearch;

  // Tokenized search for multi-word matching (AND across tokens, order-agnostic)
  const searchTokens = useMemo(
    () => searchQuery.toLowerCase().split(/\s+/).filter(Boolean),
    [searchQuery]
  );

  const matchesSearchTokens = useCallback(
    (note: StudyNote) => {
      if (searchTokens.length === 0) return true;

      const tokens = searchTokens;
      const title = (note.title || '').toLowerCase();
      const content = (note.content || '').toLowerCase();

      const tagsMatch = note.tags.some((tag) => {
        const lowered = tag.toLowerCase();
        return tokens.some((token) => lowered.includes(token));
      });

      // Matched by what the card shows — both the abbreviation and the spelled-out name, the
      // Psalms renumbered as displayed (`scriptureReferenceSearchText`).
      const refsMatch = note.scriptureRefs.some((ref) => {
        const refText = scriptureReferenceSearchText(ref, bibleLocale);
        return tokens.some((token) => refText.includes(token));
      });

      const contentMatch = tokens.some((token) => content.includes(token));
      const titleMatch = tokens.some((token) => title.includes(token));

      return contentMatch || tagsMatch || refsMatch || titleMatch;
    },
    [searchTokens, bibleLocale]
  );

  // Filter notes
  const filteredNotes = useMemo(() => {
    return notes
      // Tab filter
      .filter((note) => inStudyNoteTab(note, activeTab))
      .filter((note) => (tagFilter ? note.tags.includes(tagFilter) : true))
      .filter((note) =>
        bookFilter
          ? note.scriptureRefs.some((ref) => ref.book.toLowerCase() === bookFilter.toLowerCase())
          : true
      )
      .filter((note) => {
        if (searchTokens.length === 0) return true;
        const haystack = studyNoteSearchText(note, bibleLocale);

        return searchTokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, activeTab, tagFilter, bookFilter, searchTokens, bibleLocale]);

  const visibleNotes = useMemo(
    () => filteredNotes.filter((note) => matchesSearchTokens(note)),
    [filteredNotes, matchesSearchTokens]
  );

  // Auto-expand all matching notes when searching
  // Auto-expand removed to allow Contextual Search Snippets to be visible in collapsed state.
  // User can manually expand if they want to see the full note.
  useEffect(() => {
    if (!searchQuery) {
      // Collapse all when search is cleared to reset view
      setExpandedNoteIds(new Set());
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



  // Derived, never stored: with a separate flag the button kept offering "collapse all"
  // over a list the reader had already folded shut card by card.
  const allExpanded =
    visibleNotes.length > 0 && visibleNotes.every((note) => expandedNoteIds.has(note.id));

  const handleExpandAll = () => {
    setExpandedNoteIds(allExpanded ? new Set() : new Set(visibleNotes.map((n) => n.id)));
  };

  const handleToggleNoteExpanded = useCallback((noteId: string) => {
    setExpandedNoteIds((previous) => {
      const next = new Set(previous);
      if (!next.delete(noteId)) next.add(noteId);
      return next;
    });
  }, []);

  const handleAddNote = () => {
    // In the comments' tab the main button writes a comment, in its window, not a note on its page.
    if (activeTab === 'comments') {
      setCommentWindow({ kind: 'new', reference: null });
      return;
    }
    router.push('/studies/new');
  };


  const handleShareNote = useCallback((note: StudyNote) => {
    setShareNote(note);
  }, []);

  // Same elements while the deferred query is unchanged: a keystroke's urgent render skips every card.
  const noteCards = useMemo(
    () =>
      visibleNotes.map((note) => (
        // A note's title says its language too, for a reference its body alone does not.
        <ScriptureWrittenIn key={note.id} language={studyNoteLanguage(note)}>
        {note.type === 'comment' ? (
          <CommentCard note={note} searchQuery={searchQuery} onOpen={(id) => setCommentWindow({ kind: 'edit', id })} />
        ) : (
        <StudyNoteCard
          note={note}
          bibleLocale={bibleLocale}
          isExpanded={expandedNoteIds.has(note.id)}
          onToggleExpand={handleToggleNoteExpanded}
          onEdit={(n) => router.push(`/studies/${n.id}${window.location.search}`)}
          searchQuery={searchQuery}
          onShare={handleShareNote}
          hasShareLink={shareLinksByNoteId.has(note.id)}
        />
        )}
        </ScriptureWrittenIn>
      )),
    [visibleNotes, bibleLocale, expandedNoteIds, handleToggleNoteExpanded, router, searchQuery, handleShareNote, shareLinksByNoteId]
  );

  const clearFilters = () => {
    applySearch('');
    setTagFilter('');
    setBookFilter('');
  };

  const hasActiveFilters = search || tagFilter || bookFilter;

  return (
    // A reference in a note opens over the list; each note's own words say the Bible its references were written in.
    <ScriptureLinksInWindow>
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
              {activeTab === 'comments' ? t('studiesWorkspace.newComment') : t('studiesWorkspace.newNote')}
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="h-5 w-5" />
            <span>
              {stats.total} {t('studiesWorkspace.stats.notesLabel', { count: stats.total })}
            </span>
          </div>
          {booksLeaderboard.length > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">•</span>
              <div className="flex items-center gap-2">
                <BookOpenIcon className="h-4 w-4" />
                <span>{Object.keys(stats.booksCount).length} {t('studiesWorkspace.stats.booksLabel', { count: Object.keys(stats.booksCount).length })}</span>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Type Tabs */}
      {/* Four tabs fit a computer; on a narrow phone the row slides under the finger rather than clip a word. */}
      <div className="-mx-4 flex overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-700 sm:mx-0 sm:px-0">
        {STUDY_NOTE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors sm:px-4
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
            {search.trim() && (
              <button
                type="button"
                onClick={() => applySearch('')}
                className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                aria-label={t('studiesWorkspace.clearSearch')}
              >
                <XMarkIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('studiesWorkspace.clearSearch')}</span>
              </button>
            )}
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => applySearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') applySearch(''); }}
              placeholder={t('studiesWorkspace.searchPlaceholder')}
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-12 sm:pr-28 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>

          {/* Filter toggles */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* Both filters keep the same width whatever their longest option is: letting the
                browser size them made the tag filter twice the book filter's width and left
                its label stranded far from its arrow. */}
            <Select
              size="md"
              accent="emerald"
              value={bookFilter || ''}
              onChange={(e) => setBookFilter(e.target.value)}
              wrapperClassName="w-full sm:w-52"
              aria-label={t('studiesWorkspace.filterByBook')}
            >
              <option value="">{t('studiesWorkspace.filterByBook')}</option>
              {bookList.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </Select>

            <Select
              size="md"
              accent="emerald"
              value={tagFilter || ''}
              onChange={(e) => setTagFilter(e.target.value)}
              wrapperClassName="w-full sm:w-52"
              aria-label={t('studiesWorkspace.filterByTag')}
            >
              <option value="">{t('studiesWorkspace.filterByTag')}</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </Select>

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

      <div
        data-testid="study-results"
        aria-busy={resultsCatchingUp}
        className="space-y-4 md:space-y-6"
        // Dimmed only when catching up takes a moment, so a quick list never flickers.
        style={{ opacity: resultsCatchingUp ? 0.6 : 1, transition: resultsCatchingUp ? 'opacity 0.2s 0.2s linear' : 'opacity 0s linear' }}
      >
      {/* Results header with expand/collapse */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {hasActiveFilters ? (
            <span>
              {t('studiesWorkspace.matchingNotes')}: <strong>{visibleNotes.length}</strong>
            </span>
          ) : (
            <span>
              {t(activeTab === 'all' ? 'studiesWorkspace.allNotes' : `studiesWorkspace.tabs.${activeTab}`)}: <strong>{visibleNotes.length}</strong>
            </span>
          )}
        </div>

        {/* Only a note folds: a list of comments alone has nothing to unfold. */}
        {visibleNotes.some((note) => note.type !== 'comment') && (
          <button
            onClick={handleExpandAll}
            disabled={resultsCatchingUp}
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
          {t(isKnownOffline() ? 'studiesWorkspace.loadOffline' : 'studiesWorkspace.loadError')}
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
      ) : visibleNotes.length === 0 && activeTab === 'comments' && !hasActiveFilters ? (
        // The comments' tab on its first opening: what will be here and where it starts — an invitation, not an error.
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-500"><CommentIcon className="h-5 w-5 text-white" /></span>
          <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{t('studiesWorkspace.commentsEmptyTitle')}</p>
          <p className="max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-400">{t('studiesWorkspace.commentsEmptyHint')}</p>
          <Link href="/bible" className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
            <BookOpenIcon className="h-4 w-4" />
            {t('studiesWorkspace.openBible')}
          </Link>
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
        <div className="space-y-3">{noteCards}</div>
      )}
      </div>

      {commentWindow ? (() => {
        const note = commentWindow.kind === 'edit' ? notes.find((n) => n.id === commentWindow.id) : undefined;
        const reference = commentWindow.kind === 'new' ? commentWindow.reference : note?.scriptureRefs[0] ?? null;
        const place = reference ? formatScriptureReference(reference, { locale: bibleLocale }) : '';
        const target: CommentTarget = commentWindow.kind === 'edit' ? { kind: 'edit', id: commentWindow.id } : { kind: 'new', reference: commentWindow.reference };
        // A new comment chooses its verse or chapter here, away from the Bible; once chosen, the place can be changed. The
        // place chosen stays the comment's while another is being picked — a reload then keeps it with the words — and is
        // replaced only by a confirmed one. The picker's Cancel keeps it, or closes the window through its own question.
        const placePicker = commentWindow.kind !== 'new' ? undefined : ({ requestClose }: { requestClose: () => void }) => (commentWindow.reference && !commentWindow.choosing ? (
          <button type="button" onClick={() => setCommentWindow({ kind: 'new', reference: commentWindow.reference, choosing: true })} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
            {t('comment.changePlace')}
          </button>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('comment.pickPlace')}</p>
            <ScriptureRefPicker
              placesOnly
              initialRef={commentWindow.reference ?? undefined}
              onConfirm={(picked) => setCommentWindow({ kind: 'new', reference: { ...picked, id: newClientId() } })}
              onCancel={() => (commentWindow.reference ? setCommentWindow({ kind: 'new', reference: commentWindow.reference }) : requestClose())}
            />
          </div>
        ));
        return (
          <CommentDialog
            key={commentWindow.kind === 'edit' ? commentWindow.id : 'new'}
            target={target}
            place={place}
            placePicker={placePicker}
            restorePlace={(restored) => setCommentWindow({ kind: 'new', reference: restored })}
            onClose={() => setCommentWindow(null)}
          />
        );
      })() : null}

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
    </ScriptureLinksInWindow>
  );
}
