'use client';

import { useState, useMemo, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import dynamic from 'next/dynamic';
import {
  ArrowPathIcon,
  BookmarkIcon,
  BookOpenIcon,
  PlusIcon,
  SparklesIcon,
  TagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { ScriptureReference } from '@/models/models';
import { STUDIES_INPUT_SHARED_CLASSES } from './constants';
import { parseReferenceText } from './referenceParser';
import ScriptureRefBadge from './ScriptureRefBadge';
import ScriptureRefPicker from './ScriptureRefPicker';
import TagCatalogModal from './TagCatalogModal';
import { BibleLocale } from './bibleData';

// Dynamic import AudioRecorder (client-side only)
const AudioRecorder = dynamic(
  () => import('@components/AudioRecorder').then((mod) => mod.AudioRecorder),
  { ssr: false, loading: () => null }
);

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export interface NoteFormValues {
  title: string;
  content: string;
  tags: string[];
  scriptureRefs: ScriptureReference[];
}

const emptyForm: NoteFormValues = {
  title: '',
  content: '',
  tags: [],
  scriptureRefs: [],
};

interface AddStudyNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: NoteFormValues) => Promise<void>;
  availableTags: string[];
  bibleLocale: BibleLocale;
}

export default function AddStudyNoteModal({
  isOpen,
  onClose,
  onSave,
  availableTags,
  bibleLocale,
}: AddStudyNoteModalProps) {
  const { t } = useTranslation();

  const [formState, setFormState] = useState<NoteFormValues>(emptyForm);
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

  // Show advanced fields
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Voice input state
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const resetForm = () => {
    setFormState(emptyForm);
    setTagInput('');
    setQuickRefInput('');
    setQuickRefError(null);
    setAnalyzeError(null);
    setShowAdvanced(false);
    setEditingRefIndex(null);
    setShowRefPicker(false);
    setVoiceError(null);
  };

  // Check if form has unsaved content
  const hasUnsavedContent =
    formState.content.trim() !== '' ||
    formState.title.trim() !== '' ||
    formState.tags.length > 0 ||
    formState.scriptureRefs.length > 0;

  const handleClose = () => {
    // If there's unsaved content, ask for confirmation
    if (hasUnsavedContent) {
      const confirmed = window.confirm(
        t('studiesWorkspace.unsavedChangesConfirm') ||
        'You have unsaved changes. Are you sure you want to close?'
      );
      if (!confirmed) return;
    }
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!formState.content.trim()) return;

    setIsSaving(true);
    try {
      await onSave(formState);
      resetForm();
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
    setFormState((s) => ({ ...s, tags: Array.from(new Set([...s.tags, value])) }));
    setTagInput('');
  };

  const toggleTag = (tag: string) => {
    setFormState((s) => {
      const isSelected = s.tags.includes(tag);
      return {
        ...s,
        tags: isSelected ? s.tags.filter((t) => t !== tag) : [...s.tags, tag],
      };
    });
  };

  // Handle voice recording complete
  const handleVoiceRecordingComplete = async (audioBlob: Blob) => {
    setIsVoiceProcessing(true);
    setVoiceError(null);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('/api/studies/transcribe', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        setVoiceError(result.error || t('studiesWorkspace.voiceInput.error'));
        return;
      }

      // Append polished text to content
      const newText = result.polishedText;
      setFormState((prev) => ({
        ...prev,
        content: prev.content
          ? `${prev.content}\n\n${newText}`
          : newText,
      }));
    } catch (error) {
      console.error('Voice input error:', error);
      setVoiceError(t('studiesWorkspace.voiceInput.error') || 'Failed to process voice input');
    } finally {
      setIsVoiceProcessing(false);
    }
  };

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
          existingTags: availableTags,
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
        title: prev.title.trim() ? prev.title : title,
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
        tags: Array.from(new Set([...prev.tags, ...tags])),
      }));

      // Show advanced section if we got metadata
      if (title || scriptureRefs.length > 0 || tags.length > 0) {
        setShowAdvanced(true);
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      setAnalyzeError(t('studiesWorkspace.aiAnalyze.error') || 'Failed to analyze note');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Check if form has metadata
  const hasMetadata = formState.title || formState.scriptureRefs.length > 0 || formState.tags.length > 0;

  if (!isOpen) return null;

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
            {t('studiesWorkspace.newNote')}
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
          {/* Main content area with voice input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('studiesWorkspace.contentLabel') || 'Your thoughts'}
              </label>
              {/* Voice input button */}
              <div className="flex items-center gap-2">
                {isVoiceProcessing && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <ArrowPathIcon className="h-3 w-3 animate-spin" />
                    {t('studiesWorkspace.voiceInput.transcribing') || 'Processing...'}
                  </span>
                )}
                <AudioRecorder
                  onRecordingComplete={handleVoiceRecordingComplete}
                  isProcessing={isVoiceProcessing}
                  variant="mini"
                  hideKeyboardShortcuts
                />
              </div>
            </div>
            <textarea
              value={formState.content}
              onChange={(e) => setFormState((s) => ({ ...s, content: e.target.value }))}
              placeholder={t('studiesWorkspace.contentPlaceholder')}
              rows={6}
              className={`w-full resize-none ${STUDIES_INPUT_SHARED_CLASSES}`}
              autoFocus
            />
            {voiceError && (
              <p className="text-sm text-red-600 dark:text-red-400">{voiceError}</p>
            )}
          </div>

          {/* AI Analyze button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAIAnalyze}
              disabled={isAnalyzing || !formState.content.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Advanced section toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {showAdvanced ? '▼' : '▶'} {t('studiesWorkspace.manualEntry') || 'Add details manually'}
            {hasMetadata && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                {formState.scriptureRefs.length > 0 && `📖 ${formState.scriptureRefs.length}`}
                {formState.tags.length > 0 && ` 🏷️ ${formState.tags.length}`}
              </span>
            )}
          </button>

          {/* Advanced fields */}
          {showAdvanced && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                  {t('studiesWorkspace.titleLabel') || 'Title'} ({t('common.optional') || 'optional'})
                </label>
                <input
                  value={formState.title}
                  onChange={(e) => setFormState((s) => ({ ...s, title: e.target.value }))}
                  placeholder={t('studiesWorkspace.titlePlaceholder')}
                  className={`w-full ${STUDIES_INPUT_SHARED_CLASSES}`}
                />
              </div>

              {/* Scripture references */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                  <BookmarkIcon className="h-4 w-4" />
                  {t('studiesWorkspace.scriptureRefs')}
                </div>

                {/* Display added references */}
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
                {formState.tags.length > 0 && (
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
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!formState.content.trim() || isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                {t('common.saving') || 'Saving...'}
              </>
            ) : (
              <>
                <PlusIcon className="h-5 w-5" />
                {t('studiesWorkspace.saveNote')}
              </>
            )}
          </button>
        </div>

        {/* Tag Catalog Modal */}
        <TagCatalogModal
          isOpen={showTagCatalog}
          onClose={() => setShowTagCatalog(false)}
          availableTags={availableTags}
          selectedTags={formState.tags}
          onToggleTag={toggleTag}
        />
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

