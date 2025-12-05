'use client';

import { useState, useEffect, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowPathIcon,
  BookmarkIcon,
  BookOpenIcon,
  PlusIcon,
  SparklesIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StudyNote, ScriptureReference } from '@/models/models';
import { STUDIES_INPUT_SHARED_CLASSES } from './constants';
import { parseReferenceText } from './referenceParser';
import ScriptureRefBadge from './ScriptureRefBadge';
import ScriptureRefPicker from './ScriptureRefPicker';
import TagCatalogModal from './TagCatalogModal';
import { BibleLocale } from './bibleData';

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

interface EditStudyNoteModalProps {
  note: StudyNote | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (noteId: string, updates: Partial<StudyNote>) => Promise<void>;
  availableTags: string[];
  bibleLocale: BibleLocale;
}

export default function EditStudyNoteModal({
  note,
  isOpen,
  onClose,
  onSave,
  availableTags,
  bibleLocale,
}: EditStudyNoteModalProps) {
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);

  const [tagInput, setTagInput] = useState('');
  const [quickRefInput, setQuickRefInput] = useState('');
  const [quickRefError, setQuickRefError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Scripture reference editing state
  const [editingRefIndex, setEditingRefIndex] = useState<number | null>(null);
  const [showRefPicker, setShowRefPicker] = useState(false);

  // Tag catalog modal state
  const [showTagCatalog, setShowTagCatalog] = useState(false);

  // AI analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Load note data when opened
  useEffect(() => {
    if (note && isOpen) {
      setTitle(note.title || '');
      setContent(note.content);
      setTags(note.tags);
      setScriptureRefs(note.scriptureRefs);
      setTagInput('');
      setQuickRefInput('');
      setQuickRefError(null);
      setAnalyzeError(null);
      setEditingRefIndex(null);
      setShowRefPicker(false);
    }
  }, [note, isOpen]);

  const handleClose = () => {
    onClose();
  };

  const handleSubmit = async () => {
    if (!note || !content.trim()) return;

    setIsSaving(true);
    try {
      await onSave(note.id, {
        title,
        content,
        tags,
        scriptureRefs,
      });
      onClose();
    } catch (error) {
      console.error('Error saving note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const addTag = () => {
    const value = tagInput.trim();
    if (!value) return;
    setTags((prev) => Array.from(new Set([...prev, value])));
    setTagInput('');
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => {
      const isSelected = prev.includes(tag);
      return isSelected ? prev.filter((t) => t !== tag) : [...prev, tag];
    });
  };

  const handleAIAnalyze = async () => {
    if (!content.trim()) {
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
          content: content,
          existingTags: availableTags,
        }),
      });

      const result = await response.json();

      if (!result.success || !result.data) {
        setAnalyzeError(result.error || t('studiesWorkspace.aiAnalyze.error') || 'Analysis failed');
        return;
      }

      const aiResult = result.data;

      // Update with AI results (merge, don't replace)
      if (!title.trim() && aiResult.title) {
        setTitle(aiResult.title);
      }

      // Add new scripture refs (avoid duplicates)
      if (aiResult.scriptureRefs?.length > 0) {
        setScriptureRefs((prev) => [
          ...prev,
          ...aiResult.scriptureRefs
            .filter((newRef: { book: string; chapter: number; fromVerse: number; toVerse?: number }) =>
              !prev.some(
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
        ]);
      }

      // Add new tags (avoid duplicates)
      if (aiResult.tags?.length > 0) {
        setTags((prev) => Array.from(new Set([...prev, ...aiResult.tags])));
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      setAnalyzeError(t('studiesWorkspace.aiAnalyze.error') || 'Failed to analyze note');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!isOpen || !note) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">
            {t('studiesWorkspace.editNote')}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
              {t('studiesWorkspace.titleLabel') || 'Title'}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('studiesWorkspace.titlePlaceholder')}
              className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
              {t('studiesWorkspace.contentLabel') || 'Your thoughts'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('studiesWorkspace.contentPlaceholder')}
              rows={8}
              className={`w-full resize-none ${STUDIES_INPUT_SHARED_CLASSES}`}
            />
          </div>

          {/* AI Analyze button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAIAnalyze}
              disabled={isAnalyzing || !content.trim()}
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
                  {t('studiesWorkspace.aiAnalyze.reanalyze') || 'Re-analyze with AI'}
                </>
              )}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.aiAnalyze.hintReanalyze') || 'Add missing metadata'}
            </span>
          </div>
          {analyzeError && (
            <p className="text-sm text-red-600 dark:text-red-400">{analyzeError}</p>
          )}

          {/* Scripture references */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <BookmarkIcon className="h-4 w-4" />
              {t('studiesWorkspace.scriptureRefs')}
            </div>

            {/* Display added references */}
            {scriptureRefs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {scriptureRefs.map((ref, idx) => (
                  <ScriptureRefBadge
                    key={ref.id}
                    reference={ref}
                    isEditing={editingRefIndex === idx}
                    onClick={() => {
                      setEditingRefIndex(idx);
                      setShowRefPicker(false);
                    }}
                    onRemove={() =>
                      setScriptureRefs((prev) => prev.filter((_, i) => i !== idx))
                    }
                  />
                ))}
              </div>
            )}

            {/* Quick input */}
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
                      const parsed = parseReferenceText(quickRefInput.trim(), bibleLocale);
                      if (!parsed) {
                        setQuickRefError(t('studiesWorkspace.quickRefError') || 'Cannot parse reference');
                        return;
                      }
                      setScriptureRefs((prev) => [...prev, { ...parsed, id: makeId() }]);
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
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              >
                <BookOpenIcon className="h-4 w-4" />
                {t('studiesWorkspace.browseBooks')}
              </button>
            </div>

            {/* Picker for adding new reference */}
            {showRefPicker && (
              <div className="relative">
                <ScriptureRefPicker
                  mode="add"
                  onConfirm={(ref) => {
                    setScriptureRefs((prev) => [...prev, { ...ref, id: makeId() }]);
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
                  initialRef={scriptureRefs[editingRefIndex]}
                  onConfirm={(ref) => {
                    setScriptureRefs((prev) => {
                      const refs = [...prev];
                      refs[editingRefIndex] = { ...ref, id: refs[editingRefIndex].id };
                      return refs;
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
                  className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
                />
              </div>
              <button
                type="button"
                onClick={addTag}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              >
                <PlusIcon className="h-4 w-4" />
                {t('studiesWorkspace.addTag')}
              </button>
              <button
                type="button"
                onClick={() => setShowTagCatalog(true)}
                className="inline-flex items-center justify-center rounded-md border border-emerald-200 p-2 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                title={t('studiesWorkspace.tagCatalog.button')}
              >
                🔍
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                  >
                    {tag}
                    <button
                      type="button"
                      className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-200"
                      onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {t('studiesWorkspace.createdAt')}: {new Date(note.createdAt).toLocaleDateString()}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  {t('common.saving') || 'Saving...'}
                </>
              ) : (
                t('studiesWorkspace.updateNote')
              )}
            </button>
          </div>
        </div>

        {/* Tag Catalog Modal */}
        <TagCatalogModal
          isOpen={showTagCatalog}
          onClose={() => setShowTagCatalog(false)}
          availableTags={availableTags}
          selectedTags={tags}
          onToggleTag={toggleTag}
        />
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

