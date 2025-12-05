'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { StudyNote } from '@/models/models';
import { getLocalizedBookName, BibleLocale, psalmHebrewToSeptuagint } from './bibleData';

interface StudyNoteCardProps {
  note: StudyNote;
  bibleLocale: BibleLocale;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: (note: StudyNote) => void;
  onDelete: (noteId: string) => void;
  onAnalyze?: (note: StudyNote) => void;
  isAnalyzing?: boolean;
}

export default function StudyNoteCard({
  note,
  bibleLocale,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onAnalyze,
  isAnalyzing = false,
}: StudyNoteCardProps) {
  const { t } = useTranslation();

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('common.today');
    if (diffDays === 1) return t('common.yesterday');
    if (diffDays < 7) return t('common.daysAgo', { count: diffDays });
    if (diffDays < 30) return t('common.weeksAgo', { count: Math.floor(diffDays / 7) });
    return date.toLocaleDateString();
  };

  // Check if note needs AI analysis (no title, no refs, no tags)
  const needsAnalysis = !note.title && note.scriptureRefs.length === 0 && note.tags.length === 0;

  // Get display chapter for Psalms (convert Hebrew to Septuagint for ru/uk)
  const getDisplayChapter = (book: string, chapter: number) => {
    if (book === 'Psalms' && (bibleLocale === 'ru' || bibleLocale === 'uk')) {
      return psalmHebrewToSeptuagint(chapter);
    }
    return chapter;
  };

  // Format scripture reference for display
  const formatRef = (ref: {
    book: string;
    chapter?: number;
    toChapter?: number;
    fromVerse?: number;
    toVerse?: number
  }) => {
    const bookName = getLocalizedBookName(ref.book, bibleLocale);

    // Book-only reference
    if (ref.chapter === undefined) {
      return bookName;
    }

    const chapter = getDisplayChapter(ref.book, ref.chapter);

    // Chapter range (e.g., Matthew 5-7)
    if (ref.toChapter !== undefined) {
      const toChapter = getDisplayChapter(ref.book, ref.toChapter);
      return `${bookName} ${chapter}-${toChapter}`;
    }

    // Chapter-only reference (e.g., Romans 8)
    if (ref.fromVerse === undefined) {
      return `${bookName} ${chapter}`;
    }

    // Verse or verse range
    const verses = ref.toVerse ? `${ref.fromVerse}-${ref.toVerse}` : `${ref.fromVerse}`;
    return `${bookName} ${chapter}:${verses}`;
  };

  return (
    <article
      className={`
        rounded-xl border bg-white shadow-sm transition-all duration-200
        dark:bg-gray-800
        ${isExpanded
          ? 'border-emerald-200 dark:border-emerald-700'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }
      `}
    >
      {/* Header - always visible, clickable to expand */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        {/* Chevron */}
        <div className="mt-0.5 flex-shrink-0 text-gray-400 dark:text-gray-500">
          {isExpanded ? (
            <ChevronDownIcon className="h-5 w-5" />
          ) : (
            <ChevronRightIcon className="h-5 w-5" />
          )}
        </div>

        {/* Content preview */}
        <div className="min-w-0 flex-1">
          {/* Title */}
          <h4 className="text-base font-semibold text-gray-900 dark:text-gray-50 truncate">
            {note.title || t('studiesWorkspace.untitled')}
          </h4>

          {/* Preview text (collapsed only) */}
          {!isExpanded && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
              {note.content}
            </p>
          )}

          {/* Meta info */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              <BookmarkIcon className="h-3.5 w-3.5" />
              {note.scriptureRefs.length}
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              🏷️ {note.tags.length}
            </span>
            <span>•</span>
            <span>{formatRelativeTime(note.updatedAt)}</span>
          </div>
        </div>

        {/* Analyze button for notes without metadata (collapsed only) */}
        {!isExpanded && needsAnalysis && onAnalyze && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAnalyze(note);
            }}
            disabled={isAnalyzing}
            className="flex-shrink-0 inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-purple-500 to-indigo-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
            title={t('studiesWorkspace.aiAnalyze.button')}
          >
            <SparklesIcon className={`h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
            {t('studiesWorkspace.aiAnalyze.buttonShort') || 'AI'}
          </button>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Full content */}
          <div className="px-4 py-4 pl-12">
            <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line leading-relaxed">
              {note.content}
            </p>
          </div>

          {/* Scripture references */}
          {note.scriptureRefs.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 pl-12 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                <BookmarkIcon className="h-4 w-4 text-emerald-600" />
                {t('studiesWorkspace.scriptureRefs')}
              </div>
              <div className="flex flex-wrap gap-2">
                {note.scriptureRefs.map((ref) => (
                  <span
                    key={ref.id}
                    className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  >
                    {formatRef(ref)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {note.tags.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 pl-12 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                🏷️ {t('studiesWorkspace.tags')}
              </div>
              <div className="flex flex-wrap gap-2">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-gray-100 px-4 py-3 pl-12 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onEdit(note)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  {t('common.edit')}
                </button>

                {needsAnalysis && onAnalyze && (
                  <button
                    onClick={() => onAnalyze(note)}
                    disabled={isAnalyzing}
                    className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-purple-500 to-indigo-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
                  >
                    <SparklesIcon className={`h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    {t('studiesWorkspace.aiAnalyze.button')}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                <button
                  onClick={() => {
                    if (confirm(t('studiesWorkspace.deleteConfirm'))) {
                      onDelete(note.id);
                    }
                  }}
                  className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  title={t('common.delete')}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

