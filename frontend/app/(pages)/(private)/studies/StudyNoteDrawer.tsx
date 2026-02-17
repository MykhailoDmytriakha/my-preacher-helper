'use client';

import {
    ArrowPathIcon,
    BookmarkIcon,
    BookOpenIcon,
    PlusIcon,
    SparklesIcon,
    TagIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import { StudyNote, ScriptureReference } from '@/models/models';
import { FocusRecorderButton } from '@components/FocusRecorderButton';

import { BibleLocale } from './bibleData';
import { STUDIES_INPUT_SHARED_CLASSES } from './constants';
import { parseReferenceText } from './referenceParser';
import ScriptureRefBadge from './ScriptureRefBadge';
import ScriptureRefPicker from './ScriptureRefPicker';
import TagCatalogModal from './TagCatalogModal';

// CSS class constants
const ACTIVE_BUTTON_LIGHT_CLASSES = 'bg-white text-gray-900 shadow-sm';
const ACTIVE_BUTTON_DARK_CLASSES = 'dark:bg-gray-600 dark:text-white';
const ACTIVE_BUTTON_CLASSES = `${ACTIVE_BUTTON_LIGHT_CLASSES} ${ACTIVE_BUTTON_DARK_CLASSES}`;
const INACTIVE_BUTTON_CLASSES = 'text-gray-500 hover:text-gray-700 dark:text-gray-400';

// Common inactive button style used in multiple places
const INACTIVE_TAB_CLASSES = 'text-gray-500 hover:text-gray-700 dark:text-gray-400';

const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

// Drawer size modes
type DrawerSize = 'narrow' | 'medium' | 'fullscreen';

// Size widths
const SIZE_WIDTHS: Record<DrawerSize, string> = {
    narrow: '30vw',
    medium: '50vw',
    fullscreen: '100vw',
};

const MIN_WIDTH = 350;
const MAX_WIDTH_PERCENT = 90;

// LocalStorage key for persisting drawer size
const DRAWER_SIZE_KEY = 'studyNoteDrawer:size';

interface StudyNoteDrawerProps {
    note: StudyNote | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (noteId: string, updates: Partial<StudyNote>) => Promise<void>;
    availableTags: string[];
    bibleLocale: BibleLocale;
}

export default function StudyNoteDrawer({
    note,
    isOpen,
    onClose,
    onSave,
    availableTags,
    bibleLocale,
}: StudyNoteDrawerProps) {
    const { t } = useTranslation();

    // ─────────────────────────────────────────────────────────────
    // DRAWER STATE
    // ─────────────────────────────────────────────────────────────
    const [size, setSize] = useState<DrawerSize>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(DRAWER_SIZE_KEY);
            if (saved && ['narrow', 'medium', 'fullscreen'].includes(saved)) {
                return saved as DrawerSize;
            }
        }
        return 'medium';
    });

    const [customWidth, setCustomWidth] = useState<number | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const drawerRef = useRef<HTMLDivElement>(null);

    // Save size preference
    useEffect(() => {
        localStorage.setItem(DRAWER_SIZE_KEY, size);
        // Reset custom width when switching to preset sizes
        if (size !== 'medium' || !customWidth) {
            setCustomWidth(null);
        }
    }, [size, customWidth]);

    // ─────────────────────────────────────────────────────────────
    // FORM STATE (migrated from EditStudyNoteModal)
    // ─────────────────────────────────────────────────────────────
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);
    const [type, setType] = useState<'note' | 'question'>('note');

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

    // Voice recording state
    const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);

    // Load note data when opened
    useEffect(() => {
        if (note && isOpen) {
            setTitle(note.title || '');
            setContent(note.content);
            setTags(note.tags);
            setScriptureRefs(note.scriptureRefs);
            setType(note.type || 'note');
            setTagInput('');
            setQuickRefInput('');
            setQuickRefError(null);
            setAnalyzeError(null);
            setEditingRefIndex(null);
            setShowRefPicker(false);

            // Auto-expand drawer based on content length
            if (note.content.length > 2000) {
                setSize((prev) => (prev !== 'fullscreen' ? 'fullscreen' : prev));
            } else if (note.content.length > 1000) {
                setSize((prev) => (prev === 'narrow' ? 'medium' : prev));
            }
        }
    }, [note, isOpen]);

    // Escape key handler
    useEffect(() => {
        const handleKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // ─────────────────────────────────────────────────────────────
    // DRAG TO RESIZE
    // ─────────────────────────────────────────────────────────────
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const newWidth = window.innerWidth - e.clientX;
            const maxWidth = window.innerWidth * (MAX_WIDTH_PERCENT / 100);
            const clampedWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
            setCustomWidth(clampedWidth);
            // When dragging, we're in custom mode (based on medium)
            setSize('medium');
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    // ─────────────────────────────────────────────────────────────
    // FORM HANDLERS
    // ─────────────────────────────────────────────────────────────
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
                type,
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

    const handleVoiceRecordingComplete = async (audioBlob: Blob) => {
        setIsVoiceProcessing(true);

        const formData = new FormData();
        formData.append('audio', audioBlob);

        try {
            const response = await fetch('/api/studies/transcribe', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!result.success) {
                const errorMessage = result.error || t('errors.audioProcessing') || 'Voice transcription failed';
                toast.error(errorMessage);
                return;
            }

            const newText = result.polishedText || result.originalText;
            if (newText) {
                setContent((prev) => (prev ? `${prev}\n\n${newText}` : newText));
            }
        } catch (error) {
            console.error('Voice transcription error:', error);
            const errorMessage = t('errors.audioProcessing') || 'Failed to process voice recording';
            toast.error(errorMessage);
        } finally {
            setIsVoiceProcessing(false);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // SIZE CONTROLS
    // ─────────────────────────────────────────────────────────────
    const handleSizeChange = (newSize: DrawerSize) => {
        setSize(newSize);
        setCustomWidth(null);
    };

    // Calculate actual width
    const getDrawerWidth = (): string => {
        if (customWidth && size === 'medium') {
            return `${customWidth}px`;
        }
        return SIZE_WIDTHS[size];
    };

    // ─────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────
    if (!isOpen || !note) return null;

    const drawerContent = (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                onClick={handleClose}
            />

            {/* Drawer */}
            <div
                ref={drawerRef}
                className={`fixed top-0 right-0 z-50 h-full bg-white shadow-2xl dark:bg-gray-800 flex flex-col transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
                style={{ width: getDrawerWidth() }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Resize handle */}
                <div
                    className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-emerald-500/50 transition-colors ${isResizing ? 'bg-emerald-500' : 'bg-transparent'
                        }`}
                    onMouseDown={handleMouseDown}
                    title={t('studiesWorkspace.drawer.dragToResize') || 'Drag to resize'}
                />

                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                        {/* Size toggle buttons */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-700">
                            <button
                                type="button"
                                onClick={() => handleSizeChange('narrow')}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${size === 'narrow'
                                    ? ACTIVE_BUTTON_CLASSES
                                    : INACTIVE_BUTTON_CLASSES
                                    }`}
                            >
                                30%
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSizeChange('medium')}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${size === 'medium' && !customWidth
                                    ? ACTIVE_BUTTON_CLASSES
                                    : INACTIVE_BUTTON_CLASSES
                                    }`}
                            >
                                50%
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSizeChange('fullscreen')}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${size === 'fullscreen'
                                    ? ACTIVE_BUTTON_CLASSES
                                    : INACTIVE_TAB_CLASSES
                                    }`}
                            >
                                100%
                            </button>
                        </div>

                        <h2 className="ml-2 text-lg font-bold text-gray-900 dark:text-gray-50">
                            {t('studiesWorkspace.editNote')}
                        </h2>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Type Toggle - Note/Question */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-700">
                            <button
                                type="button"
                                onClick={() => setType('note')}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${type === 'note'
                                    ? ACTIVE_BUTTON_CLASSES
                                    : INACTIVE_TAB_CLASSES
                                    }`}
                            >
                                {t('studiesWorkspace.type.note') || 'Note'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setType('question')}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${type === 'question'
                                    ? 'bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-900/40 dark:text-amber-100'
                                    : INACTIVE_TAB_CLASSES
                                    }`}
                            >
                                {t('studiesWorkspace.type.question') || 'Question'}
                            </button>
                        </div>

                        {/* Close button */}
                        <button
                            onClick={handleClose}
                            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                                {t('studiesWorkspace.contentLabel') || 'Your thoughts'}
                            </label>
                            <div className="relative flex items-center justify-center w-12 h-12">
                                <FocusRecorderButton
                                    size="small"
                                    onRecordingComplete={handleVoiceRecordingComplete}
                                    isProcessing={isVoiceProcessing}
                                    onError={(errorMessage) => toast.error(errorMessage)}
                                />
                            </div>
                        </div>
                        <TextareaAutosize
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={t('studiesWorkspace.contentPlaceholder')}
                            minRows={18}
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
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-4 dark:border-gray-700">
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
        </>
    );

    return createPortal(drawerContent, document.body);
}
