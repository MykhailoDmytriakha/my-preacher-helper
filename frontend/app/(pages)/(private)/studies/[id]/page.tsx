'use client';

import { ArrowLeftIcon, ArrowPathIcon, CheckCircleIcon, SparklesIcon, TagIcon, BookmarkIcon, PlusIcon, BookOpenIcon, XMarkIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, QuestionMarkCircleIcon, PencilIcon, TrashIcon, CheckIcon, EllipsisVerticalIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { FocusRecorderButton } from '@/components/FocusRecorderButton';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useClipboard } from '@/hooks/useClipboard';
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useDurableDraft } from '@/hooks/useDurableDraft';
import { useMarkdownOutline } from '@/hooks/useMarkdownOutline';
import { useRouteId } from '@/hooks/useRouteId';
import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { useStickyOffsets } from '@/hooks/useStickyOffsets';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useTags } from '@/hooks/useTags';
import { useWideViewport } from '@/hooks/useWideViewport';
import { ScriptureReference, StudyNote } from '@/models/models';
import { readRevision } from '@/services/conflictSafeUpdate.client';
import { auth } from '@/services/firebaseAuth.service';
import { NOTE_AGGREGATE } from '@/services/studies.service';
import { getStudyNoteShareLinks } from '@/services/studyNoteShareLinks.service';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { apiClient } from '@/utils/apiClient';
import { deleteRecordingDraft, saveRecordingDraft } from '@/utils/recordingDraftStore';
import { awaitAcceptance } from '@/utils/recoverableWrite';
import { formatStudyNoteForCopy } from '@/utils/studyNoteUtils';
import { buildTranscriptionErrorMessage, transcribeAudioWithRetry, TranscriptionClientError } from '@/utils/transcriptionRetryClient';
import HighlightedText from '@components/HighlightedText';

import AnalysisConfirmationModal, { AnalysisResultData } from '../AnalysisConfirmationModal';
import { BibleLocale, getLocalizedBookName } from '../bibleData';
import SermonsBuiltOnNote from '../components/SermonsBuiltOnNote';
import { STUDIES_INPUT_SHARED_CLASSES } from '../constants';
import { parseReferenceText } from '../referenceParser';
import ScriptureRefBadge from '../ScriptureRefBadge';
import ScriptureRefPicker from '../ScriptureRefPicker';
import TagCatalogModal from '../TagCatalogModal';

import { NoteAiMenu } from './NoteAiMenu';
import { type NoteDraftPayload } from './noteDraft';
import { NoteSidePanel } from './NoteSidePanel';
import { useNoteAutoSave } from './useNoteAutoSave';

const makeId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

function useFilteredNotes(notes: StudyNote[], searchParams: URLSearchParams, bibleLocale: BibleLocale) {
    const noteId = useRouteId();

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

/** Value equality for draft-vs-editor comparison; field order is fixed by construction. */
function sameNoteDraft(a: NoteDraftPayload, b: NoteDraftPayload): boolean {
    return (
        a.title === b.title &&
        a.content === b.content &&
        a.type === b.type &&
        JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
        JSON.stringify(a.scriptureRefs) === JSON.stringify(b.scriptureRefs)
    );
}

function useNoteInitialization({
    notesLoading, uid, isNew, isInitialized, existingNote, t,
    setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved
}: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
    useEffect(() => {
        if (notesLoading || !uid) return;

        if (isNew && !isInitialized) {
            setTitle('');
            setContent('');
            setTags([]);
            setScriptureRefs([]);
            setType('note');
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
    }, [notesLoading, isNew, existingNote, isInitialized, uid, t, setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useNoteDeletion({ t, noteId, isNew, uid, deleteNote, shareLinks, deleteShareLink, router }: any) {
    return async () => {
        if (window.confirm(t('studiesWorkspace.deleteConfirm'))) {
            if (noteId && !isNew && uid) {
                try {
                    // useStudyNotes' delete recovery descriptor reports a late refusal while this screen is mounted.
                    await awaitAcceptance(deleteNote(noteId), () => undefined);
                    // The link removal is a write too, so it must go back through the
                    // share-link hook and its recovery descriptor — never directly to
                    // the service. Prefer the live cache; a just-opened detail page
                    // may not have it yet, so read once before deciding there is none.
                    let link = shareLinks.find((entry: { noteId: string }) => entry.noteId === noteId);
                    if (!link) {
                        try {
                            link = (await getStudyNoteShareLinks(uid)).find((entry) => entry.noteId === noteId);
                        } catch (linkLookupError) {
                            console.error('Error finding share link for deleted note', linkLookupError);
                        }
                    }
                    // useStudyNoteShareLinks' delete recovery descriptor reports a late refusal while this screen is mounted.
                    if (link) await awaitAcceptance(deleteShareLink(link.id), () => undefined);
                } catch (e) {
                    /**
                     * The note and share-link descriptors report this refusal — one
                     * refusal, one reporter. Staying on the page is what this handler
                     * owes the person: a refused delete must not navigate away as if it
                     * had succeeded.
                     */
                    console.error('Error deleting note', e);
                    return;
                }
            }
            router.push('/studies');
        }
    };
}


function useNoteAIAssistant({
    noteId, content, availableTags, setTitle, setContent, setScriptureRefs, setTags, t
}: {
    noteId: string;
    content: string; availableTags: string[];
    setTitle: (t: string) => void; setContent: (c: string | ((prev: string) => string)) => void;
    setScriptureRefs: (refs: ScriptureReference[] | ((prev: ScriptureReference[]) => ScriptureReference[])) => void; setTags: (tags: string[] | ((prev: string[]) => string[])) => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    const { aiBlocked, transcriptionBlocked, refresh: refreshAiUsage } = useAiUsage();
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
    // Voice recovery: keep the recording alive so a failed transcription never loses the thought.
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [voiceRetryCount, setVoiceRetryCount] = useState(0);
    const storedVoiceBlobRef = useRef<Blob | null>(null);
    const voiceDraftIdRef = useRef<string | null>(null);
    const VOICE_MAX_RETRIES = 3;

    const [pendingAnalysisResult, setPendingAnalysisResult] = useState<AnalysisResultData | null>(null);

    const handleAIAnalyze = async (analysisType: 'all' | 'title' | 'tags' | 'scriptureRefs' = 'all') => {
        if (aiBlocked) return;
        if (!content.trim()) {
            toast.error(t('studiesWorkspace.aiAnalyze.emptyContent') || 'Please enter note content');
            return;
        }

        setIsAnalyzing(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const response = await apiClient('/api/studies/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    content,
                    existingTags: availableTags,
                    analysisType,
                    studyId: noteId,
                }),
                category: 'ai',
            });
            const result = await response.json();

            if (!result.success || !result.data) {
                throw new Error(result.error);
            }

            const aiResult = result.data;
            let hasAnyResult = false;

            // Check if AI actually returned anything based on what we requested
            if ((analysisType === 'all' || analysisType === 'title') && aiResult.title) hasAnyResult = true;
            if ((analysisType === 'all' || analysisType === 'tags') && aiResult.tags?.length > 0) hasAnyResult = true;
            if ((analysisType === 'all' || analysisType === 'scriptureRefs') && aiResult.scriptureRefs?.length > 0) hasAnyResult = true;

            if (hasAnyResult) {
                setPendingAnalysisResult(aiResult);
                toast.success(t('studiesWorkspace.aiAnalyze.success') || 'Analysis complete. Please review suggestions.');
            } else {
                toast.info(t('studiesWorkspace.aiAnalyze.noResults') || 'No useful suggestions found for this content.');
            }
            await refreshAiUsage();

        } catch (error) {
            if (isUsageCapReachedError(error)) return;
            toast.error(t('studiesWorkspace.aiAnalyze.error') || 'Failed to analyze');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleApplyAnalysis = (data: AnalysisResultData) => {
        if (data.title) setTitle(data.title);

        if (data.scriptureRefs && data.scriptureRefs.length > 0) {
            setScriptureRefs((prev: ScriptureReference[]) => {
                const newRefs = data.scriptureRefs!.filter((nr: ScriptureReference) =>
                    !prev.some((er: ScriptureReference) => er.book === nr.book && er.chapter === nr.chapter && er.fromVerse === nr.fromVerse)
                ).map((ref: Omit<ScriptureReference, 'id'>) => ({ ...ref, id: makeId() }));
                return [...prev, ...newRefs];
            });
        }

        if (data.tags && data.tags.length > 0) {
            setTags((prev: string[]) => Array.from(new Set([...prev, ...data.tags!])));
        }
    };

    const runVoiceTranscription = useCallback(async (
        audioBlob: Blob,
        opts?: { persistOnFailure?: boolean }
    ): Promise<boolean> => {
        setIsVoiceProcessing(true);
        setVoiceError(null);
        try {
            const result = await transcribeAudioWithRetry(audioBlob, { endpoint: '/api/studies/transcribe' });
            const newText = result.polishedText || result.originalText;
            if (newText) setContent((prev: string) => (prev ? `${prev}\n\n${newText}` : newText));
            await refreshAiUsage();
            // Success — the thought is now saved as text; drop the safety copy + persisted draft.
            storedVoiceBlobRef.current = null;
            setVoiceError(null);
            setVoiceRetryCount(0);
            if (voiceDraftIdRef.current) {
                void deleteRecordingDraft(voiceDraftIdRef.current);
                voiceDraftIdRef.current = null;
            }
            return true;
        } catch (err) {
            if (isUsageCapReachedError(err)) {
                setIsVoiceProcessing(false);
                return false;
            }

            // Never lose the thought: keep the recording (in-session recovery panel)
            // AND persist it to IndexedDB so it survives a reload / tab close.
            storedVoiceBlobRef.current = audioBlob;
            const message = err instanceof TranscriptionClientError
                ? buildTranscriptionErrorMessage(err, t)
                : (t('errors.audioProcessing') || 'Voice transcription failed');
            setVoiceError(message);
            // A resend of an already-persisted draft passes persistOnFailure:false to avoid duplicates.
            // Skip persistence for a brand-new note ('new'): its contextId would collide across every
            // unsaved note, and the draft becomes unreachable once the real id is assigned.
            if (opts?.persistOnFailure !== false && noteId !== 'new') {
                try {
                    voiceDraftIdRef.current = await saveRecordingDraft({
                        blob: audioBlob,
                        mimeType: audioBlob.type || 'audio/webm',
                        context: 'study',
                        contextId: noteId,
                        ...(voiceDraftIdRef.current ? { id: voiceDraftIdRef.current } : {}),
                    });
                } catch {
                    // IndexedDB unavailable — the in-session recovery panel still protects the thought.
                }
            }
            return false;
        } finally {
            setIsVoiceProcessing(false);
        }
    }, [refreshAiUsage, setContent, t, noteId]);

    const handleVoiceRecordingComplete = useCallback((audioBlob: Blob) => {
        setVoiceRetryCount(0);
        void runVoiceTranscription(audioBlob);
    }, [runVoiceTranscription]);

    // Resend a persisted draft (from a previous session). Returns success so the
    // banner can drop the draft once the thought is finally transcribed. On failure the
    // FocusRecorderButton panel isn't mounted (no in-session blob), so surface a toast —
    // never let a failed resend look silent while the draft quietly stays put. (Popper Minor 8.)
    const resendVoiceBlob = useCallback(async (blob: Blob) => {
        const ok = await runVoiceTranscription(blob, { persistOnFailure: false });
        if (!ok) {
            toast.error(t('audio.transcribeError.unknown', { defaultValue: 'Transcription failed. Please try again.' }));
        }
        return ok;
    }, [runVoiceTranscription, t]);

    const handleRetryVoice = useCallback(() => {
        const blob = storedVoiceBlobRef.current;
        if (!blob) return;
        setVoiceRetryCount((count) => count + 1);
        void runVoiceTranscription(blob);
    }, [runVoiceTranscription]);

    const handleClearVoiceError = useCallback(() => {
        storedVoiceBlobRef.current = null;
        setVoiceError(null);
        setVoiceRetryCount(0);
        if (voiceDraftIdRef.current) {
            void deleteRecordingDraft(voiceDraftIdRef.current);
            voiceDraftIdRef.current = null;
        }
    }, []);

    return {
        isAnalyzing, isVoiceProcessing, aiBlocked, transcriptionBlocked, handleAIAnalyze, handleVoiceRecordingComplete,
        voiceError, voiceRetryCount, voiceMaxRetries: VOICE_MAX_RETRIES, handleRetryVoice, handleClearVoiceError,
        resendVoiceBlob,
        pendingAnalysisResult, setPendingAnalysisResult, handleApplyAnalysis
    };
}

/**
 * A short title should read like a title; a long one must still fit the bar on one or
 * two lines. Stepping the size by length beats measuring: it is stable, has no layout
 * pass, and never lands between two sizes on a resize.
 */
function titleSizeClass(title: string): string {
    const length = (title || '').length;
    if (length <= 24) return 'text-2xl';
    if (length <= 40) return 'text-xl';
    if (length <= 64) return 'text-lg';
    if (length <= 100) return 'text-base';
    return 'text-sm';
}

function EditorHeader({
    handleBack, t, isEditing, filteredNotes, prevNoteId, nextNoteId, router, searchParams,
    currentIndex, type, setType, isSaving, saveError, lastSaved, hasUnsavedEdits, setIsEditing, handleDelete, handleCopy, isCopied,
    title, setTitle, searchQuery, justSaved, aiMenu, headerRef, stickyTop
}: {
    handleBack: () => void; t: ReturnType<typeof useTranslation>['t']; isEditing: boolean;
    filteredNotes: StudyNote[]; prevNoteId: string | null; nextNoteId: string | null;
    router: ReturnType<typeof useRouter>; searchParams: ReturnType<typeof useSearchParams>;
    currentIndex: number; type: 'note' | 'question'; setType: (t: 'note' | 'question') => void;
    isSaving: boolean; saveError: string | null; lastSaved: Date | null;
    /** The text on screen differs from what the server last confirmed. */
    hasUnsavedEdits: boolean;
    setIsEditing: (b: boolean) => void; handleDelete: () => void; handleCopy: () => void; isCopied: boolean;
    /** The note's title lives here now, not as a display-size heading above the text. */
    title: string; setTitle: (v: string) => void; searchQuery: string;
    /** Reading mode has nothing to save, so the status only shows while editing — plus a
        short confirmation right after leaving the editor, which is the moment it matters. */
    justSaved: boolean; aiMenu: React.ReactNode;
    /** Measured, not assumed: the app nav is a different height on a phone. */
    headerRef: (element: HTMLElement | null) => void; stickyTop: number;
}) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const copyLabel = isCopied ? t('common.copied') || 'Copied!' : t('common.copy') || 'Copy';

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
        <header
            ref={headerRef}
            style={{ top: stickyTop }}
            className="sticky z-30 relative flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-200 bg-white/90 px-4 sm:px-6 py-3 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90"
        >
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

                <EditorHeaderTypeControl
                    isEditing={isEditing}
                    type={type}
                    setType={setType}
                    t={t}
                />
            </div>

            {/* The note's title. In reading mode it is a line of text; in editing it is the
                field you type in. Either way it stays on this row instead of taking a
                display-size block above the text. */}
            <div className="order-last w-full min-w-0 px-0 sm:order-none sm:absolute sm:left-1/2 sm:top-1/2 sm:w-[44%] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:px-0">
                {isEditing ? (
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('studiesWorkspace.titlePlaceholder') || 'Note Title...'}
                        aria-label={t('studiesWorkspace.titlePlaceholder') || 'Note Title...'}
                        className={`w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-center font-bold text-gray-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-50 dark:focus:border-emerald-500 dark:focus:ring-emerald-900 ${titleSizeClass(title)}`}
                    />
                ) : (
                    <h1
                        className={`line-clamp-2 text-center font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-50 ${titleSizeClass(title)}`}
                        title={title || undefined}
                    >
                        {title ? (
                            searchQuery ? <HighlightedText text={title} searchQuery={searchQuery} /> : title
                        ) : (
                            t('studiesWorkspace.untitled')
                        )}
                    </h1>
                )}
            </div>

            {/* Sync Status Info */}
            <div className="flex items-center gap-3">
                {isEditing && aiMenu}
                <div className={`text-sm flex items-center gap-1.5 text-gray-500 dark:text-gray-400 ${isEditing || justSaved ? '' : 'hidden'}`}>
                    {isSaving ? (
                        <><ArrowPathIcon className="h-4 w-4 animate-spin" /> <span>{t('common.saving') || 'Saving...'}</span></>
                    ) : saveError ? (
                        <span className="text-red-500">{t(saveError)}</span>
                    ) : lastSaved && !hasUnsavedEdits ? (
                        /* "Saved" means THIS text is on the server — not "a save happened once".
                           Found in the browser: the tick stayed up while newer keystrokes sat
                           unsent, which is the one claim this whole migration exists to stop
                           the app from making. */
                        <><CheckCircleIcon className="h-4 w-4 text-emerald-500" /> <span className="hidden sm:inline">{t('common.saved') || 'Saved'}</span></>
                    ) : null}
                </div>

                {!isEditing && (
                    <button
                        type="button"
                        onClick={handleCopy}
                        className={`inline-flex items-center justify-center rounded-lg p-2 text-sm font-medium transition-colors ${isCopied
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-gray-100'
                            }`}
                        title={copyLabel}
                        aria-label={copyLabel}
                    >
                        {isCopied ? <CheckIcon className="h-5 w-5" /> : <DocumentDuplicateIcon className="h-5 w-5" />}
                    </button>
                )}

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
                                onClick={() => {
                                    setShowMenu(false);
                                    setTimeout(() => handleDelete(), 10);
                                }}
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

function EditorHeaderTypeControl({
    isEditing,
    type,
    setType,
    t,
}: {
    isEditing: boolean;
    type: 'note' | 'question';
    setType: (t: 'note' | 'question') => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    if (isEditing) {
        return (
            <div className="flex flex-col">
                <div className="flex items-center gap-2">
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
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2">
                {type === 'question' ? (
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
    );
}

const NOTE_PANEL_STORAGE_KEY = 'studyNote.sidePanelCollapsed';

/** Creation and last-edit dates. Metadata, so it sits with the rest of the metadata. */
function NoteDates({ note, t }: { note: StudyNote; t: ReturnType<typeof useTranslation>['t'] }) {
    const created = new Date(note.createdAt);
    const updated = new Date(note.updatedAt);
    const format = (d: Date) => (Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString());
    return (
        <>
            <div>{t('notePanel.created', { date: format(created) })}</div>
            {format(updated) !== format(created) && (
                <div>{t('notePanel.updated', { date: format(updated) })}</div>
            )}
        </>
    );
}


export default function StudyNoteEditorPage() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const routeId = useRouteId();
    const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
    const noteId = createdNoteId || routeId;
    const isNew = noteId === 'new';

    const { uid, notes, createNote, updateNote, deleteNote, loading: notesLoading } = useStudyNotes();
    const { shareLinks, deleteShareLink } = useStudyNoteShareLinks();

    const { tags: tagData } = useTags(uid);
    const { isCopied, copyToClipboard } = useClipboard({ successDuration: 1500 });

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

    /**
     * What this editor last knew to be the truth: the note as loaded, then whatever
     * a save confirmed. This — NOT the live cache — is the baseline for "did the
     * user change this field?". Diffing against the cache destroys data: a tab whose
     * cache refreshed but whose inputs did not would read its own untouched field as
     * a deliberate change and overwrite the other device. Reproduced live.
     * Keyed by document, because moving between notes re-renders WITHOUT unmounting.
     */
    /**
     * Revision this editor's text is built from. Fed by the listener (server truth)
     * and by each accepted save. `null` means "not established yet" — then the save
     * runs unguarded, exactly as before, instead of guessing.
     */
    const serverRevisionRef = useRef<number | null>(null);
    /** Latest revision the SERVER holds. Adopted only when the text is adopted. */
    const remoteRevisionRef = useRef<number | null>(null);
    const [saveConflict, setSaveConflict] = useState(false);
    /**
     * Bumped when the person insists on their text after a refusal. Without it the
     * banner would close and nothing would be sent until the next keystroke — the
     * same silence this whole effort is against.
     */
    const [resaveNonce, setResaveNonce] = useState(0);
    /** Set by "keep my text", cleared once that send has been made. */
    const deliberateOverwriteRef = useRef(false);

    // Establish the revision from the LOADED NOTE, not only from the listener. A
    // save that fired before the first server snapshot used to go out unguarded,
    // which is exactly how a stale tab overwrote a newer one in the two-tab test.
    if (existingNote && serverRevisionRef.current === null) {
        serverRevisionRef.current = existingNote.rev?.[NOTE_AGGREGATE] ?? 0;
    }

    const baselineRef = useRef<NoteDraftPayload | null>(null);
    const baselineNoteIdRef = useRef<string | null>(null);
    /**
     * The same baseline as `baselineRef`, but as STATE. A ref cannot drive what the screen
     * says: the "saved" tick is derived from this comparison, and with a ref alone it never
     * recomputed after a save landed — the tick went out and stayed out. Both exist because
     * the autosave loop needs the ref (it reads it mid-flight, without re-rendering).
     */
    const [confirmedDraft, setConfirmedDraft] = useState<NoteDraftPayload | null>(null);
    if (isInitialized && baselineNoteIdRef.current !== noteId) {
        baselineNoteIdRef.current = noteId;
        baselineRef.current = { title, content, tags, scriptureRefs, type };
    }
    useEffect(() => {
        if (isInitialized) setConfirmedDraft(baselineRef.current);
    }, [isInitialized, noteId]);

    // Everything the editor owns, in one value — this is what the durable draft
    // stores and what a successful save confirms.
    const draftPayload: NoteDraftPayload = useMemo(
        () => ({ title, content, tags, scriptureRefs, type }),
        [title, content, tags, scriptureRefs, type]
    );

    const { recovered, acceptRecovered, discardRecovered, markSaved } = useDurableDraft<NoteDraftPayload>({
        uid,
        docId: noteId,
        aggregate: 'note',
        value: draftPayload,
        enabled: isInitialized,
    });

    const { isSaving, lastSaved, saveError, setLastSaved } = useNoteAutoSave({
        noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type,
        updateNote, createNote, uid, setCreatedNoteId, t, baselineRef,
        revisionRef: serverRevisionRef,
        deliberateOverwriteRef,
        resaveNonce,
        saveBlocked: saveConflict,
        onConflict: () => setSaveConflict(true),
        onSaved: (saved) => {
            markSaved(saved);
            // This text IS the server's now, so the tick may come back.
            setConfirmedDraft(saved);
        }
    });

    // A draft is only worth surfacing when it actually differs from what the
    // editor is showing. Identical text means the last save did land and the
    // draft is simply the same thing said twice.
    const unsavedRecovery = useMemo(
        () => (recovered && !sameNoteDraft(recovered, draftPayload) ? recovered : null),
        [recovered, draftPayload]
    );

    // Does the server hold something newer than what this editor is showing? The
    // baseline is what we last knew to be stored, so our own saves do not trip it.
    const knownServerValue = useMemo<NoteDraftPayload | null>(
        () =>
            existingNote
                ? {
                      title: existingNote.title || '',
                      content: existingNote.content || '',
                      tags: existingNote.tags || [],
                      scriptureRefs: existingNote.scriptureRefs || [],
                      type: existingNote.type || 'note',
                  }
                : null,
        [existingNote]
    );

    const freshness = useDocumentFreshness<NoteDraftPayload>({
        collection: 'studyNotes',
        docId: isNew ? null : noteId,
        uid,
        enabled: isInitialized && !isNew,
        known: knownServerValue,
        select: (data) => {
            // ⚠️ This is the REMOTE revision, deliberately kept apart from the one a
            // save states. Letting a snapshot advance the save revision was a hole:
            // the listener moved the number forward while the editor still showed
            // the OLD text, so stale text was saved WITH a fresh revision and the
            // guard waved it through — destroying the newer version it exists to
            // protect. The save revision only advances when the displayed text
            // advances with it (applyRemote) or when a save is confirmed.
            remoteRevisionRef.current = readRevision(data as Record<string, unknown>, NOTE_AGGREGATE);
            return {
                title: (data.title as string) || '',
                content: (data.content as string) || '',
                tags: (data.tags as string[]) || [],
                scriptureRefs: (data.scriptureRefs as ScriptureReference[]) || [],
                type: (data.type as 'note' | 'question') || 'note',
            };
        },
    });

    const [freshnessDismissed, setFreshnessDismissed] = useState(false);
    useEffect(() => {
        // A new remote change re-arms the banner after a previous dismissal.
        if (freshness.state === 'stale' || freshness.state === 'unknown') setFreshnessDismissed(false);
    }, [freshness.remote, freshness.state]);

    const editorIsDirty = useMemo(
        () => (confirmedDraft ? !sameNoteDraft(confirmedDraft, draftPayload) : false),
        [confirmedDraft, draftPayload]
    );

    const applyRemote = useCallback(() => {
        const next = freshness.remote;
        if (!next) return;
        setTitle(next.title);
        setContent(next.content);
        setTags(next.tags);
        setScriptureRefs(next.scriptureRefs);
        setType(next.type);
        baselineRef.current = next;
        setConfirmedDraft(next);
        // Text and revision move together — that is the whole invariant.
        if (remoteRevisionRef.current !== null) serverRevisionRef.current = remoteRevisionRef.current;
        freshness.markSynced(next);
    }, [freshness]);

    const applyRecovered = useCallback(() => {
        if (!unsavedRecovery) return;
        setTitle(unsavedRecovery.title);
        setContent(unsavedRecovery.content);
        setTags(unsavedRecovery.tags);
        setScriptureRefs(unsavedRecovery.scriptureRefs);
        setType(unsavedRecovery.type);
        // Hide the offer but KEEP the stored copy: this text is still unconfirmed
        // until a save lands. Deleting it here would leave a window with no durable
        // copy at all.
        acceptRecovered();
    }, [unsavedRecovery, acceptRecovered]);

    const isWideViewport = useWideViewport();
    // Remembered per device: hiding the panel is a deliberate choice about how you read,
    // not a click to undo on every visit.
    const [panelCollapsed, setPanelCollapsed] = useState(false);
    useEffect(() => {
        try {
            setPanelCollapsed(window.localStorage.getItem(NOTE_PANEL_STORAGE_KEY) === '1');
        } catch {
            /* private mode / blocked storage: the panel simply starts open */
        }
    }, []);
    const togglePanel = useCallback(() => {
        setPanelCollapsed((collapsed) => {
            const next = !collapsed;
            try {
                window.localStorage.setItem(NOTE_PANEL_STORAGE_KEY, next ? '1' : '0');
            } catch {
                /* not being able to remember is not a reason to refuse the toggle */
            }
            return next;
        });
    }, []);

    // One tree of headings for both the text and the side panel, so folding a section
    // in one folds it in the other.
    const { setHeaderRef, navHeight, belowHeader } = useStickyOffsets();

    const outlineControl = useMarkdownOutline(content, searchQuery);
    const showPanel = isWideViewport && !panelCollapsed;
    const activeSectionId = useActiveSection(belowHeader + 16, showPanel && !isEditing);
    const { sermons: sermonsOnNote } = useSermonsBuiltOnNote(isNew ? undefined : noteId);

    // Reading mode has nothing to save, so the save status is hidden there — except for
    // a few seconds right after leaving the editor, which is exactly when the person
    // wants to know the text landed.
    const [justSaved, setJustSaved] = useState(false);
    const wasEditingRef = useRef(false);
    useEffect(() => {
        const leftTheEditor = wasEditingRef.current && !isEditing;
        wasEditingRef.current = isEditing;
        if (!leftTheEditor) return;
        setJustSaved(true);
        const timer = setTimeout(() => setJustSaved(false), 2500);
        return () => clearTimeout(timer);
    }, [isEditing]);

    // AI assistant hook
    const {
        isAnalyzing, isVoiceProcessing, aiBlocked, transcriptionBlocked, handleAIAnalyze, handleVoiceRecordingComplete,
        voiceError, voiceRetryCount, voiceMaxRetries, handleRetryVoice, handleClearVoiceError,
        resendVoiceBlob,
        pendingAnalysisResult, setPendingAnalysisResult, handleApplyAnalysis
    } = useNoteAIAssistant({
        noteId, content, availableTags, setTitle, setContent, setScriptureRefs, setTags, t
    });

    useNoteInitialization({
        notesLoading, uid, isNew, isInitialized, existingNote, t,
        setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved
    });

    // ─── HANDLERS ─────────────────────────────────────────────────────────

    const handleBack = () => {
        const queryParams = searchParams.toString();
        router.push(queryParams ? `/studies?${queryParams}` : '/studies');
    };

    const handleDelete = useNoteDeletion({
        t,
        noteId,
        isNew,
        uid,
        deleteNote,
        shareLinks,
        deleteShareLink,
        router,
    });
    const handleCopy = useCallback(() => {
        void copyToClipboard(
            formatStudyNoteForCopy({
                id: noteId,
                title,
                content,
                tags,
                scriptureRefs,
                type,
                userId: existingNote?.userId ?? uid ?? '',
                materialIds: existingNote?.materialIds ?? [],
                relatedSermonIds: existingNote?.relatedSermonIds ?? [],
                createdAt: existingNote?.createdAt ?? new Date().toISOString(),
                updatedAt: existingNote?.updatedAt ?? new Date().toISOString(),
                isDraft: existingNote?.isDraft ?? false,
            }, bibleLocale)
        );
    }, [bibleLocale, content, copyToClipboard, existingNote, noteId, scriptureRefs, tags, title, type, uid]);

    const addTag = () => {
        const value = tagInput.trim();
        if (!value) return;
        setTags((prev) => Array.from(new Set([...prev, value])));
        setTagInput('');
    };

    const toggleTag = (tag: string) => {
        setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    };

    // The note's own properties. They are ONE instance, handed either to the side
    // panel or to the narrow-screen tray below the text — never both, because each
    // carries live inputs and pickers.
    const scriptureRefsBlock = (
        <>
                    {/* References */}
                    <div className="flex flex-col h-full space-y-4 group/refs">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.scriptureRefs')}>
                                <BookmarkIcon className="h-5 w-5" />
                                <span className="text-sm font-medium">{t('studiesWorkspace.scriptureRefs')}</span>
                            </div>
                            {isEditing && (
                                <button
                                    type="button"
                                    onClick={() => handleAIAnalyze('scriptureRefs')}
                                    disabled={isAnalyzing || !content.trim() || aiBlocked}
                                    title={aiBlocked ? t('settings.usage.aiUsageExhausted') : t('studiesWorkspace.aiAnalyze.findRefs', { defaultValue: 'Find Scripture Refs' })}
                                    className="flex items-center justify-center rounded-lg p-1.5 opacity-0 transition-opacity group-hover/refs:opacity-100 focus-visible:opacity-100 text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                                >
                                    <SparklesIcon className="h-5 w-5" />
                                </button>
                            )}
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
                            <ScriptureRefPicker
                                mode="add"
                                onConfirm={(ref) => { setScriptureRefs(prev => [...prev, { ...ref, id: makeId() }]); setShowRefPicker(false); }}
                                onCancel={() => setShowRefPicker(false)}
                            />
                        )}

                        {editingRefIndex !== null && (
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
                        )}
                    </div>
        </>
    );

    const tagsBlock = (
        <>
                    {/* Tags */}
                    <div className="flex flex-col h-full space-y-4 group/tags">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500" title={t('studiesWorkspace.tags')}>
                                <TagIcon className="h-5 w-5" />
                                <span className="text-sm font-medium">{t('studiesWorkspace.tags')}</span>
                            </div>
                            {isEditing && (
                                <button
                                    type="button"
                                    onClick={() => handleAIAnalyze('tags')}
                                    disabled={isAnalyzing || !content.trim() || aiBlocked}
                                    title={aiBlocked ? t('settings.usage.aiUsageExhausted') : t('studiesWorkspace.aiAnalyze.generateTags', { defaultValue: 'Generate Tags' })}
                                    className="flex items-center justify-center rounded-lg p-1.5 opacity-0 transition-opacity group-hover/tags:opacity-100 focus-visible:opacity-100 text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                                >
                                    <SparklesIcon className="h-5 w-5" />
                                </button>
                            )}
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
        </>
    );

    const sermonsBlock = (
        <>
                    {/* What was preached out of this note — derived from the sermons that name
                        it, so there is nothing to keep in step. Renders only when there is one. */}
                    <SermonsBuiltOnNote noteId={isNew ? undefined : noteId} />
        </>
    );

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
                lastSaved={lastSaved} hasUnsavedEdits={editorIsDirty} setIsEditing={setIsEditing} handleDelete={handleDelete}
                handleCopy={handleCopy} isCopied={isCopied}
                headerRef={setHeaderRef} stickyTop={navHeight}
                title={title} setTitle={setTitle} searchQuery={searchQuery} justSaved={justSaved}
                aiMenu={
                    <NoteAiMenu
                        onAnalyze={handleAIAnalyze}
                        isAnalyzing={isAnalyzing}
                        disabled={isAnalyzing || !content.trim() || aiBlocked}
                        blockedTitle={aiBlocked ? t('settings.usage.aiUsageExhausted') : undefined}
                    />
                }
            />

            {/* EDITOR CONTENT */}
            <div className="flex flex-1 min-h-0">
                {/* Everything about the note that is not its text. Rendered ONLY on wide
                    screens — on a phone the same blocks stay where they are today, under
                    the text, so nothing becomes unreachable. */}
                {isWideViewport && (
                    <NoteSidePanel
                        outline={outlineControl}
                        foldable={!isEditing}
                        stickyTop={belowHeader}
                        activeSectionId={activeSectionId}
                        collapsed={panelCollapsed}
                        onToggleCollapsed={togglePanel}
                        hasSermons={sermonsOnNote.length > 0}
                        meta={existingNote ? <NoteDates note={existingNote} t={t} /> : undefined}
                        scriptureRefs={scriptureRefsBlock}
                        tags={tagsBlock}
                        sermons={sermonsBlock}
                    />
                )}

                {/* No `overflow` here on purpose: it would become the scroll container that
                    `position: sticky` measures against, and the editor toolbar would slide
                    out of view instead of sticking. The window does the scrolling. */}
                <div className="flex-1 min-w-0 px-4 py-8 md:px-8 md:py-10 pb-48 md:pb-32">
                  <div className="mx-auto w-full space-y-8">
                {/* A returning user's unfinished recording waits here — survives reload / tab close. */}
                {isEditing && (
                    <RecordingDraftBanner
                        context="study"
                        contextId={noteId}
                        onResend={resendVoiceBlob}
                        isProcessing={isVoiceProcessing}
                        className="mb-2"
                    />
                )}
                {/* The server REFUSED a stale save. This is not an error message —
                    the text is still here and in the durable draft; the person picks. */}
                {saveConflict && (
                    <SaveConflictBanner
                        entityKey="entityNote"
                        // No `pendingText`: unlike the sermon header, this editor stays
                        // open and still shows the refused text.
                        onKeepMine={() => {
                            // Adopt the server's CURRENT revision: the person has seen
                            // the conflict and chose their text, so this is a DELIBERATE
                            // overwrite, not a stale one. Without it the resend carries
                            // the same old revision and is refused again — a button that
                            // promises an action it never performs.
                            if (remoteRevisionRef.current !== null) {
                                serverRevisionRef.current = remoteRevisionRef.current;
                            }
                            // And say plainly that this one send is deliberate, or the
                            // content check refuses it again and the button never works.
                            deliberateOverwriteRef.current = true;
                            setSaveConflict(false);
                            setResaveNonce((n) => n + 1);
                        }}
                        onTakeTheirs={() => {
                            applyRemote();
                            setSaveConflict(false);
                        }}
                        className="mb-2"
                    />
                )}
                {/* The RECORD changed elsewhere. Distinct from the app-update toast,
                    and it never replaces what is on screen without a decision. */}
                {!saveConflict && (freshness.state === 'stale' || freshness.state === 'unknown') && !freshnessDismissed && (
                    <DataFreshnessBanner
          entityKey="entityNote"
                        dirty={editorIsDirty}
                        deleted={freshness.remotelyDeleted}
          unknown={freshness.state === 'unknown'}
                        onRefresh={editorIsDirty ? undefined : applyRemote}
                        onDismiss={() => setFreshnessDismissed(true)}
                        className="mb-2"
                    />
                )}
                {/* Text that was typed but never confirmed saved — a closed tab, a
                    crash or a failed write. Offered, never applied silently: a stale
                    draft must not overwrite text edited later on another device. */}
                {unsavedRecovery && (
                    <div className="mb-2 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <p className="font-medium text-amber-900 dark:text-amber-200">
                                {t('unsavedDraft.title')}
                            </p>
                            <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
                                {t('unsavedDraft.description')}
                            </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <button
                                type="button"
                                onClick={applyRecovered}
                                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700"
                            >
                                {t('unsavedDraft.restore')}
                            </button>
                            <button
                                type="button"
                                onClick={discardRecovered}
                                className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
                            >
                                {t('unsavedDraft.discard')}
                            </button>
                        </div>
                    </div>
                )}
                <div className="relative group">
                    {isEditing ? (
                        <div className="text-lg md:text-xl leading-relaxed">
                            <RichMarkdownEditor
                                value={content}
                                onChange={setContent}
                                placeholder={t('studiesWorkspace.contentPlaceholder') || 'Start typing your thoughts here...'}
                                minHeight="300px"
                                stickyToolbarTop={belowHeader}
                            />
                        </div>
                    ) : (
                        <div className="prose prose-emerald dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-50 prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-p:leading-relaxed max-w-none text-lg md:text-xl prose-scaled">
                            <FoldableMarkdown
                                content={content}
                                searchQuery={searchQuery}
                                control={outlineControl}
                                showToggleAll={!isWideViewport || panelCollapsed}
                                scrollMarginTop={belowHeader + 8}
                            />
                        </div>
                    )}

                    {/* Recording lives WITH the text it fills — bottom-right of the editor. */}
                    {isEditing && (
                        <div className="absolute bottom-3 right-3 z-20">
                            <div className="shadow-lg rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                                <FocusRecorderButton
                                    onRecordingComplete={handleVoiceRecordingComplete}
                                    isProcessing={isVoiceProcessing}
                                    disabled={transcriptionBlocked}
                                    title={transcriptionBlocked ? t('settings.usage.transcriptionUsageExhausted') : undefined}
                                    onError={(err: unknown) => toast.error(String(err) || 'Error')}
                                    transcriptionError={voiceError}
                                    onRetry={handleRetryVoice}
                                    retryCount={voiceRetryCount}
                                    maxRetries={voiceMaxRetries}
                                    onClearError={handleClearVoiceError}
                                    size="small"
                                />
                            </div>
                        </div>
                    )}

                </div>

                {/* AI ✨ moved to the title header (acts on the whole note); mic moved to the
                    editor's bottom-right corner (lives with the text it fills). */}


                    {/* Narrow screens have no panel at all, so the properties stay under the
                        text exactly where they are today. On a wide screen the collapsed rail
                        leads back to them in one click. */}
                    {!isWideViewport && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-gray-100 dark:border-gray-800">
                            {scriptureRefsBlock}
                            {tagsBlock}
                            {sermonsBlock}
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

            <AnalysisConfirmationModal
                isOpen={!!pendingAnalysisResult}
                onClose={() => setPendingAnalysisResult(null)}
                result={pendingAnalysisResult}
                onApply={handleApplyAnalysis}
                bibleLocale={bibleLocale}
                currentTitle={title}
                currentTags={tags}
                currentScriptureRefs={scriptureRefs}
            />

            {/* Reading-mode text size control — same floating violet FAB as preaching view. */}
            {!isEditing && <FloatingTextScaleControls />}
        </div>
    );
}
