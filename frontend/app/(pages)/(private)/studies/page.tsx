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
  TagIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { StudyNote, ScriptureReference } from '@/models/models';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { getTags } from '@/services/tag.service';
import { BIBLE_BOOKS } from '@/constants/bible';

type BookMatch = { book: string; remaining: string[] };

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const BOOK_ALIASES: Record<string, string> = {
  gen: 'Genesis',
  genesis: 'Genesis',
  ge: 'Genesis',
  исх: 'Exodus',
  ex: 'Exodus',
  exo: 'Exodus',
  lev: 'Leviticus',
  leviticus: 'Leviticus',
  чис: 'Numbers',
  num: 'Numbers',
  numbers: 'Numbers',
  deut: 'Deuteronomy',
  вт: 'Deuteronomy',
  deutero: 'Deuteronomy',
  пров: 'Proverbs',
  prov: 'Proverbs',
  proverb: 'Proverbs',
  пс: 'Psalms',
  psa: 'Psalms',
  ps: 'Psalms',
  псал: 'Psalms',
  isa: 'Isaiah',
  ис: 'Isaiah',
  jer: 'Jeremiah',
  jeremiah: 'Jeremiah',
  rev: 'Revelation',
  откр: 'Revelation',
  отк: 'Revelation',
};

function resolveBook(input: string): BookMatch | null {
  const normalized = input.toLowerCase();
  const direct = BOOK_ALIASES[normalized];
  if (direct) return { book: direct, remaining: [] };

  const found = BIBLE_BOOKS.find((book) => book.toLowerCase().startsWith(normalized));
  if (found) return { book: found, remaining: [] };

  return null;
}

function parseReferenceText(raw: string): ScriptureReference | null {
  const tokens = raw
    .replace(/[:,.;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 3) return null;
  const maybeBookParts: string[] = [];
  // Try longest prefix for book name
  for (let i = 1; i <= Math.min(2, tokens.length - 2); i++) {
    maybeBookParts.push(tokens.slice(0, i).join(' '));
  }

  let matched: BookMatch | null = null;
  let consumed = 0;
  for (let i = maybeBookParts.length - 1; i >= 0; i--) {
    const candidate = maybeBookParts[i];
    const res = resolveBook(candidate);
    if (res) {
      matched = res;
      consumed = i + 1;
      break;
    }
  }
  if (!matched) return null;

  const numbers = tokens.slice(consumed).map((t) => Number(t));
  if (numbers.some((n) => Number.isNaN(n) || n <= 0)) return null;
  const [chapter, fromVerse, maybeTo] = numbers;
  if (!chapter || !fromVerse) return null;

  const ref: ScriptureReference = {
    id: makeId(),
    book: matched.book,
    chapter,
    fromVerse,
  };
  if (maybeTo && maybeTo >= fromVerse) {
    ref.toVerse = maybeTo;
  }
  return ref;
}

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
  const { t } = useTranslation();
  const {
    uid,
    notes,
    loading: notesLoading,
    error: notesError,
    createNote,
    updateNote,
    deleteNote,
  } = useStudyNotes();

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

  // Load user tags for tag selector
  useEffect(() => {
    if (!uid) return;
    getTags(uid)
      .then((tags) => setAvailableTags(tags.map((t: { name: string }) => t.name)))
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
                  {BIBLE_BOOKS.map((book) => (
                    <option key={book} value={book}>
                      {book}
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
              {booksLeaderboard.map(([book, count]) => (
                <div key={book} className="flex items-center justify-between text-sm text-gray-800 dark:text-gray-200">
                  <span>{book}</span>
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
                      {note.scriptureRefs.map((ref) => (
                        <div key={ref.id} className="flex items-center gap-2">
                          <BookmarkIcon className="h-4 w-4 text-emerald-600" />
                          <span>
                            {ref.book} {ref.chapter}:{ref.fromVerse}
                            {ref.toVerse ? `-${ref.toVerse}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-auto flex items-center justify-end pt-4 text-xs text-gray-600 dark:text-gray-300">
                      <span>
                        {note.scriptureRefs.length} refs · {note.tags.length} tags
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

                {/* Scripture refs */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    <BookmarkIcon className="h-4 w-4" />
                    {t('studiesWorkspace.scriptureRefs')}
                  </div>

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
                            const parsed = parseReferenceText(quickRefInput.trim());
                            if (!parsed) {
                              setQuickRefError(t('studiesWorkspace.quickRefError') || 'Cannot parse reference');
                              return;
                            }
                            setFormState((s) => ({ ...s, scriptureRefs: [...s.scriptureRefs, parsed] }));
                            setQuickRefInput('');
                          }
                        }}
                        placeholder={t('studiesWorkspace.quickRefPlaceholder')}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                      />
                      {quickRefError && <p className="mt-1 text-xs text-red-600">{quickRefError}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFormState((s) => ({
                          ...s,
                          scriptureRefs: [
                            ...s.scriptureRefs,
                            { id: makeId(), book: 'Genesis', chapter: 1, fromVerse: 1 },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {t('studiesWorkspace.addReference')}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {formState.scriptureRefs.map((ref, idx) => (
                      <div key={ref.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <select
                          value={ref.book}
                          onChange={(e) => {
                            const value = e.target.value;
                            setFormState((s) => {
                              const refs = [...s.scriptureRefs];
                              refs[idx] = { ...refs[idx], book: value };
                              return { ...s, scriptureRefs: refs };
                            });
                          }}
                          className="min-w-[140px] flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                          {BIBLE_BOOKS.map((book) => (
                            <option key={book} value={book}>
                              {book}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={ref.chapter}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            setFormState((s) => {
                              const refs = [...s.scriptureRefs];
                              refs[idx] = { ...refs[idx], chapter: value };
                              return { ...s, scriptureRefs: refs };
                            });
                          }}
                          className="w-24 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          placeholder={t('studiesWorkspace.chapter') || 'Chapter'}
                        />
                        <input
                          type="number"
                          min={1}
                          value={ref.fromVerse}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            setFormState((s) => {
                              const refs = [...s.scriptureRefs];
                              refs[idx] = { ...refs[idx], fromVerse: value };
                              return { ...s, scriptureRefs: refs };
                            });
                          }}
                          className="w-24 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          placeholder={t('studiesWorkspace.from') || 'From'}
                        />
                        <input
                          type="number"
                          min={ref.fromVerse}
                          value={ref.toVerse ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormState((s) => {
                              const refs = [...s.scriptureRefs];
                              refs[idx] = { ...refs[idx], toVerse: val ? Number(val) : undefined };
                              return { ...s, scriptureRefs: refs };
                            });
                          }}
                          className="w-24 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          placeholder={t('studiesWorkspace.to') || 'To'}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFormState((s) => ({
                              ...s,
                              scriptureRefs: s.scriptureRefs.filter((_, i) => i !== idx),
                            }))
                          }
                          className="ml-auto text-sm text-red-600 hover:text-red-700"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    ))}
                  </div>
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
                        list="tag-suggestions"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag();
                          }
                        }}
                        placeholder={t('studiesWorkspace.addTag')}
                        className="w-full min-w-[200px] rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                      />
                      <datalist id="tag-suggestions">
                        {tagOptions.map((tag) => (
                          <option key={tag} value={tag} />
                        ))}
                      </datalist>
                    </div>
                    <button
                      type="button"
                      onClick={addTag}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {t('studiesWorkspace.addTag')}
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

    </section>
  );
}
