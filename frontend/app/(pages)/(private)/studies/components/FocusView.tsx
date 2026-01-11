'use client';

import {
  BookmarkIcon,
  CheckIcon,
  LinkIcon,
  PencilIcon,
  QuestionMarkCircleIcon,
  SparklesIcon,
  TrashIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote } from '@/models/models';
import { formatStudyNoteForCopy } from '@/utils/studyNoteUtils';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { BibleLocale } from '../bibleData';
import ScriptureRefBadge from '../ScriptureRefBadge';

import FocusNavigation from './FocusNavigation';

interface FocusViewProps {
  note: StudyNote;
  bibleLocale: BibleLocale;
  currentIndex: number;
  totalCount: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onEdit: (note: StudyNote) => void;
  onDelete: (noteId: string) => void;
  onAnalyze?: (note: StudyNote) => void;
  isAnalyzing?: boolean;
  searchQuery?: string;
  onShare?: (note: StudyNote) => void;
}

/**
 * Full-screen focus view for reading a single study note.
 * Soft emerald theme with gentle animations.
 */
export default function FocusView({
  note,
  bibleLocale,
  currentIndex,
  totalCount,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onEdit,
  onDelete,
  onAnalyze,
  isAnalyzing = false,
  searchQuery = '',
  onShare,
}: FocusViewProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Clipboard functionality
  const clipboardResult = useClipboard({
    successDuration: 1500,
  });
  const { isCopied, copyToClipboard } = clipboardResult || { isCopied: false, copyToClipboard: () => {} };

  const isQuestion = note.type === 'question';
  const needsAnalysis =
    !note.title && note.scriptureRefs.length === 0 && note.tags.length === 0;

  // Format relative time
  const formatRelativeTime = useCallback(
    (dateStr: string) => {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return t('common.today');
      if (diffDays === 1) return t('common.yesterday');
      if (diffDays < 7) return t('common.daysAgo', { count: diffDays });
      if (diffDays < 30)
        return t('common.weeksAgo', { count: Math.floor(diffDays / 7) });
      return date.toLocaleDateString();
    },
    [t]
  );

  // Animate in on mount and block body scroll
  useEffect(() => {
    // Block body scroll when focus view is open
    document.body.style.overflow = 'hidden';

    // Small delay to trigger CSS transition
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => {
      clearTimeout(timer);
      // Restore body scroll when unmounting
      document.body.style.overflow = '';
    };
  }, []);

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose]);

  // Handle delete with confirmation
  const handleDelete = useCallback(() => {
    if (confirm(t('studiesWorkspace.deleteConfirm'))) {
      onDelete(note.id);
      handleClose();
    }
  }, [t, onDelete, note.id, handleClose]);

  // Handle copying note data
  const handleCopyNote = useCallback(async () => {
    const markdownContent = formatStudyNoteForCopy(note, bibleLocale);
    await copyToClipboard(markdownContent);
  }, [note, bibleLocale, copyToClipboard]);

  const handleShareNote = useCallback(() => {
    if (!onShare) return;
    onShare(note);
  }, [onShare, note]);

  // Memoize border class based on note type
  const panelBorderClass = useMemo(
    () =>
      isQuestion
        ? 'border-amber-100 dark:border-amber-800/40'
        : 'border-emerald-100 dark:border-emerald-800/40',
    [isQuestion]
  );

  const panelShadowClass = useMemo(
    () =>
      isQuestion
        ? 'shadow-2xl shadow-amber-500/10 dark:shadow-amber-500/5'
        : 'shadow-2xl shadow-emerald-500/10 dark:shadow-emerald-500/5',
    [isQuestion]
  );

  const focusContent = (
    <>
      {/* Backdrop with blur */}
      <div
        className={`fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm transition-opacity duration-300 ${
          isVisible && !isClosing ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Main panel */}
      <div
        className={`
          fixed inset-1 md:inset-2 lg:inset-3 z-50
          bg-white dark:bg-gray-800
          rounded-2xl
          border ${panelBorderClass}
          ${panelShadowClass}
          flex flex-col
          transition-all duration-300 ease-out
          ${isVisible && !isClosing ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-view-title"
      >
        {/* Navigation header */}
        <FocusNavigation
          currentIndex={currentIndex}
          totalCount={totalCount}
          onPrev={onPrev}
          onNext={onNext}
          onClose={handleClose}
          hasPrev={hasPrev}
          hasNext={hasNext}
          isQuestion={isQuestion}
        />

        {/* Content area with key for crossfade animation */}
        <div
          key={note.id}
          className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6 animate-fadeIn"
        >
          {/* Title */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              {isQuestion && (
                <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-500/30">
                  <QuestionMarkCircleIcon className="mr-1 h-3.5 w-3.5" />
                  {t('studiesWorkspace.type.question')}
                </span>
              )}
            </div>
            <h1
              id="focus-view-title"
              className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-50 leading-tight"
            >
              {note.title || t('studiesWorkspace.untitled')}
            </h1>
          </div>

          {/* Content */}
          <div className="prose prose-emerald dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-50 prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed max-w-none">
            <MarkdownDisplay content={note.content} searchQuery={searchQuery} />
          </div>
        </div>

        {/* Metadata section */}
        {(note.scriptureRefs.length > 0 || note.tags.length > 0) && (
          <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-4 md:px-6 space-y-3">
            {/* Scripture references */}
            {note.scriptureRefs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                  <BookmarkIcon className="h-4 w-4 text-emerald-600" />
                  {t('studiesWorkspace.scriptureRefs')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {note.scriptureRefs.map((ref) => (
                    <ScriptureRefBadge key={ref.id} reference={ref} />
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {note.tags.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                  🏷️ {t('studiesWorkspace.tags')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions footer */}
        <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 px-4 py-3 md:px-6 md:py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(note)}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              <PencilIcon className="h-3.5 w-3.5" />
              {t('common.edit')}
            </button>

            {onShare && (
              <button
                type="button"
                onClick={handleShareNote}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {t('studiesWorkspace.shareLinks.shareButton')}
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyNote}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              {isCopied ? (
                <CheckIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              ) : (
                <DocumentDuplicateIcon className="h-3.5 w-3.5" />
              )}
              {isCopied ? t('common.copied', 'Copied!') : t('common.copy', 'Copy')}
            </button>

            {needsAnalysis && onAnalyze && (
              <button
                type="button"
                onClick={() => onAnalyze(note)}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-purple-500 to-indigo-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
              >
                <SparklesIcon
                  className={`h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`}
                />
                {t('studiesWorkspace.aiAnalyze.button')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span>{formatRelativeTime(note.updatedAt)}</span>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title={t('common.delete')}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-gray-900/80 dark:bg-gray-700/90 text-white text-xs font-medium backdrop-blur-sm opacity-70 pointer-events-none hidden md:block">
        {t('studiesWorkspace.focusMode.keyboardHint')}
      </div>
    </>
  );

  return createPortal(focusContent, document.body);
}
