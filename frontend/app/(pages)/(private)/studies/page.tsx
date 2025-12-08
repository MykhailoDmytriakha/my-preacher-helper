'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StudyNote } from '@/models/models';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { getTags } from '@/services/tag.service';
import { getBooksForDropdown, BibleLocale } from './bibleData';
import StudyNoteCard from './StudyNoteCard';
import AddStudyNoteModal, { NoteFormValues } from './AddStudyNoteModal';
import StudyNoteDrawer from './StudyNoteDrawer';

export default function StudiesPage() {
  const { t, i18n } = useTranslation();
  const {
    uid,
    notes,
    loading: notesLoading,
    error: notesError,
    createNote,
    updateNote,
    deleteNote,
  } = useStudyNotes();

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
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Expand state
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingNote, setEditingNote] = useState<StudyNote | null>(null);

  // AI analysis state (for inline card analysis)
  const [analyzingNoteId, setAnalyzingNoteId] = useState<string | null>(null);

  // Load user tags
  useEffect(() => {
    if (!uid) return;
    getTags(uid)
      .then((tags) => {
        if (Array.isArray(tags)) {
          setAvailableTags(tags.map((t: { name: string }) => t.name));
        } else {
          setAvailableTags([]);
        }
      })
      .catch((err) => console.error('Failed to load tags for studies', err));
  }, [uid]);

  // Merge available tags with tags from notes
  const tagOptions = useMemo(() => {
    const fromNotes = new Set<string>();
    notes.forEach((n) => n.tags.forEach((tag) => fromNotes.add(tag)));
    return Array.from(new Set([...(availableTags || []), ...Array.from(fromNotes)])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [availableTags, notes]);

  // Filter notes
  const filteredNotes = useMemo(() => {
    const query = search.toLowerCase().trim();
    return notes
      .filter((note) => (tagFilter ? note.tags.includes(tagFilter) : true))
      .filter((note) =>
        bookFilter
          ? note.scriptureRefs.some((ref) => ref.book.toLowerCase() === bookFilter.toLowerCase())
          : true
      )
      .filter((note) => {
        if (!query) return true;
        const haystack = `${note.title} ${note.content} ${note.tags.join(' ')} ${note.scriptureRefs
          .map((ref) => `${ref.book} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`)
          .join(' ')}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, tagFilter, bookFilter, search]);

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

  // Handlers
  const toggleNoteExpand = (noteId: string) => {
    setExpandedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    if (allExpanded) {
      setExpandedNoteIds(new Set());
      setAllExpanded(false);
    } else {
      setExpandedNoteIds(new Set(filteredNotes.map((n) => n.id)));
      setAllExpanded(true);
    }
  };

  const handleAddNote = async (values: NoteFormValues) => {
    if (!uid) return;
    await createNote({
      ...values,
      userId: uid,
    } as any);
  };

  const handleUpdateNote = async (noteId: string, updates: Partial<StudyNote>) => {
    await updateNote({ id: noteId, updates });
  };

  const handleAnalyzeNote = async (note: StudyNote) => {
    if (!note.content.trim()) return;

    setAnalyzingNoteId(note.id);

    try {
      const response = await fetch('/api/studies/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: note.content,
          existingTags: tagOptions,
        }),
      });

      const result = await response.json();

      if (!result.success || !result.data) {
        console.error('Analysis failed:', result.error);
        return;
      }

      const { title, scriptureRefs, tags } = result.data;

      // Update note with AI results
      const updates: Partial<StudyNote> = {};

      if (!note.title && title) {
        updates.title = title;
      }

      if (scriptureRefs?.length > 0) {
        const newRefs = scriptureRefs
          .filter((newRef: { book: string; chapter: number; fromVerse: number; toVerse?: number }) =>
            !note.scriptureRefs.some(
              (existing) =>
                existing.book === newRef.book &&
                existing.chapter === newRef.chapter &&
                existing.fromVerse === newRef.fromVerse &&
                existing.toVerse === newRef.toVerse
            )
          )
          .map((ref: { book: string; chapter: number; fromVerse: number; toVerse?: number }) => ({
            ...ref,
            id: crypto.randomUUID(),
          }));

        if (newRefs.length > 0) {
          updates.scriptureRefs = [...note.scriptureRefs, ...newRefs];
        }
      }

      if (tags?.length > 0) {
        const newTags = tags.filter((t: string) => !note.tags.includes(t));
        if (newTags.length > 0) {
          updates.tags = [...note.tags, ...newTags];
        }
      }

      if (Object.keys(updates).length > 0) {
        await updateNote({ id: note.id, updates });
      }
    } catch (error) {
      console.error('AI analysis error:', error);
    } finally {
      setAnalyzingNoteId(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setTagFilter('');
    setBookFilter('');
  };

  const hasActiveFilters = search || tagFilter || bookFilter;

  return (
    <section className="space-y-6">
      {/* Header */}
      <header className="space-y-3">
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
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 md:w-auto"
          >
            <PlusIcon className="h-5 w-5" />
            {t('studiesWorkspace.newNote')}
          </button>
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

      {/* Search and Filters */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('studiesWorkspace.searchPlaceholder')}
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>

          {/* Filter toggles */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={bookFilter}
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
              value={tagFilter}
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

      {/* Results header with expand/collapse */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {hasActiveFilters ? (
            <span>
              {t('studiesWorkspace.matchingNotes')}: <strong>{filteredNotes.length}</strong>
            </span>
          ) : (
            <span>
              {t('studiesWorkspace.allNotes')}: <strong>{filteredNotes.length}</strong>
            </span>
          )}
        </div>

        {filteredNotes.length > 0 && (
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
      ) : filteredNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 py-12 dark:border-gray-700 dark:bg-gray-900">
          <ClipboardDocumentListIcon className="h-12 w-12 text-gray-400 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            {hasActiveFilters
              ? t('studiesWorkspace.noMatchingNotes') || 'No notes match your filters'
              : t('studiesWorkspace.noNotes')}
          </p>
          {!hasActiveFilters && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('studiesWorkspace.createFirstNote') || 'Create your first note'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map((note) => (
            <StudyNoteCard
              key={note.id}
              note={note}
              bibleLocale={bibleLocale}
              isExpanded={expandedNoteIds.has(note.id)}
              onToggleExpand={() => toggleNoteExpand(note.id)}
              onEdit={(note) => setEditingNote(note)}
              onDelete={(noteId) => deleteNote(noteId)}
              onAnalyze={handleAnalyzeNote}
              isAnalyzing={analyzingNoteId === note.id}
            />
          ))}
        </div>
      )}

      {/* Add Modal */}
      <AddStudyNoteModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddNote}
        availableTags={tagOptions}
        bibleLocale={bibleLocale}
      />

      {/* Edit Drawer */}
      <StudyNoteDrawer
        note={editingNote}
        isOpen={editingNote !== null}
        onClose={() => setEditingNote(null)}
        onSave={handleUpdateNote}
        availableTags={tagOptions}
        bibleLocale={bibleLocale}
      />
    </section>
  );
}
