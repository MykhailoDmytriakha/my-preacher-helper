'use client';

import { ArrowLeftIcon, ArrowPathIcon, CheckCircleIcon, SparklesIcon, TagIcon, BookmarkIcon, PlusIcon, BookOpenIcon, XMarkIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, QuestionMarkCircleIcon, PencilIcon, TrashIcon, CheckIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import { FocusRecorderButton } from '@/components/FocusRecorderButton';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { ScriptureReference, StudyNote } from '@/models/models';
import { deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import { BibleLocale, getLocalizedBookName } from '../bibleData';
import { STUDIES_INPUT_SHARED_CLASSES } from '../constants';
import { parseReferenceText } from '../referenceParser';
import ScriptureRefBadge from '../ScriptureRefBadge';
import ScriptureRefPicker from '../ScriptureRefPicker';
import TagCatalogModal from '../TagCatalogModal';


const makeId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// Local helper until API has a specific noteId delete
const deleteStudyNoteShareLinkByNoteId = async (userId: string, noteId: string, currentLinks: { noteId: string; id: string }[]) => {
    const link = currentLinks.find(l => l.noteId === noteId);
    if (link) {
        await deleteStudyNoteShareLink(userId, link.id);
    }
};

function useFilteredNotes(notes: StudyNote[], searchParams: URLSearchParams, bibleLocale: BibleLocale) {
    const params = useParams();
    const noteId = params.id as string;

    const searchQuery = searchParams.get('search')?.trim() || '';
    const tagFilter = searchParams.get('tag') || '';
    const bookFilter = searchParams.get('book') || '';
    const activeTab = searchParams.get('tab') || 'all';

    const searchTokens = useMemo(() => searchQuery.toLowerCase().split(/\s+/).filter(Boolean), [searchQuery]);

    // Replicate matching logic from studies/page.tsx
    const filteredNotes = useMemo(() => {
        return notes
            .filter((note: StudyNote) => {
                if (activeTab === 'notes') return note.type !== 'question';
                if (activeTab === 'questions') return note.type === 'question';
                return true;
            })
            .filter((note: StudyNote) => (tagFilter ? note.tags.includes(tagFilter) : true))
            .filter((note: StudyNote) => bookFilter ? note.scriptureRefs.some((ref: ScriptureReference) => ref.book.toLowerCase() === bookFilter.toLowerCase()) : true)
            .filter((note: StudyNote) => {
                if (searchTokens.length === 0) return true;
                const haystack = `${note.title} ${note.content} ${note.tags.join(' ')} ${note.scriptureRefs.map((ref: ScriptureReference) => `${getLocalizedBookName(ref.book, bibleLocale)} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`).join(' ')}`.toLowerCase();
                return searchTokens.every((token: string) => haystack.includes(token));
            })
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }, [notes, activeTab, tagFilter, bookFilter, searchTokens, bibleLocale]);

    const currentIndex = useMemo(() => filteredNotes.findIndex(n => n.id === noteId), [filteredNotes, noteId]);
    const prevNoteId = currentIndex > 0 ? filteredNotes[currentIndex - 1].id : null;
    const nextNoteId = currentIndex >= 0 && currentIndex < filteredNotes.length - 1 ? filteredNotes[currentIndex + 1].id : null;

    return { filteredNotes, currentIndex, prevNoteId, nextNoteId, searchQuery };
}

function useNoteKeyboardNavigation({
    isEditing, prevNoteId, nextNoteId, router, searchParams
}: {
    isEditing: boolean; prevNoteId: string | null; nextNoteId: string | null;
    router: ReturnType<typeof useRouter>; searchParams: ReturnType<typeof useSearchParams>;
}) {
    useEffect(() => {
        if (isEditing) return;
        const handleKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && prevNoteId) {
                router.push(`/studies/${prevNoteId}?${searchParams.toString()}`);
            } else if (e.key === 'ArrowRight' && nextNoteId) {
                router.push(`/studies/${nextNoteId}?${searchParams.toString()}`);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isEditing, prevNoteId, nextNoteId, router, searchParams]);
}

function useNoteInitialization({
    notesLoading, uid, isNew, isInitialized, existingNote, createNote, router, t,
    setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved
}: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
    useEffect(() => {
        if (notesLoading || !uid) return;

        if (isNew && !isInitialized) {
            createNote({
                title: '', content: '', tags: [], scriptureRefs: [], type: 'note',
                userId: uid, materialIds: [], relatedSermonIds: []
            }).then((newNoteId: string) => {
                router.replace(`/studies/${newNoteId}`);
            }).catch(() => {
                toast.error(t('studiesWorkspace.createError') || 'Failed to initialize note');
            });
            setIsInitialized(true);
            return;
        }

        if (existingNote && !isInitialized) {
            setTitle(existingNote.title || '');
            setContent(existingNote.content || '');
            setTags(existingNote.tags || []);
            setScriptureRefs(existingNote.scriptureRefs || []);
            setType(existingNote.type || 'note');
            setIsInitialized(true);
            setLastSaved(new Date(existingNote.updatedAt));
        }
    }, [notesLoading, isNew, existingNote, isInitialized, createNote, uid, router, t, setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useNoteDeletion({ t, noteId, isNew, uid, deleteNote, router }: any) {
    return async () => {
        if (confirm(t('studiesWorkspace.deleteConfirm'))) {
            if (noteId && !isNew && uid) {
                await deleteNote(noteId);
                try {
                    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE || ''}/api/studies/share-links?userId=${uid}`);
                    if (res.ok) {
                        const links = await res.json();
                        await deleteStudyNoteShareLinkByNoteId(uid, noteId, links);
                    }
                } catch (e) {
                    console.error('Error deleting share link', e);
                }
            }
            router.back();
        }
    };
}

function useNoteAutoSave({
    noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, updateNote, t
}: {
    noteId: string; isNew: boolean; isInitialized: boolean; existingNote?: StudyNote; title: string;
    content: string; tags: string[]; scriptureRefs: ScriptureReference[]; type: 'note' | 'question';
    updateNote: any /* eslint-disable-line @typescript-eslint/no-explicit-any */; t: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
}) {
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const saveChanges = useCallback(async () => {
        if (!noteId || isNew) return;

        if (existingNote) {
            const isUnchanged =
                existingNote.title === title &&
                existingNote.content === content &&
                existingNote.type === type &&
                JSON.stringify(existingNote.tags) === JSON.stringify(tags) &&
                JSON.stringify(existingNote.scriptureRefs) === JSON.stringify(scriptureRefs);

            if (isUnchanged) return;
        }

        setIsSaving(true);
        setSaveError(null);
        try {
            await updateNote({
                id: noteId,
                updates: { title, content, tags, scriptureRefs, type }
            });
            setLastSaved(new Date());
        } catch (e) {
            console.error('Auto-save error', e);
            setSaveError(t('common.saveError') || 'Error saving changes');
        } finally {
            setIsSaving(false);
        }
    }, [noteId, isNew, existingNote, title, content, tags, scriptureRefs, type, updateNote, t]);

    useEffect(() => {
        if (!isInitialized) return;
        const timeoutId = setTimeout(() => {
            saveChanges();
        }, 1500);
        return () => clearTimeout(timeoutId);
    }, [title, content, tags, scriptureRefs, type, isInitialized, saveChanges]);

    return { isSaving, lastSaved, saveError, setLastSaved };
}

function useNoteAIAssistant({
    content, title, availableTags, setTitle, setContent, setScriptureRefs, setTags, t
}: {
    content: string; title: string; availableTags: string[];
    setTitle: (t: string) => void; setContent: (c: string | ((prev: string) => string)) => void;
    setScriptureRefs: (refs: ScriptureReference[] | ((prev: ScriptureReference[]) => ScriptureReference[])) => void; setTags: (tags: string[] | ((prev: string[]) => string[])) => void; t: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
}) {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);

    const handleAIAnalyze = async () => {
        if (!content.trim()) {
            toast.error(t('studiesWorkspace.aiAnalyze.emptyContent') || 'Please enter note content');
            return;
        }

        setIsAnalyzing(true);
        try {
            const response = await fetch('/api/studies/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, existingTags: availableTags }),
            });
            const result = await response.json();

            if (!result.success || !result.data) {
                throw new Error(result.error);
            }

            const aiResult = result.data;
            if (!title.trim() && aiResult.title) setTitle(aiResult.title);

            if (aiResult.scriptureRefs?.length > 0) {
                setScriptureRefs((prev: ScriptureReference[]) => {
                    const newRefs = aiResult.scriptureRefs.filter((nr: ScriptureReference) =>
                        !prev.some((er: ScriptureReference) => er.book === nr.book && er.chapter === nr.chapter && er.fromVerse === nr.fromVerse)
                    ).map((ref: Omit<ScriptureReference, 'id'>) => ({ ...ref, id: makeId() }));
                    return [...prev, ...newRefs];
                });
            }

            if (aiResult.tags?.length > 0) {
                setTags((prev: string[]) => Array.from(new Set([...prev, ...aiResult.tags])));
            }
            toast.success(t('studiesWorkspace.aiAnalyze.success') || 'Analysis applied successfully');
        } catch {
            toast.error(t('studiesWorkspace.aiAnalyze.error') || 'Failed to analyze');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleVoiceRecordingComplete = async (audioBlob: Blob) => {
        setIsVoiceProcessing(true);
        const formData = new FormData();
        formData.append('audio', audioBlob);

        try {
            const response = await fetch('/api/studies/transcribe', { method: 'POST', body: formData });
            const result = await response.json();

            if (!result.success) throw new Error(result.error);

            const newText = result.polishedText || result.originalText;
            if (newText) setContent((prev: string) => (prev ? `${prev}\n\n${newText}` : newText));
        } catch {
            toast.error(t('errors.audioProcessing') || 'Voice transcription failed');
        } finally {
            setIsVoiceProcessing(false);
        }
    };

    return { isAnalyzing, isVoiceProcessing, handleAIAnalyze, handleVoiceRecordingComplete };
}

function EditorHeader({
    handleBack, t, isEditing, filteredNotes, prevNoteId, nextNoteId, router, searchParams,
    currentIndex, type, setType, isSaving, saveError, lastSaved, setIsEditing, handleDelete
}: {
    handleBack: () => void; t: ReturnType<typeof useTranslation>['t']; isEditing: boolean;
    filteredNotes: StudyNote[]; prevNoteId: string | null; nextNoteId: string | null;
    router: ReturnType<typeof useRouter>; searchParams: ReturnType<typeof useSearchParams>;
    currentIndex: number; type: 'note' | 'question'; setType: (t: 'note' | 'question') => void;
    isSaving: boolean; saveError: string | null; lastSaved: Date | null;
    setIsEditing: (b: boolean) => void; handleDelete: () => void;
}) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    return (
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-200 bg-white/80 px-4 sm:px-6 py-3 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/80">
            <div className="flex items-center gap-1 sm:gap-2 lg:gap-4">
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleBack}
                        className="flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                        title={t('common.back')}
                    >
                        <ArrowLeftIcon className="h-5 w-5" />
                    </button>

                    {/* Pagination Chevrons + Counter */}
                    {!isEditing && filteredNotes.length > 1 && (
                        <div className="flex items-center border-l border-gray-200 dark:border-gray-700 pl-2 gap-0.5">
                            <button
                                onClick={() => router.push(`/studies/${prevNoteId}?${searchParams.toString()}`)}
                                disabled={!prevNoteId}
                                className="flex items-center justify-center rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:outline-none disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100 transition-colors"
                                title={t('common.previous') || 'Previous (←)'}
                            >
                                <ChevronLeftIcon className="h-4 w-4" />
                            </button>
                            <span className="text-xs font-mono text-gray-400 dark:text-gray-500 min-w-[3rem] text-center select-none tabular-nums">
                                {currentIndex >= 0 ? `${currentIndex + 1} / ${filteredNotes.length}` : '—'}
                            </span>
                            <button
                                onClick={() => router.push(`/studies/${nextNoteId}?${searchParams.toString()}`)}
                                disabled={!nextNoteId}
                                className="flex items-center justify-center rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:outline-none disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100 transition-colors"
                                title={t('common.next') || 'Next (→)'}
                            >
                                <ChevronRightIcon className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        {isEditing ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setType('note')}
                                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${type === 'note' ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                                >
                                    {t('studiesWorkspace.type.note') || 'Note'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setType('question')}
                                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${type === 'question' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                                >
                                    {t('studiesWorkspace.type.question') || 'Question'}
                                </button>
                            </>
                        ) : type === 'question' ? (
                            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-500/30">
                                <QuestionMarkCircleIcon className="mr-1 h-3.5 w-3.5" />
                                {t('studiesWorkspace.type.question') || 'Question'}
                            </span>
                        ) : (
                            <span className="inline-flex items-center rounded-md bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10 dark:bg-gray-800/50 dark:text-gray-400 dark:ring-gray-700/50">
                                {t('studiesWorkspace.type.note') || 'Note'}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Sync Status Info */}
            <div className="flex items-center gap-3">
                <div className="text-sm flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    {isSaving ? (
                        <><ArrowPathIcon className="h-4 w-4 animate-spin" /> <span>{t('common.saving') || 'Saving...'}</span></>
                    ) : saveError ? (
                        <span className="text-red-500">{saveError}</span>
                    ) : lastSaved ? (
                        <><CheckCircleIcon className="h-4 w-4 text-emerald-500" /> <span className="hidden sm:inline">{t('common.saved') || 'Saved'}</span></>
                    ) : null}
                </div>

                <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`p-2 rounded-lg transition-colors ${isEditing
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                    title={isEditing ? t('common.done') || 'Done' : t('common.edit') || 'Edit'}
                    aria-label={isEditing ? t('common.done') || 'Done' : t('common.edit') || 'Edit'}
                >
                    {isEditing ? <CheckIcon className="h-5 w-5" /> : <PencilIcon className="h-5 w-5" />}
                </button>

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                        title={t('common.more') || 'More'}
                        aria-label={t('common.more') || 'More'}
                    >
                        <EllipsisVerticalIcon className="h-5 w-5" />
                    </button>
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800 z-50">
                            <button
                                onClick={() => { setShowMenu(false); handleDelete(); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors"
                            >
                                <TrashIcon className="h-4 w-4" />
                                {t('common.delete')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

export default function StudyNoteEditorPage() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const params = useParams();
    const noteId = params.id as string;
    const isNew = noteId === 'new';

    const { uid, notes, createNote, updateNote, deleteNote, loading: notesLoading } = useStudyNotes();
    const { tags: tagData } = useTags(uid);

    // Local state for the editor
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);
    const [type, setType] = useState<'note' | 'question'>('note');
    const [isEditing, setIsEditing] = useState(isNew);

    // Input states
    const [tagInput, setTagInput] = useState('');
    const [quickRefInput, setQuickRefInput] = useState('');
    const [quickRefError, setQuickRefError] = useState<string | null>(null);

    // Tag / Reference Pickers
    const [showTagCatalog, setShowTagCatalog] = useState(false);
    const [editingRefIndex, setEditingRefIndex] = useState<number | null>(null);
    const [showRefPicker, setShowRefPicker] = useState(false);

    // Load existing note data or create a new empty template
    const existingNote = useMemo(() => notes.find(n => n.id === noteId), [notes, noteId]);

    const bibleLocale: BibleLocale = useMemo(() => {
        const lang = i18n.language?.toLowerCase() || 'en';
        if (lang.startsWith('ru')) return 'ru';
        if (lang.startsWith('uk')) return 'uk';
        return 'en';
    }, [i18n.language]);

    const availableTags = useMemo(() => {
        const fromTags = [...(tagData.requiredTags ?? []), ...(tagData.customTags ?? [])].map(t => t.name);
        const fromNotes = new Set<string>();
        notes.forEach(n => n.tags.forEach(t => fromNotes.add(t)));
        return Array.from(new Set([...fromTags, ...Array.from(fromNotes)])).sort((a, b) => a.localeCompare(b));
    }, [tagData, notes]);

    // ─── PAGINATION LOGIC ──────────────────────────────────────────────────
    const searchParams = useSearchParams();
    const { filteredNotes, currentIndex, prevNoteId, nextNoteId, searchQuery } = useFilteredNotes(notes, searchParams, bibleLocale);

    useNoteKeyboardNavigation({ isEditing, prevNoteId, nextNoteId, router, searchParams });

    // Handle Initial Load
    const [isInitialized, setIsInitialized] = useState(false);

    const { isSaving, lastSaved, saveError, setLastSaved } = useNoteAutoSave({
        noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, updateNote, t
    });

    useNoteInitialization({
        notesLoading, uid, isNew, isInitialized, existingNote, createNote, router, t,
        setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved
    });

    const { isAnalyzing, isVoiceProcessing, handleAIAnalyze, handleVoiceRecordingComplete } = useNoteAIAssistant({
        content, title, availableTags, setTitle, setContent, setScriptureRefs, setTags, t
    });


    // ─── HANDLERS ─────────────────────────────────────────────────────────

    const handleBack = () => {
        const queryParams = searchParams.toString();
        router.push(queryParams ? `/studies?${queryParams}` : '/studies');
    };

    const handleDelete = useNoteDeletion({ t, noteId, isNew, uid, deleteNote, router });

    const addTag = () => {
        const value = tagInput.trim();
        if (!value) return;
        setTags((prev) => Array.from(new Set([...prev, value])));
        setTagInput('');
    };

    const toggleTag = (tag: string) => {
        setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    };

    // ─── RENDER ─────────────────────────────────────────────────────────────

    if (notesLoading || (!isInitialized && !isNew)) {
        return (
            <div className="flex items-center justify-center p-12">
                <ArrowPathIcon className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col -m-4 md:-m-6 lg:-m-8 relative">
            {/* HEADER TRAY */}
            <EditorHeader
                handleBack={handleBack} t={t} isEditing={isEditing} filteredNotes={filteredNotes}
                prevNoteId={prevNoteId} nextNoteId={nextNoteId} router={router} searchParams={searchParams}
                currentIndex={currentIndex} type={type} setType={setType} isSaving={isSaving} saveError={saveError}
                lastSaved={lastSaved} setIsEditing={setIsEditing} handleDelete={handleDelete}
            />

            {/* EDITOR CONTENT */}
            <div className="flex-1 w-full max-w-full mx-auto px-4 py-8 md:px-12 md:py-16 space-y-8 pb-48 md:pb-32 transition-all duration-300">
                {/* Title Area */}
                <div>
                    {isEditing ? (
                        <TextareaAutosize
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder={t('studiesWorkspace.titlePlaceholder') || 'Note Title...'}
                            className="w-full text-4xl md:text-5xl font-extrabold tracking-tight bg-transparent border-none outline-none resize-none placeholder:text-gray-200 dark:placeholder:text-gray-800 text-gray-900 dark:text-gray-50 transition-colors"
                        />
                    ) : (
                        <h1 className="w-full text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 leading-tight min-h-[1em]">
                            {title ? (
                                searchQuery ? <HighlightedText text={title} searchQuery={searchQuery} /> : title
                            ) : (
                                isNew ? '' : t('studiesWorkspace.untitled')
                            )}
                        </h1>
                    )}
                </div>

                <div className="relative group">
                    {isEditing ? (
                        <TextareaAutosize
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={t('studiesWorkspace.contentPlaceholder') || 'Start typing your thoughts here...'}
                            minRows={10}
                            className="w-full resize-none text-lg md:text-xl bg-transparent border-none outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 text-gray-800 dark:text-gray-200 leading-relaxed transition-colors"
                        />
                    ) : (
                        <div className="prose prose-emerald dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-50 prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-p:leading-relaxed max-w-none text-lg md:text-xl">
                            <MarkdownDisplay content={content} searchQuery={searchQuery} />
                        </div>
                    )}

                </div>

                {isEditing && (
                    <div className="fixed bottom-6 right-4 md:bottom-8 md:right-8 z-50 flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={handleAIAnalyze}
                            disabled={isAnalyzing || !content.trim()}
                            title={t('studiesWorkspace.aiAnalyze.button')}
                            className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg hover:from-purple-600 hover:to-indigo-600 hover:scale-105 disabled:opacity-50 transition-all border border-purple-400 dark:border-purple-600"
                        >
                            <SparklesIcon className={`h-6 w-6 ${isAnalyzing ? 'animate-spin' : ''}`} />
                        </button>
                        <div className="shadow-lg rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                            <FocusRecorderButton
                                onRecordingComplete={handleVoiceRecordingComplete}
                                isProcessing={isVoiceProcessing}
                                onError={(err: unknown) => toast.error(String(err) || 'Error')}
                            />
                        </div>
                    </div>
                )}

                {/* Metadata Tray (Tags & Refs) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-gray-100 dark:border-gray-800">
                    {/* References */}
                    <div className="flex flex-col h-full space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.scriptureRefs')}>
                            <BookmarkIcon className="h-5 w-5" />
                        </div>

                        {scriptureRefs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {scriptureRefs.map((ref, idx) => (
                                    <ScriptureRefBadge
                                        key={ref.id}
                                        reference={ref}
                                        isEditing={isEditing ? editingRefIndex === idx : false}
                                        onClick={isEditing ? () => { setEditingRefIndex(idx); setShowRefPicker(false); } : undefined}
                                        onRemove={isEditing ? () => setScriptureRefs(prev => prev.filter((_, i) => i !== idx)) : undefined}
                                    />
                                ))}
                            </div>
                        )}

                        {isEditing && (
                            <div className="flex items-center gap-2 mt-auto pt-2">
                                <input
                                    value={quickRefInput}
                                    onChange={(e) => { setQuickRefInput(e.target.value); setQuickRefError(null); }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const parsed = parseReferenceText(quickRefInput.trim(), bibleLocale);
                                            if (!parsed) { setQuickRefError(t('studiesWorkspace.quickRefError') || 'Cannot parse'); return; }
                                            setScriptureRefs(prev => [...prev, { ...parsed, id: makeId() }]);
                                            setQuickRefInput('');
                                        }
                                    }}
                                    placeholder={t('studiesWorkspace.quickRefPlaceholder')}
                                    className={`flex-1 ${STUDIES_INPUT_SHARED_CLASSES} py-1.5`}
                                />
                                <button
                                    onClick={() => setShowRefPicker(true)}
                                    className="p-1.5 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors dark:text-gray-400 dark:hover:bg-gray-800"
                                    title={t('studiesWorkspace.browseBooks')}
                                >
                                    <BookOpenIcon className="h-5 w-5" />
                                </button>
                            </div>
                        )}
                        {isEditing && quickRefError && <p className="text-xs text-red-500 mt-1">{quickRefError}</p>}

                        {showRefPicker && (
                            <div className="mt-2 relative">
                                <ScriptureRefPicker
                                    mode="add"
                                    onConfirm={(ref) => { setScriptureRefs(prev => [...prev, { ...ref, id: makeId() }]); setShowRefPicker(false); }}
                                    onCancel={() => setShowRefPicker(false)}
                                />
                            </div>
                        )}

                        {editingRefIndex !== null && (
                            <div className="mt-2 relative">
                                <ScriptureRefPicker
                                    mode="edit"
                                    initialRef={scriptureRefs[editingRefIndex]}
                                    onConfirm={(ref) => {
                                        setScriptureRefs(prev => {
                                            const r = [...prev]; r[editingRefIndex] = { ...ref, id: r[editingRefIndex].id }; return r;
                                        });
                                        setEditingRefIndex(null);
                                    }}
                                    onCancel={() => setEditingRefIndex(null)}
                                />
                            </div>
                        )}
                    </div>

                    {/* Tags */}
                    <div className="flex flex-col h-full space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.tags')}>
                            <TagIcon className="h-5 w-5" />
                        </div>

                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {tags.map(tag => (
                                    <span key={tag} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                                        {tag}
                                        {isEditing && (
                                            <button onClick={() => toggleTag(tag)} className="hover:text-emerald-900 dark:hover:text-emerald-100 ml-1">
                                                <XMarkIcon className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </span>
                                ))}
                            </div>
                        )}

                        {isEditing && (
                            <div className="flex items-center gap-2 mt-auto pt-2">
                                <input
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                                    placeholder={t('studiesWorkspace.addTag')}
                                    className={`flex-1 ${STUDIES_INPUT_SHARED_CLASSES} py-1.5`}
                                />
                                <button onClick={addTag} className="p-1.5 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors dark:text-gray-400 dark:hover:bg-gray-800">
                                    <PlusIcon className="h-5 w-5" />
                                </button>
                                <button onClick={() => setShowTagCatalog(true)} className="p-1.5 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors dark:text-gray-400 dark:hover:bg-gray-800" title={t('studiesWorkspace.browseTags', { defaultValue: 'Browse tags' })}>
                                    <MagnifyingGlassIcon className="h-5 w-5" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            <TagCatalogModal
                isOpen={showTagCatalog}
                onClose={() => setShowTagCatalog(false)}
                availableTags={availableTags}
                selectedTags={tags}
                onToggleTag={toggleTag}
            />
        </div>
    );
}
