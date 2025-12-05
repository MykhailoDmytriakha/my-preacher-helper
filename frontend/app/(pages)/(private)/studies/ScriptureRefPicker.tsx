'use client';

import { useState, useRef, useEffect, KeyboardEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ScriptureReference } from '@/models/models';
import { STUDIES_INPUT_SHARED_CLASSES } from './constants';
import {
  getBooksForDropdown,
  getChapterCount,
  getVerseCount,
  BibleLocale,
  psalmHebrewToSeptuagint,
  psalmSeptuagintToHebrew,
} from './bibleData';

/**
 * Reference scope determines the level of specificity.
 */
type ReferenceScope = 'book' | 'chapter' | 'chapter-range' | 'verses';

interface ScriptureRefPickerProps {
  /** Initial reference to edit, or undefined for new entry */
  initialRef?: ScriptureReference;
  /** Called when user confirms the reference */
  onConfirm: (ref: Omit<ScriptureReference, 'id'>) => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Mode: 'add' for new reference, 'edit' for editing existing */
  mode?: 'add' | 'edit';
}

/**
 * Detect scope from an existing reference.
 */
function detectScope(ref?: ScriptureReference): ReferenceScope {
  if (!ref) return 'verses'; // Default for new refs
  if (ref.chapter === undefined) return 'book';
  if (ref.toChapter !== undefined) return 'chapter-range';
  if (ref.fromVerse === undefined) return 'chapter';
  return 'verses';
}

/**
 * Modal/popover picker for selecting a Scripture reference manually.
 * Allows selecting book, chapter, and verse range with flexible scope.
 * Shows localized book names based on current language.
 */
export default function ScriptureRefPicker({
  initialRef,
  onConfirm,
  onCancel,
  mode = 'add',
}: ScriptureRefPickerProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Get current locale for Bible data (map i18n language to BibleLocale)
  const bibleLocale: BibleLocale = useMemo(() => {
    const lang = i18n.language?.toLowerCase() || 'en';
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('uk')) return 'uk';
    return 'en';
  }, [i18n.language]);

  // Get localized book list for dropdown
  const bookList = useMemo(() => getBooksForDropdown(bibleLocale), [bibleLocale]);

  // Reference scope state
  const [scope, setScope] = useState<ReferenceScope>(() => detectScope(initialRef));

  // Convert initial chapter from Hebrew (storage) to locale numbering for display
  const getInitialChapter = () => {
    if (!initialRef?.chapter) return 1;
    if (initialRef.book === 'Psalms' && (bibleLocale === 'ru' || bibleLocale === 'uk')) {
      return psalmHebrewToSeptuagint(initialRef.chapter);
    }
    return initialRef.chapter;
  };

  const getInitialToChapter = () => {
    if (!initialRef?.toChapter) return 1;
    if (initialRef.book === 'Psalms' && (bibleLocale === 'ru' || bibleLocale === 'uk')) {
      return psalmHebrewToSeptuagint(initialRef.toChapter);
    }
    return initialRef.toChapter;
  };

  const [book, setBook] = useState(initialRef?.book || 'Genesis');
  const [chapter, setChapter] = useState(getInitialChapter());
  const [toChapter, setToChapter] = useState(getInitialToChapter());
  const [fromVerse, setFromVerse] = useState(initialRef?.fromVerse || 1);
  const [toVerse, setToVerse] = useState<number | ''>(initialRef?.toVerse || '');

  // Get max chapters for current book
  const maxChapters = useMemo(() => getChapterCount(book), [book]);

  // Generate chapter options
  const chapterOptions = useMemo(() => {
    return Array.from({ length: maxChapters }, (_, i) => i + 1);
  }, [maxChapters]);

  // Get max verses for current book and chapter (dynamic based on selection)
  const maxVerses = useMemo(() => getVerseCount(book, chapter), [book, chapter]);

  // Generate verse options (1 to maxVerses for current chapter)
  const verseOptions = useMemo(() => {
    return Array.from({ length: maxVerses }, (_, i) => i + 1);
  }, [maxVerses]);

  // Reset chapter if it exceeds max when book changes
  useEffect(() => {
    if (chapter > maxChapters) {
      setChapter(1);
    }
    if (toChapter > maxChapters) {
      setToChapter(1);
    }
  }, [book, maxChapters, chapter, toChapter]);

  // Reset fromVerse and toVerse if they exceed max verses when book/chapter changes
  useEffect(() => {
    if (fromVerse > maxVerses) {
      setFromVerse(1);
      setToVerse('');
    } else if (toVerse !== '' && toVerse > maxVerses) {
      setToVerse('');
    }
  }, [book, chapter, maxVerses, fromVerse, toVerse]);

  // Ensure toChapter >= chapter for chapter ranges
  useEffect(() => {
    if (scope === 'chapter-range' && toChapter < chapter) {
      setToChapter(chapter);
    }
  }, [scope, chapter, toChapter]);

  // Focus first input on mount
  useEffect(() => {
    const firstInput = containerRef.current?.querySelector('select');
    firstInput?.focus();
  }, []);

  // Handle click outside to cancel
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancel]);

  // Handle Escape key
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleConfirm = () => {
    // Convert chapters from locale numbering to Hebrew (storage) for Psalms
    const convertChapter = (ch: number) => {
      if (book === 'Psalms' && (bibleLocale === 'ru' || bibleLocale === 'uk')) {
        return psalmSeptuagintToHebrew(ch);
      }
      return ch;
    };

    const ref: Omit<ScriptureReference, 'id'> = { book };

    if (scope === 'book') {
      // Book-only reference
      // ref stays as { book }
    } else if (scope === 'chapter') {
      // Single chapter reference
      ref.chapter = convertChapter(chapter);
    } else if (scope === 'chapter-range') {
      // Chapter range
      ref.chapter = convertChapter(chapter);
      if (toChapter > chapter) {
        ref.toChapter = convertChapter(toChapter);
      }
    } else {
      // Verse or verse range
      ref.chapter = convertChapter(chapter);
      ref.fromVerse = fromVerse;
      if (toVerse && toVerse >= fromVerse) {
        ref.toVerse = toVerse;
      }
    }

    onConfirm(ref);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  // Validation based on scope
  const isValid = useMemo(() => {
    if (!book) return false;
    if (scope === 'book') return true;
    if (scope === 'chapter') return chapter > 0 && chapter <= maxChapters;
    if (scope === 'chapter-range') {
      return chapter > 0 && chapter <= maxChapters && toChapter >= chapter && toChapter <= maxChapters;
    }
    // verses scope
    return chapter > 0 && chapter <= maxChapters && fromVerse > 0 && fromVerse <= maxVerses;
  }, [book, scope, chapter, toChapter, maxChapters, fromVerse, maxVerses]);

  // Scope labels for UI
  const scopeLabels: Record<ReferenceScope, string> = {
    book: t('studiesWorkspace.scopeBook') || 'Entire Book',
    chapter: t('studiesWorkspace.scopeChapter') || 'Chapter',
    'chapter-range': t('studiesWorkspace.scopeChapterRange') || 'Chapter Range',
    verses: t('studiesWorkspace.scopeVerses') || 'Verse(s)',
  };

  return (
    <div
      ref={containerRef}
      className="mt-2 z-50 w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'edit' ? t('studiesWorkspace.editReference') : t('studiesWorkspace.addReference')}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {mode === 'edit' ? t('studiesWorkspace.editReference') : t('studiesWorkspace.addReference')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
          aria-label={t('common.cancel')}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Form */}
      <div className="space-y-3">
        {/* Scope selector */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('studiesWorkspace.referenceScope') || 'Reference Type'}
          </label>
          <div className="flex flex-wrap gap-1">
            {(['book', 'chapter', 'chapter-range', 'verses'] as ReferenceScope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${scope === s
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
              >
                {scopeLabels[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Book selector */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('studiesWorkspace.book')}
          </label>
          <select
            value={book}
            onChange={(e) => setBook(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
          >
            {bookList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Chapter selector - shown for chapter, chapter-range, and verses scopes */}
        {scope !== 'book' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {scope === 'chapter-range'
                  ? (t('studiesWorkspace.fromChapter') || 'From Chapter')
                  : t('studiesWorkspace.chapter')
                }
              </label>
              <select
                value={chapter}
                onChange={(e) => setChapter(Number(e.target.value))}
                onKeyDown={handleKeyDown}
                className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
              >
                {chapterOptions.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            </div>

            {/* To chapter - only for chapter-range scope */}
            {scope === 'chapter-range' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t('studiesWorkspace.toChapter') || 'To Chapter'}
                </label>
                <select
                  value={toChapter}
                  onChange={(e) => setToChapter(Number(e.target.value))}
                  onKeyDown={handleKeyDown}
                  className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
                >
                  {chapterOptions.filter((ch) => ch >= chapter).map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Verse selectors - only for verses scope */}
        {scope === 'verses' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('studiesWorkspace.from')}
              </label>
              <select
                value={fromVerse}
                onChange={(e) => setFromVerse(Number(e.target.value))}
                onKeyDown={handleKeyDown}
                className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
              >
                {verseOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('studiesWorkspace.to')}
              </label>
              <select
                value={toVerse === '' ? '' : toVerse}
                onChange={(e) => setToVerse(e.target.value === '' ? '' : Number(e.target.value))}
                onKeyDown={handleKeyDown}
                className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
              >
                <option value="">—</option>
                {verseOptions.filter((v) => v >= fromVerse).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!isValid}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mode === 'edit' ? t('common.save') : t('studiesWorkspace.addReferenceShort')}
        </button>
      </div>
    </div>
  );
}
