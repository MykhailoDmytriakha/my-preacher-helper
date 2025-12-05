'use client';

import { useEffect, useMemo, useState, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import {
  BookmarkIcon,
  BookOpenIcon,
  ClipboardDocumentListIcon,
  FunnelIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Squares2X2Icon,
  TagIcon,
  TrashIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { StudyNote, ScriptureReference } from '@/models/models';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { getTags } from '@/services/tag.service';
import { STUDIES_INPUT_SHARED_CLASSES } from './constants';
import { parseReferenceText } from './referenceParser';
import ScriptureRefBadge from './ScriptureRefBadge';
import ScriptureRefPicker from './ScriptureRefPicker';
import TagCatalogModal from './TagCatalogModal';
import { getBooksForDropdown, getLocalizedBookName, BibleLocale, psalmHebrewToSeptuagint } from './bibleData';

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type NoteFormValues = {
  title: string;
  content: string;
  tags: string[];
  scriptureRefs: ScriptureReference[];
};

const emptyForm: NoteFormValues = {
  title: '',
  content: '',
  tags: [],
  scriptureRefs: [],
};

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

  // Get current locale for Bible data (map i18n language to BibleLocale)
  const bibleLocale: BibleLocale = useMemo(() => {
    const lang = i18n.language?.toLowerCase() || 'en';
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('uk')) return 'uk';
    return 'en';
  }, [i18n.language]);

  // Get localized book list for dropdowns
  const bookList = useMemo(() => getBooksForDropdown(bibleLocale), [bibleLocale]);

  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [formState, setFormState] = useState<NoteFormValues>(emptyForm);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [noScriptureOnly, setNoScriptureOnly] = useState(false);
  const [quickRefInput, setQuickRefInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [quickRefError, setQuickRefError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Scripture reference editing state
  const [editingRefIndex, setEditingRefIndex] = useState<number | null>(null);
  const [showRefPicker, setShowRefPicker] = useState(false);
  // Tag catalog modal state
  const [showTagCatalog, setShowTagCatalog] = useState(false);
  // AI analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Load user tags for tag selector
  useEffect(() => {
    if (!uid) return;
    getTags(uid)
      .then((tags) => {
        // Defensive: ensure tags is an array before mapping
        if (Array.isArray(tags)) {
          setAvailableTags(tags.map((t: { name: string }) => t.name));
        } else {
          console.warn('getTags returned non-array:', tags);
          setAvailableTags([]);
        }
      })
      .catch((err) => console.error('Failed to load tags for studies', err));
  }, [uid]);

  const tagOptions = useMemo(() => {
    const fromNotes = new Set<string>();
    notes.forEach((n) => n.tags.forEach((tag) => fromNotes.add(tag)));
    return Array.from(new Set([...(availableTags || []), ...Array.from(fromNotes)])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [availableTags, notes]);

  const filteredNotes = useMemo(() => {
    const query = search.toLowerCase().trim();
    return notes
      .filter((note) => (untaggedOnly ? note.tags.length === 0 : true))
      .filter((note) => (noScriptureOnly ? note.scriptureRefs.length === 0 : true))
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

  const stats = useMemo(() => {
    const booksCount = notes.reduce<Record<string, number>>((acc, note) => {
      note.scriptureRefs.forEach((ref) => {
        acc[ref.book] = (acc[ref.book] || 0) + 1;
      });
      return acc;
    }, {});
    return { total: notes.length, booksCount };
  }, [notes]);

  const resetForm = () => {
    setFormState({ ...emptyForm, scriptureRefs: emptyForm.scriptureRefs.map((r) => ({ ...r, id: makeId() })) });
    setEditingNoteId(null);
    setTagInput('');
  };

  const handleFormSubmit = async () => {
    if (!uid) return;
    const payload = {
      ...formState,
      userId: uid,
    };

    if (editingNoteId) {
      await updateNote({ id: editingNoteId, updates: payload });
    } else {
      await createNote(payload as any);
    }
    resetForm();
  };

  const addTag = () => {
    const value = tagInput.trim();
    if (!value) return;
    setFormState((s) => ({ ...s, tags: Array.from(new Set([...s.tags, value])) }));
    setTagInput('');
  };

  // Toggle tag selection (for TagCatalogModal)
  const toggleTag = (tag: string) => {
    setFormState((s) => {
      const isSelected = s.tags.includes(tag);
      return {
        ...s,
        tags: isSelected ? s.tags.filter((t) => t !== tag) : [...s.tags, tag],
      };
    });
  };

  const handleEditNote = (note: StudyNote) => {
    setEditingNoteId(note.id);
    setFormState({
      title: note.title || '',
      content: note.content,
      tags: note.tags,
      scriptureRefs: note.scriptureRefs.length
        ? note.scriptureRefs
        : [{ id: makeId(), book: 'Genesis', chapter: 1, fromVerse: 1 }],
    });
    setTagInput('');
  };

  /**
   * Analyze note content with AI to extract title, scripture refs, and tags.
   * Results are merged into the form state for user review before saving.
   */
  const handleAIAnalyze = async () => {
    if (!formState.content.trim()) {
      setAnalyzeError(t('studiesWorkspace.aiAnalyze.emptyContent') || 'Please enter note content first');
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const response = await fetch('/api/studies/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: formState.content,
          existingTags: tagOptions,
        }),
      });

      const result = await response.json();

      if (!result.success || !result.data) {
        setAnalyzeError(result.error || t('studiesWorkspace.aiAnalyze.error') || 'Analysis failed');
        return;
      }

      const { title, scriptureRefs, tags } = result.data;

      // Update form state with AI results
      setFormState((prev) => ({
        ...prev,
        // Only set title if it's currently empty
        title: prev.title.trim() ? prev.title : title,
        // Add scripture refs with IDs (avoid duplicates by book+chapter+verse)
        scriptureRefs: [
          ...prev.scriptureRefs,
          ...scriptureRefs
            .filter((newRef: { book: string; chapter: number; fromVerse: number; toVerse?: number }) => 
              !prev.scriptureRefs.some(
                (existing) =>
                  existing.book === newRef.book &&
                  existing.chapter === newRef.chapter &&
                  existing.fromVerse === newRef.fromVerse &&
                  existing.toVerse === newRef.toVerse
              )
            )
            .map((ref: { book: string; chapter: number; fromVerse: number; toVerse?: number }) => ({
              ...ref,
              id: makeId(),
            })),
        ],
        // Merge tags (avoid duplicates)
        tags: Array.from(new Set([...prev.tags, ...tags])),
      }));

      console.log('AI analysis applied:', { title, scriptureRefs: scriptureRefs.length, tags: tags.length });
    } catch (error) {
      console.error('AI analysis error:', error);
      setAnalyzeError(t('studiesWorkspace.aiAnalyze.error') || 'Failed to analyze note');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const booksLeaderboard = useMemo(
    () =>
      Object.entries(stats.booksCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
    [stats.booksCount]
  );

  return (
    <section className="space-y-8">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-100 dark:ring-emerald-800/60">
          <SparklesIcon className="h-4 w-4" />
          {t('workspaces.studies.badge')}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">
              {t('workspaces.studies.title')}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
              {t('workspaces.studies.description')}
            </p>
          </div>
      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
        <ClipboardDocumentListIcon className="h-5 w-5" />
        <span>
          {stats.total} {t('studiesWorkspace.stats.notesLabel')}
        </span>
      </div>
        </div>
      </header>

      <div
        className={`grid gap-6 items-stretch ${
          showForm ? 'lg:grid-cols-[1.6fr_1fr]' : 'lg:grid-cols-[1fr_auto]'
        }`}
      >
        <div className="space-y-6 h-full">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-gray-800 dark:text-gray-100"
            >
              <span className="inline-flex items-center gap-2">
                <FunnelIcon className="h-4 w-4" />
                {t('common.filters')}
              </span>
              <ChevronDownIcon
                className={`h-5 w-5 transition-transform ${filtersOpen ? 'rotate-180' : 'rotate-0'}`}
              />
            </button>
            {filtersOpen && (
              <div className="border-t border-gray-200 px-4 py-3 space-y-3 dark:border-gray-700">
                <div className="relative">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-2.5 h-5 w-5 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('studiesWorkspace.searchPlaceholder')}
                    className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </div>
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">{t('studiesWorkspace.filterByTag')}</option>
                  {tagOptions.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <select
                  value={bookFilter}
                  onChange={(e) => setBookFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">{t('studiesWorkspace.filterByBook')}</option>
                  {bookList.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.name}
                    </option>
                  ))}
                </select>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={untaggedOnly}
                  onChange={(e) => setUntaggedOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  {t('studiesWorkspace.filterUntagged')}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={noScriptureOnly}
                    onChange={(e) => setNoScriptureOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  {t('studiesWorkspace.filterNoScripture')}
                </label>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-100">
              <div className="flex items-center gap-2">
                <BookOpenIcon className="h-4 w-4" />
                {t('studiesWorkspace.topBooks')}
              </div>
              <span className="text-xs text-gray-500">
                {Object.keys(stats.booksCount).length} {t('studiesWorkspace.stats.booksLabel')}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {booksLeaderboard.length === 0 && (
                <p className="text-sm text-gray-500">{t('studiesWorkspace.noBookData')}</p>
              )}
              {booksLeaderboard.map(([bookId, count]) => (
                <div key={bookId} className="flex items-center justify-between text-sm text-gray-800 dark:text-gray-200">
                  <span>{getLocalizedBookName(bookId, bibleLocale)}</span>
                  <span className="text-gray-500">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes list */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
                {t('studiesWorkspace.notesList')}
              </h3>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {filteredNotes.length} {t('studiesWorkspace.matchingNotes')}
              </div>
            </div>

            {notesError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                {notesError.message}
              </div>
            )}

            {notesLoading ? (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">{t('common.loading')}</div>
            ) : filteredNotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                {t('studiesWorkspace.noNotes')}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredNotes.map((note) => (
                  <article
                    key={note.id}
                    className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-gray-500 dark:text-gray-400">
                            {new Date(note.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <h4 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                          {note.title || t('studiesWorkspace.untitled')}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditNote(note)}
                          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                          title={t('common.edit') || 'Edit'}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(t('studiesWorkspace.deleteConfirm'))) {
                              deleteNote(note.id);
                            }
                          }}
                          className="rounded-md p-1 text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                          title={t('common.delete') || 'Delete'}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <p className="mt-2 line-clamp-5 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line">
                      {note.content}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {note.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100"
                        >
                          {tag}
                        </span>
                      ))}
                      {note.tags.length === 0 && (
                        <span className="text-xs text-gray-400">{t('studiesWorkspace.noTags')}</span>
                      )}
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                      {note.scriptureRefs.length === 0 && <span>{t('studiesWorkspace.noRefs')}</span>}
                      {note.scriptureRefs.map((ref) => {
                        // Convert Psalm chapter from Hebrew (storage) to locale numbering for display
                        const displayChapter = ref.book === 'Psalms' && (bibleLocale === 'ru' || bibleLocale === 'uk')
                          ? psalmHebrewToSeptuagint(ref.chapter)
                          : ref.chapter;
                        return (
                          <div key={ref.id} className="flex items-center gap-2">
                            <BookmarkIcon className="h-4 w-4 text-emerald-600" />
                            <span>
                              {getLocalizedBookName(ref.book, bibleLocale)} {displayChapter}:{ref.fromVerse}
                              {ref.toVerse ? `-${ref.toVerse}` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-auto flex items-center justify-end pt-4 text-xs text-gray-600 dark:text-gray-300">
                      <span>
                        {t('studiesWorkspace.stats.refsCount', { count: note.scriptureRefs.length })}
                        {t('studiesWorkspace.stats.refsSeparator')}
                        {t('studiesWorkspace.stats.tagsCount', { count: note.tags.length })}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 flex flex-col h-full">
          {showForm ? (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 flex flex-col h-full">
              <button
                onClick={() => setShowForm(false)}
                className="flex w-full items-center justify-between gap-2 px-5 py-3 text-sm font-semibold text-gray-900 dark:text-gray-50"
              >
                <span className="inline-flex items-center gap-2">
                  <BookOpenIcon className="h-5 w-5 text-emerald-600" />
                  {editingNoteId ? t('studiesWorkspace.editNote') : t('studiesWorkspace.newNote')}
                </span>
                <ChevronRightIcon className="h-5 w-5 transform rotate-0" />
              </button>

              <div className="border-t border-gray-200 p-5 space-y-3 dark:border-gray-700">
                <input
                  value={formState.title}
                  onChange={(e) => setFormState((s) => ({ ...s, title: e.target.value }))}
                  placeholder={t('studiesWorkspace.titlePlaceholder')}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />

                <textarea
                  value={formState.content}
                  onChange={(e) => setFormState((s) => ({ ...s, content: e.target.value }))}
                  placeholder={t('studiesWorkspace.contentPlaceholder')}
                  rows={5}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />

                {/* AI Analyze Button */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAIAnalyze}
                    disabled={isAnalyzing || !formState.content.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAnalyzing ? (
                      <>
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                        {t('studiesWorkspace.aiAnalyze.analyzing') || 'Analyzing...'}
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="h-4 w-4" />
                        {t('studiesWorkspace.aiAnalyze.button') || 'AI Analyze'}
                      </>
                    )}
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('studiesWorkspace.aiAnalyze.hint') || 'Extract title, references & tags'}
                  </span>
                </div>
                {analyzeError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{analyzeError}</p>
                )}

                {/* Scripture refs - compact badge-based UI */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    <BookmarkIcon className="h-4 w-4" />
                    {t('studiesWorkspace.scriptureRefs')}
                  </div>

                  {/* Display added references as compact badges */}
                  {formState.scriptureRefs.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formState.scriptureRefs.map((ref, idx) => (
                        <ScriptureRefBadge
                          key={ref.id}
                          reference={ref}
                          isEditing={editingRefIndex === idx}
                          onClick={() => {
                            setEditingRefIndex(idx);
                            setShowRefPicker(false);
                          }}
                          onRemove={() =>
                            setFormState((s) => ({
                              ...s,
                              scriptureRefs: s.scriptureRefs.filter((_, i) => i !== idx),
                            }))
                          }
                        />
                      ))}
                    </div>
                  )}

                  {/* Quick input and Add button */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                      <input
                        value={quickRefInput}
                        onChange={(e) => {
                          setQuickRefInput(e.target.value);
                          setQuickRefError(null);
                        }}
                        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            // Pass locale for proper Psalm number conversion
                            const parsed = parseReferenceText(quickRefInput.trim(), bibleLocale);
                            if (!parsed) {
                              setQuickRefError(t('studiesWorkspace.quickRefError') || 'Cannot parse reference');
                              return;
                            }
                            setFormState((s) => ({
                              ...s,
                              scriptureRefs: [...s.scriptureRefs, { ...parsed, id: makeId() }],
                            }));
                            setQuickRefInput('');
                            setEditingRefIndex(null);
                          }
                        }}
                        placeholder={t('studiesWorkspace.quickRefPlaceholder')}
                        className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
                      />
                      {quickRefError && <p className="mt-1 text-xs text-red-600">{quickRefError}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowRefPicker(true);
                        setEditingRefIndex(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
                    >
                      <BookOpenIcon className="h-4 w-4" />
                      {t('studiesWorkspace.browseBooks')}
                    </button>
                  </div>

                  {/* Picker for adding new reference - positioned below input row */}
                  {showRefPicker && (
                    <div className="relative">
                      <ScriptureRefPicker
                        mode="add"
                        onConfirm={(ref) => {
                          setFormState((s) => ({
                            ...s,
                            scriptureRefs: [...s.scriptureRefs, { ...ref, id: makeId() }],
                          }));
                          setShowRefPicker(false);
                        }}
                        onCancel={() => setShowRefPicker(false)}
                      />
                    </div>
                  )}

                  {/* Picker for editing existing reference */}
                  {editingRefIndex !== null && (
                    <div className="relative">
                      <ScriptureRefPicker
                        mode="edit"
                        initialRef={formState.scriptureRefs[editingRefIndex]}
                        onConfirm={(ref) => {
                          setFormState((s) => {
                            const refs = [...s.scriptureRefs];
                            refs[editingRefIndex] = { ...ref, id: refs[editingRefIndex].id };
                            return { ...s, scriptureRefs: refs };
                          });
                          setEditingRefIndex(null);
                        }}
                        onCancel={() => setEditingRefIndex(null)}
                      />
                    </div>
                  )}
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    <TagIcon className="h-4 w-4" />
                    {t('studiesWorkspace.tags')}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag();
                          }
                        }}
                        placeholder={t('studiesWorkspace.addTag')}
                        className={`w-full min-w-[200px] ${STUDIES_INPUT_SHARED_CLASSES}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addTag}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {t('studiesWorkspace.addTag')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTagCatalog(true)}
                      className="inline-flex items-center justify-center rounded-md border border-emerald-200 p-2 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
                      title={t('studiesWorkspace.tagCatalog.button')}
                      aria-label={t('studiesWorkspace.tagCatalog.button')}
                    >
                      <MagnifyingGlassIcon className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {formState.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                      >
                        {tag}
                        <button
                          type="button"
                          className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-200"
                          onClick={() =>
                            setFormState((s) => ({
                              ...s,
                              tags: s.tags.filter((t) => t !== tag),
                            }))
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={handleFormSubmit}
                    disabled={!uid || !formState.content.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <PlusIcon className="h-5 w-5" />
                    {editingNoteId ? t('studiesWorkspace.updateNote') : t('studiesWorkspace.saveNote')}
                  </button>
                  {editingNoteId && (
                    <button
                      onClick={resetForm}
                      className="text-sm font-medium text-gray-600 underline-offset-2 hover:underline dark:text-gray-300"
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                  {!uid && (
                    <span className="text-sm text-red-600">{t('studiesWorkspace.authHint')}</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex justify-end h-full">
              <button
                onClick={() => setShowForm(true)}
                className="flex h-full w-12 flex-col items-center justify-start gap-3 rounded-2xl border border-gray-200 bg-white px-2 py-4 text-sm font-semibold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <ChevronRightIcon className="h-5 w-5 transform rotate-180" />
                <BookOpenIcon className="h-5 w-5 text-emerald-600" />
                <span className="leading-tight" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  {t('studiesWorkspace.newNote')}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tag Catalog Modal */}
      <TagCatalogModal
        isOpen={showTagCatalog}
        onClose={() => setShowTagCatalog(false)}
        availableTags={tagOptions}
        selectedTags={formState.tags}
        onToggleTag={toggleTag}
      />
    </section>
  );
}
