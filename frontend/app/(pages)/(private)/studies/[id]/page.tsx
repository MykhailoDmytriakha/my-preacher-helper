'use client';


import { ArrowLeftIcon, ArrowPathIcon, CheckCircleIcon, SparklesIcon, TagIcon, BookmarkIcon, PlusIcon, BookOpenIcon, ChevronDownIcon, ListBulletIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, QuestionMarkCircleIcon, PencilIcon, TrashIcon, CheckIcon, EllipsisVerticalIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { Glasses } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import { withAnalysisAddress } from '@/components/bible/analysis/analysisAddress';
import { ScriptureLinks } from '@/components/bible/ScriptureLinks';
import { ScripturePreviewSheet } from '@/components/bible/ScripturePreviewSheet';
import { CommentDialog } from '@/components/CommentDialog';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { FocusRecorderButton } from '@/components/FocusRecorderButton';
import { CommentIcon } from '@/components/Icons';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import { NoteDetailSkeleton } from '@/components/skeletons/NoteDetailSkeleton';
import { NoteMobileSheet } from '@/components/studies/NoteMobileSheet';
import { NoteReadingView } from '@/components/studies/NoteReadingView';
import { NoteSidePanel } from '@/components/studies/NoteSidePanel';
import { noteTitleSizeClass } from '@/components/studies/noteTitleSize';
import ScriptureRefBadge from '@/components/studies/ScriptureRefBadge';
import { AiBusyComet } from '@/components/ui/AiBusyComet';
import { Chip } from '@/components/ui/Chip';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { TagHistory } from '@/components/ui/TagHistory';
import { useEditorOwnedText } from '@/components/ui/useEditorOwnedText';
import { sectionAtLine, useActiveSection } from '@/hooks/useActiveSection';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useClipboard } from '@/hooks/useClipboard';
import { useCollapseOnScroll } from '@/hooks/useCollapseOnScroll';
import { useConfirm, useDiscardQuestion } from '@/hooks/useConfirm';
import { useDraftQuestion, useDurableDraft, useSettleShownDraft } from '@/hooks/useDurableDraft';
import { useMarkdownOutline } from '@/hooks/useMarkdownOutline';
import { useNewNoteOpening, useNewStudyNoteDraft } from '@/hooks/useNewStudyNoteDraft';
import { useRouteId } from '@/hooks/useRouteId';
import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { useStickyOffsets } from '@/hooks/useStickyOffsets';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { useTextDictation } from '@/hooks/useTextDictation';
import { useRoomyHeader, useWideViewport } from '@/hooks/useWideViewport';
import { ScriptureReference, StudyNote, StudyNoteType } from '@/models/models';
import { auth } from '@/services/firebaseAuth.service';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { apiClient } from '@/utils/apiClient';
import { formatDay, textLanguage } from '@/utils/appLocale';
import { interfaceLanguageHeaders } from '@/utils/authenticatedRequest';
import { referenceFromTyped } from '@/utils/bibleLink';
import { changedFields } from '@/utils/changedFields';
import { newClientId } from '@/utils/clientId';
import { serializeContent } from '@/utils/contentFingerprint';
import { studyNoteLanguage } from '@/utils/documentLanguage';
import { listReadState } from '@/utils/listReadState';
import { sectionDisplayLabel, findSectionById } from '@/utils/markdownSections';
import { findNoteDraftCopies } from '@/utils/newNoteDrafts';
import { noteReadingBlockAtLine, type NoteReadingStart } from '@/utils/noteReadingAnchor';
import { awaitAcceptance } from '@/utils/recoverableWrite';
import { formatScriptureReference, studyNoteSearchText } from '@/utils/scriptureReference';
import { sameScriptureReference, withNoteReferenceBibles } from '@/utils/scriptureReferenceNumbering';
import { isRecordingOnlyNoteDraft } from '@/utils/studyNoteAudioRecovery';
import { noteRecordingMetadata } from '@/utils/studyNoteRecordings';
import { inStudyNoteTab, STUDY_NOTE_TABS, type StudyNoteTab } from '@/utils/studyNoteTabs';
import { isOrdinaryStudyNoteType } from '@/utils/studyNoteType';
import { formatStudyNoteForCopy, studyNoteOwnName } from '@/utils/studyNoteUtils';
import { NEUTRAL_CAPTION } from '@/utils/themeColors';
import { isTypingIn } from '@/utils/typingTarget';
import HighlightedText from '@components/HighlightedText';
import { useTranslation } from '@locales/useTranslation';

import AnalysisConfirmationModal, { AnalysisResultData } from '../AnalysisConfirmationModal';
import SermonsBuiltOnNote from '../components/SermonsBuiltOnNote';
import UnreadableNoteDrafts from '../components/UnreadableNoteDrafts';
import { STUDIES_INPUT_SHARED_CLASSES } from '../constants';
import ScriptureRefPicker from '../ScriptureRefPicker';
import TagCatalogModal from '../TagCatalogModal';

import { NoteAiMenu, type NoteAiSource, type NoteAiTarget } from './NoteAiMenu';
import { type NoteDraftPayload } from './noteDraft';
import { legacyStudyNoteCreationFields, legacyStudyNoteEdits, resumedNoteBaseline } from './noteDraftBase';
import { NoteDraftRecovery } from './NoteDraftRecovery';
import { RetainedNoteDraft } from './RetainedNoteDraft';
import { StudyNoteSessionFeedback } from './StudyNoteSessionFeedback';
import { useNoteScrollIsolation } from './useNoteScrollIsolation';
import { useNoteScrollPosition } from './useNoteScrollPosition';
import { useStudyNoteEditingSession } from './useStudyNoteEditingSession';

import type { SheetReference } from '@/components/bible/VerseSheet';
import type { DocumentTagHistoryPage } from '@/data-engine/documentTagMembership';
import type { AppLocale } from '@/utils/appLocale';

const AI_USAGE_EXHAUSTED_KEY = 'settings.usage.aiUsageExhausted';

const makeId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

function useFilteredNotes(notes: StudyNote[], searchParams: URLSearchParams, bibleLocale: AppLocale) {
    const noteId = useRouteId();

    const searchQuery = searchParams.get('search')?.trim() || '';
    const tagFilter = searchParams.get('tag') || '';
    const bookFilter = searchParams.get('book') || '';
    const tabParam = searchParams.get('tab');
    const activeTab: StudyNoteTab = (STUDY_NOTE_TABS as readonly string[]).includes(tabParam ?? '') ? tabParam as StudyNoteTab : 'all';

    const searchTokens = useMemo(() => searchQuery.toLowerCase().split(/\s+/).filter(Boolean), [searchQuery]);

    // Replicate matching logic from studies/page.tsx
    const filteredNotes = useMemo(() => {
        return notes
            .filter((note: StudyNote) => inStudyNoteTab(note, activeTab))
            .filter((note: StudyNote) => (tagFilter ? note.tags.includes(tagFilter) : true))
            .filter((note: StudyNote) => bookFilter ? note.scriptureRefs.some((ref: ScriptureReference) => ref.book.toLowerCase() === bookFilter.toLowerCase()) : true)
            .filter((note: StudyNote) => {
                if (searchTokens.length === 0) return true;
                const haystack = studyNoteSearchText(note, bibleLocale);
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
            // An arrow typed into a field or the editor moves the caret, not the page.
            if (isTypingIn(e.target)) return;
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

/*
 * Unsaved text from last time is offered back as a question, answered before anything is written over it: until then
 * the page reads and nothing on it writes. Typing past the offer stored the new words where the offered ones lay,
 * 250 ms later — the offer still showed the old words, and a reload had nothing left to bring back
 * (BUG-20261028-typing-over-draft-offer).
 */
function writesNow(asked: boolean, waiting: NoteDraftPayload | null): boolean {
    return asked && waiting === null;
}

/** Value equality for the complete draft payload. */
function sameNoteDraft(a: NoteDraftPayload, b: NoteDraftPayload): boolean {
    return serializeContent(a) === serializeContent(b);
}

/**
 * Whether a copy holds nothing beyond its own base: its words ARE what they were built from (`resumedNoteBaseline`,
 * compared as the editor compares what it sends, `changedFields`). Every copy keeps as its base what its words are built
 * on as far as this device has stored it — the baseline, which moves to a save only once this device stored it — so such
 * a copy was written after its very words were stored by this device: the engine owns them, nothing in the copy is unsent.
 * Resumed, it would show those words while sending nothing, even when the note was stored newer since; it is not
 * offered instead. A copy without a readable base is never such a copy.
 */
function holdsNothingUnsent(copy: { value: NoteDraftPayload; base?: unknown }, noteId: string, locale: AppLocale): boolean {
    const words = withNoteReferenceBibles(copy.value, locale);
    return Object.keys(changedFields(resumedNoteBaseline(copy.base, words, null, noteId, locale), words)).length === 0;
}

/**
 * The unsaved words from last time still to be answered, or null: words equal to the page's are settled as taken, and
 * so are words that hold nothing unsent (`nothingUnsent`).
 */
function useNoteDraftOffer(recovered: NoteDraftPayload | null, shown: NoteDraftPayload, ready: boolean, settle: () => void,
    sourceKey: string | null, nothingUnsent = false): NoteDraftPayload | null {
    const same = recovered !== null && (nothingUnsent || sameNoteDraft(recovered, shown));
    useSettleShownDraft(ready && same, settle, sourceKey);
    return recovered && !same ? recovered : null;
}

function useNoteDeletion({ confirm, noteId, isNew, uid, deleteNote, removeFromSession, router }: {
    confirm: ReturnType<typeof useConfirm>['confirm'];
    noteId: string;
    isNew: boolean;
    uid: string | undefined;
    deleteNote: ReturnType<typeof useStudyNotes>['deleteNote'];
    removeFromSession?: () => Promise<void>;
    router: Pick<ReturnType<typeof useRouter>, 'replace'>;
}) {
    return async () => {
        if (await confirm({ title: { key: 'studiesWorkspace.deleteConfirm' }, confirmText: { key: 'common.delete' } })) {
            if (noteId && !isNew && uid) {
                try {
                    if (removeFromSession) await removeFromSession();
                    else await awaitAcceptance(deleteNote(noteId), () => undefined);
                    // The canonical note deletion retires its share links atomically on the server.
                } catch (e) {
                    /**
                     * The canonical engine reports this refusal — one
                     * refusal, one reporter. Staying on the page is what this handler
                     * owes the person: a refused delete must not navigate away as if it
                     * had succeeded.
                     */
                    console.error('Error deleting note', e);
                    return;
                }
            }
            // replace, not push: we are ON the page of the thing being deleted, so pushing leaves a dead entry in history and Back re-opens it.
            router.replace('/studies');
        }
    };
}


function addNoteSource(value: unknown, id: string): string[] {
    const sources = Array.isArray(value) ? value.filter((source): source is string => typeof source === 'string') : [];
    return sources.includes(id) ? sources : [...sources, id];
}

function useNoteAIAssistant({
    noteId, recordingContextId, content, availableTags, setTitle, appendDictation, setScriptureRefs, setTags, t, uid, liveDictation, linkedRecordingSourceIds, onSourcePersisted, acceptedDictationSourceIds
}: {
    noteId: string;
    recordingContextId: string;
    uid?: string;
    liveDictation: React.MutableRefObject<string[]>;
    linkedRecordingSourceIds: readonly string[];
    acceptedDictationSourceIds?: readonly string[];
    onSourcePersisted: (sourceId: string) => void;
    content: string; availableTags: string[];
    setTitle: (t: string) => void; appendDictation: (block: string, sourceId: string) => void | Promise<void>;
    setScriptureRefs: (refs: ScriptureReference[] | ((prev: ScriptureReference[]) => ScriptureReference[])) => void; setTags: (tags: string[] | ((prev: string[]) => string[])) => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    const { aiBlocked, blocked, blockedLabelKey, refresh: refreshAiUsage } = useAiUsage();
    // `/api/studies/transcribe` admits transcription AND ai, so the microphone has to answer
    // for both — gating on transcription alone let the take go out and be refused.
    const dictationBlocked = blocked('dictation');
    const dictationBlockedKey = blockedLabelKey('dictation');
    // Independent fields can run together. Overlapping targets (including "all")
    // share a lock, while each control keeps its own busy indication.
    const [runningAnalyses, setRunningAnalyses] = useState<Partial<Record<NoteAiTarget, NoteAiSource>>>({});
    const activeAnalyses = useRef(new Map<NoteAiTarget, AbortController>());
    useEffect(() => {
        const requests = activeAnalyses.current;
        return () => {
            requests.forEach((controller) => controller.abort());
            requests.clear();
        };
    }, []);
    const isTargetRunning = (target: NoteAiTarget) => target === 'all'
        ? Object.keys(runningAnalyses).length > 0
        : runningAnalyses.all !== undefined || runningAnalyses[target] !== undefined;
    const isSourceAnalyzing = (source: NoteAiSource) => Object.values(runningAnalyses).includes(source);
    const [analysisResults, setAnalysisResults] = useState<{ id: string; data: AnalysisResultData }[]>([]);
    const pendingAnalysisResult = analysisResults[0]?.data ?? null;
    const pendingAnalysisKey = analysisResults[0]?.id;
    const dismissAnalysisResult = useCallback(() => setAnalysisResults((previous) => previous.slice(1)), []);

    const handleAIAnalyze = async (
        analysisType: NoteAiTarget = 'all',
        source: NoteAiSource = 'menu'
    ) => {
        if (aiBlocked) return;
        const requests = activeAnalyses.current;
        if (requests.has('all') || (analysisType === 'all' ? requests.size > 0 : requests.has(analysisType))) return;
        if (!content.trim()) {
            toast.error(t('studiesWorkspace.aiAnalyze.emptyContent'));
            return;
        }

        const controller = new AbortController();
        requests.set(analysisType, controller);
        setRunningAnalyses((previous) => ({ ...previous, [analysisType]: source }));
        try {
            const token = await auth.currentUser?.getIdToken();
            if (controller.signal.aborted) return;
            const response = await apiClient('/api/studies/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...interfaceLanguageHeaders(),
                },
                body: JSON.stringify({
                    content,
                    existingTags: availableTags,
                    analysisType,
                    studyId: noteId,
                }),
                category: 'ai',
                signal: controller.signal,
            });
            const result = await response.json();

            if (!result.success || !result.data) {
                throw new Error(result.error);
            }

            if (controller.signal.aborted) return;
            const aiResult: AnalysisResultData = {
                ...(analysisType === 'all' || analysisType === 'title' ? { title: result.data.title } : {}),
                ...(analysisType === 'all' || analysisType === 'tags' ? { tags: result.data.tags } : {}),
                ...(analysisType === 'all' || analysisType === 'scriptureRefs' ? { scriptureRefs: result.data.scriptureRefs } : {}),
            };
            const hasAnyResult = Boolean(aiResult.title || aiResult.tags?.length || aiResult.scriptureRefs?.length);

            if (hasAnyResult) {
                setAnalysisResults((previous) => [...previous, { id: makeId(), data: aiResult }]);
                toast.success(t('studiesWorkspace.aiAnalyze.success'));
            } else {
                toast.info(t('studiesWorkspace.aiAnalyze.noResults'));
            }
            await refreshAiUsage();

        } catch (error) {
            if (controller.signal.aborted) return;
            if (isUsageCapReachedError(error)) return;
            toast.error(t('studiesWorkspace.aiAnalyze.error'));
        } finally {
            if (requests.get(analysisType) === controller) {
                requests.delete(analysisType);
                setRunningAnalyses((previous) => {
                    const next = { ...previous };
                    delete next[analysisType];
                    return next;
                });
            }
        }
    };

    const handleApplyAnalysis = (data: AnalysisResultData) => {
        if (data.title) setTitle(data.title);

        if (data.scriptureRefs && data.scriptureRefs.length > 0) {
            setScriptureRefs((prev: ScriptureReference[]) => {
                // The same place counts once whichever Bible numbers it (Пс 22 and Ps 23).
                const newRefs = data.scriptureRefs!.filter((nr: ScriptureReference) =>
                    !prev.some((er: ScriptureReference) => sameScriptureReference(er, nr))
                ).map((ref: Omit<ScriptureReference, 'id'>) => ({ ...ref, id: makeId() }));
                return [...prev, ...newRefs];
            });
        }

        if (data.tags && data.tags.length > 0) {
            setTags((prev: string[]) => Array.from(new Set([...prev, ...data.tags!])));
        }
    };

    const pendingDictation = useRef(new Map<string, Promise<void>>());
    const voice = useTextDictation({
        recordingContext: { context: 'study', contextId: recordingContextId },
        linkedSourceIds: linkedRecordingSourceIds,
        acceptedSourceIds: acceptedDictationSourceIds,
        onSourcePersisted,
        endpoint: '/api/studies/transcribe',
        onText: async (text, sourceId) => {
            if (!sourceId || !uid) throw new Error('The note recording owner is not available');
            // Projected IDs prevent duplicate insertion; only confirmed IDs permit source retirement.
            if (liveDictation.current.includes(sourceId)) return;
            const pending = pendingDictation.current.get(sourceId);
            if (pending) return pending;
            const appended = appendDictation(text, sourceId);
            if (!appended) return;
            const acceptance = appended.finally(() => { pendingDictation.current.delete(sourceId); });
            pendingDictation.current.set(sourceId, acceptance);
            await acceptance;
        },
        onEmpty: () => toast.error(t('errors.audioProcessing')),
        onError: words => toast.error(sayFailure(words, t)),
    });
    useEffect(() => {
        if (voice.isProcessing) return;
        // A replaced body may no longer contain this transcript. The raw take can be used again.
        const released = voice.appliedDraftIds?.filter(id => !liveDictation.current.includes(id)
            && !acceptedDictationSourceIds?.includes(id));
        if (released?.length) voice.releaseApplied(released);
    }, [acceptedDictationSourceIds, liveDictation, linkedRecordingSourceIds, voice]);
    const isVoiceProcessing = voice.isProcessing;
    const voiceError = voice.error;
    const voiceRetryCount = voice.retryCount;
    const handleVoiceRecordingComplete = voice.complete;
    const handleRetryVoice = voice.retry;
    const handleClearVoiceError = voice.clear;
    const resendVoiceBlob = (_blob: Blob, draft: import('@/utils/recordingDraftStore').RecordingDraft) => voice.recover(draft);

    return {
        isTargetRunning, isSourceAnalyzing, isVoiceProcessing, aiBlocked, dictationBlocked, dictationBlockedKey, handleAIAnalyze, handleVoiceRecordingComplete,
        voiceError, voiceRetryCount, voiceMaxRetries: voice.maxRetries, handleRetryVoice, handleClearVoiceError,
        voiceController: voice,
        resendVoiceBlob,
        pendingAnalysisResult, pendingAnalysisKey, dismissAnalysisResult, handleApplyAnalysis
    };
}


type EditorHeaderProps = {
    handleBack: () => void; t: ReturnType<typeof useTranslation>['t']; isEditing: boolean;
    filteredNotes: StudyNote[]; prevNoteId: string | null; nextNoteId: string | null;
    router: ReturnType<typeof useRouter>; searchParams: ReturnType<typeof useSearchParams>;
    currentIndex: number; type: StudyNoteType; setType: (t: StudyNoteType) => void;
    isSaving: boolean; lastSaved: Date | null;
    /** The text on screen differs from what the server last confirmed. */
    hasUnsavedEdits: boolean;
    setIsEditing: (b: boolean) => void; handleDelete: () => void; handleCopy: () => void; isCopied: boolean;
    /** Opens the reading mode — offered while the note is read, beside Copy. */
    onRead: () => void;
    /** The note's title lives here now, not as a display-size heading above the text. */
    title: string; setTitle: (v: string) => void; searchQuery: string;
    /** Reading mode has nothing to save, so the status only shows while editing — plus a
        short confirmation right after leaving the editor, which is the moment it matters. */
    justSaved: boolean; aiMenu: React.ReactNode;
    /** Measured, not assumed: the app nav is a different height on a phone. */
    headerRef: (element: HTMLElement | null) => void; stickyTop: number;
    /** The viewport can lay the controls and the title out on one row. */
    roomy: boolean;
    /** Narrow screens only: the controls row is folded away while reading. */
    collapsed: boolean;
    /**
     * The section being read, shown instead of the note's title once reading has
     * started — the title is the one thing the reader already knows.
     */
    sectionLabel?: string | null;
    /** Opens the bottom sheet holding the outline and the note's properties. */
    onOpenSheet?: () => void;
    /** Unsaved text from last time waits for an answer: the way into editing stays shut until it is given. */
    editHeld?: boolean;
};

/** The phone controls row folds with `transition-all duration-200`. */
const ROW_FOLD_MS = 200;

/**
 * Whether a folding row is open and done moving. It must clip while it folds or unfolds — its buttons would
 * otherwise draw over the title below — and must not clip once open, or the menus it holds open out of sight.
 */
function useSettledOpenRow(folded: boolean): boolean {
    const [settled, setSettled] = useState(!folded);
    useEffect(() => {
        if (folded) {
            setSettled(false);
            return;
        }
        const timer = window.setTimeout(() => setSettled(true), ROW_FOLD_MS);
        return () => window.clearTimeout(timer);
    }, [folded]);
    return settled && !folded;
}

function EditorHeader({
    handleBack, t, isEditing, filteredNotes, prevNoteId, nextNoteId, router, searchParams,
    currentIndex, type, setType, isSaving, lastSaved, hasUnsavedEdits, setIsEditing, handleDelete, handleCopy, isCopied, onRead,
    title, setTitle, searchQuery, justSaved, aiMenu, headerRef, stickyTop,
    roomy, collapsed, sectionLabel, onOpenSheet, editHeld = false
}: EditorHeaderProps) {
    const controlsOpen = useSettledOpenRow(collapsed);

    const backButton = (
        <button
            onClick={handleBack}
            className="flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            title={t('common.back')}
            aria-label={t('common.back')}
        >
            <ArrowLeftIcon className="h-5 w-5" />
        </button>
    );

    const pager = !isEditing && filteredNotes.length > 1 && (
        <div className="flex items-center border-l border-gray-200 dark:border-gray-700 pl-2 gap-0.5">
            <button
                onClick={() => router.push(`/studies/${prevNoteId}?${searchParams.toString()}`)}
                disabled={!prevNoteId}
                className="flex items-center justify-center rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:outline-none disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100 transition-colors"
                title={t('common.previous')}
            >
                <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <span className={`text-xs font-mono ${NEUTRAL_CAPTION} min-w-[3rem] text-center select-none tabular-nums`}>
                {currentIndex >= 0 ? `${currentIndex + 1} / ${filteredNotes.length}` : '—'}
            </span>
            <button
                onClick={() => router.push(`/studies/${nextNoteId}?${searchParams.toString()}`)}
                disabled={!nextNoteId}
                className="flex items-center justify-center rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:outline-none disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100 transition-colors"
                title={t('common.next')}
            >
                <ChevronRightIcon className="h-4 w-4" />
            </button>
        </div>
    );

    const typeControl = (
        <EditorHeaderTypeControl isEditing={isEditing} type={type} setType={setType} t={t} />
    );

    /* The note's title. In reading mode on a narrow screen it doubles as the way into the
       outline and says which section is being read — see NoteMobileSheet. */
    const titleField = <EditorTitleField isEditing={isEditing} title={title} setTitle={setTitle} t={t} searchQuery={searchQuery} />;

    const actions = <EditorHeaderActions t={t} isEditing={isEditing} justSaved={justSaved} isSaving={isSaving} lastSaved={lastSaved} hasUnsavedEdits={hasUnsavedEdits} handleCopy={handleCopy} isCopied={isCopied} onRead={onRead} setIsEditing={setIsEditing} editHeld={editHeld} handleDelete={handleDelete} aiMenu={aiMenu} folded={collapsed} />;

    const shell = 'sticky z-30 border-b border-gray-200 bg-white/90 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90';

    /* A phone has no room for controls and title side by side, and no vertical budget to
       keep both bands up while reading. So the controls get their own row that folds away
       as soon as reading starts, and the row that stays answers "where am I". */
    if (!roomy) {
        return (
            <header ref={headerRef} style={{ top: stickyTop }} className={`${shell} px-3 pb-1.5 pt-1.5`}>
                {/* `inert` and not just `aria-hidden`: a zero-height row keeps its buttons in
                    the tab order, so Tab used to land on an invisible Copy / Edit / More.
                    The row clips only while it is folded or folding: open and still, it lets its
                    menus (More, AI) hang below it — clipped, More opened invisibly and Delete
                    could not be reached on a phone (BUG-20261119-note-phone-more-menu-clipped). */}
                <div
                    className={`flex items-center justify-between gap-2 transition-all duration-200 ${controlsOpen ? '' : 'overflow-hidden'} ${collapsed ? 'h-0 opacity-0' : 'h-11 opacity-100'}`}
                    inert={collapsed}
                >
                    <div className="flex items-center gap-1">
                        {pager}
                        {typeControl}
                    </div>
                    <div className="flex items-center gap-1.5">{actions}</div>
                </div>

                <div className="flex items-center gap-1">
                    {backButton}
                    {isEditing || !onOpenSheet ? (
                        <div className="min-w-0 flex-1">{titleField}</div>
                    ) : (
                        <button
                            type="button"
                            onClick={onOpenSheet}
                            aria-haspopup="dialog"
                            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 transition-colors active:bg-gray-100 dark:active:bg-gray-800"
                        >
                            {sectionLabel ? (
                                <span className="min-w-0 truncate text-[15px] font-semibold leading-tight text-emerald-800 dark:text-emerald-300">
                                    {sectionLabel}
                                </span>
                            ) : (
                                /* Stays an <h1>: it is still the page's title for heading
                                   navigation, and a title matching the search has to keep
                                   showing the hit. */
                                <h1 className={`min-w-0 break-words font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-50 ${noteTitleSizeClass(title)}`}>
                                    {renderEditorTitle(title, searchQuery, t)}
                                </h1>
                            )}
                            <ChevronDownIcon className={`h-4 w-4 shrink-0 ${sectionLabel ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} />
                        </button>
                    )}
                    <span className="w-9 shrink-0" aria-hidden />
                </div>
            </header>
        );
    }

    return (
        <header
            ref={headerRef}
            style={{ top: stickyTop }}
            className={`${shell} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]`}
        >
            <div className="min-w-0 flex flex-wrap items-center gap-1 sm:gap-2 lg:gap-4">
                <div className="flex items-center gap-1">
                    {backButton}
                    {pager}
                </div>
                {typeControl}
                {/* Between `sm` and `lg` this row IS the header, and there is no side panel
                    yet — without this button the outline, the tags, the references and the
                    dates are mounted in the sheet with nothing able to open it. */}
                {onOpenSheet && (
                    <button
                        type="button"
                        onClick={onOpenSheet}
                        aria-haspopup="dialog"
                        title={t('notePanel.outline')}
                        aria-label={t('notePanel.outline')}
                        className="flex items-center justify-center rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                    >
                        <ListBulletIcon className="h-5 w-5" />
                    </button>
                )}
            </div>

            {/* Keep the title in layout flow: overlay centering collides with controls on foldables. */}
            <div className="col-span-2 row-start-2 min-w-0 xl:col-span-1 xl:col-start-2 xl:row-start-1">
                {titleField}
            </div>

            <div className="col-start-2 row-start-1 flex items-center justify-end gap-3 xl:col-start-3">{actions}</div>
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
    type: StudyNoteType;
    setType: (t: StudyNoteType) => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    if (isEditing) {
        const IDLE_TYPE = 'text-gray-500 hover:text-gray-700 dark:text-gray-400';
        return (
            <div className="flex flex-col">
                <div className="flex items-center gap-2">
                    {/* One word, one colour everywhere: a note green as on the Bible's badges, a question amber, a comment
                        the pencil's grey (2026-10-28). A comment is not chosen here: it is written and edited in its window. */}
                    <button
                        type="button"
                        aria-pressed={type === 'note'}
                        onClick={() => setType('note')}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${type === 'note' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100' : IDLE_TYPE}`}
                    >
                        {t('studiesWorkspace.type.note')}
                    </button>
                    <button
                        type="button"
                        aria-pressed={type === 'question'}
                        onClick={() => setType('question')}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${type === 'question' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' : IDLE_TYPE}`}
                    >
                        {t('studiesWorkspace.type.question')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2">
                {type === 'question' ? (
                    <Chip tone="amber" size="sm" icon={<QuestionMarkCircleIcon className="h-3.5 w-3.5" />}>
                        {t('studiesWorkspace.type.question')}
                    </Chip>
                ) : type === 'comment' ? (
                    <Chip tone="neutral" size="sm" icon={<CommentIcon className="h-3.5 w-3.5" />}>
                        {t('studiesWorkspace.type.comment')}
                    </Chip>
                ) : (
                    <Chip tone="emerald" size="sm">
                        {t('studiesWorkspace.type.note')}
                    </Chip>
                )}
            </div>
        </div>
    );
}

const NOTE_PANEL_STORAGE_KEY = 'studyNote.sidePanelCollapsed';
/** The one-time hand-over of the reading mode to the next note's page (tab storage: nothing in the address or history). */
const READING_HANDOFF_KEY = 'studyNote.readingHandoff';
/** A hand-over is for the page the press opens, seconds later; an older one was left by a turn that never arrived. */
const READING_HANDOFF_TTL_MS = 15_000;
function handReadingTo(noteId: string) {
    try {
        window.sessionStorage.setItem(READING_HANDOFF_KEY, JSON.stringify({ noteId, at: Date.now() }));
    } catch { /* storage closed: the next note opens as a page */ }
}
/**
 * The first note page built after a hand-over takes it, whichever note it is: the one it was meant for opens in the
 * mode, any other page (a turn interrupted by a reload, a neighbour that sends elsewhere) only clears it, so a
 * hand-over left behind never opens the mode later on its own.
 */
function takeReadingHandoff(noteId: string): boolean {
    try {
        const raw = window.sessionStorage.getItem(READING_HANDOFF_KEY);
        if (raw === null) return false;
        window.sessionStorage.removeItem(READING_HANDOFF_KEY);
        const handed = JSON.parse(raw) as { noteId?: unknown; at?: unknown };
        return handed.noteId === noteId && typeof handed.at === 'number' && Date.now() - handed.at < READING_HANDOFF_TTL_MS;
    } catch {
        return false;
    }
}

/** Creation and last-edit dates. Metadata, so it sits with the rest of the metadata. */
function NoteDates({ note, t }: { note: StudyNote; t: ReturnType<typeof useTranslation>['t'] }) {
    const { dateLocale } = useAppLocale();
    const created = formatDay(note.createdAt, dateLocale);
    const updated = formatDay(note.updatedAt, dateLocale);
    return (
        <>
            <div>{t('notePanel.created', { date: created })}</div>
            {updated !== created && (
                <div>{t('notePanel.updated', { date: updated })}</div>
            )}
        </>
    );
}


function noteScrollLayout(wide: boolean, navHeight: number, belowHeader: number, textRoot: HTMLDivElement | null) {
    return wide
        ? { headerTop: 0, toolbarTop: 0, sectionMargin: 8, activeOffset: 16, activeRoot: textRoot }
        : { headerTop: navHeight, toolbarTop: belowHeader, sectionMargin: belowHeader + 8, activeOffset: belowHeader + 16, activeRoot: null };
}

/**
 * WHAT A COMMENT'S PAGE SHOWS OTHERWISE than a note's (case 2026-10-12-block-diagram, 3.2): its place for a name — it has
 * none of its own, and the dashboard and the calendar call it so (`studyNoteOwnName`) — no tags to fill, no outline for a
 * few sentences, and its place grey, the pencil's colour, as in Studies.
 */
function commentPageView(type: StudyNoteType, title: string, scriptureRefs: ScriptureReference[], locale: AppLocale) {
    const isComment = type === 'comment';
    return {
        title: isComment ? studyNoteOwnName({ title, scriptureRefs }, locale) ?? title : title,
        outlineShown: !isComment,
        refTone: isComment ? ('neutral' as const) : undefined,
        tags: (block: React.ReactNode) => (isComment ? null : block),
    };
}

/** The page's pencil: a comment opens in its window, any other note goes into editing on the page. */
function useCommentWindow(note: StudyNote | undefined, setIsEditing: (next: boolean) => void) {
    const [open, setOpen] = useState(false);
    const isComment = note?.type === 'comment';
    const editOrOpen = useCallback((next: boolean) => (next && isComment ? setOpen(true) : setIsEditing(next)), [isComment, setIsEditing]);
    const close = useCallback(() => setOpen(false), []);
    return { open, close, setIsEditing: editOrOpen };
}

/** A comment opened from its page, named by its place. */
function NoteCommentWindow({ open, note, locale, onClose, onErased }: { open: boolean; note: StudyNote | undefined; locale: AppLocale; onClose: () => void; onErased: () => void }) {
    if (!open || !note) return null;
    const reference = note.scriptureRefs[0];
    return <CommentDialog target={{ kind: 'edit', id: note.id }} place={reference ? formatScriptureReference(reference, { locale }) : ''} onClose={onClose} onErased={onErased} />;
}

/** Analysis notes open in their analysis window over the analyses list, not in the ordinary note editor. */
export default function StudyNotePage() {
    const router = useRouter();
    const routeId = useRouteId();
    const { notes } = useStudyNotes();
    const analysisId = notes.some((note) => note.id === routeId && note.type === 'analysis') ? routeId : null;
    useEffect(() => {
        if (analysisId) router.replace(withAnalysisAddress('/studies?tab=analyses', { id: analysisId, mode: 'view' }));
    }, [analysisId, router]);
    return analysisId ? null : <StudyNoteEditorPage />;
}

function StudyNoteEditorPage() {
    const opening = useNewNoteOpening();
    if (opening.waiting) return <NoteDetailSkeleton />;
    return <>
        <UnreadableNoteDrafts owner={opening.owner} documentId={opening.documentId} />
        <NoteEditor key={opening.key} openingDraftId={opening.draftDocId} openingRecoveryKey={opening.recoveryKey} />
    </>;
}

// Adoption can run after input from a newer task; mirror setters so its guards never use a clean render that has already become dirty.
function useLiveState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>, React.MutableRefObject<T>] {
    const [value, setValue] = useState(initial);
    const live = useRef(value);
    const set = useCallback((next: React.SetStateAction<T>) => {
        live.current = typeof next === 'function' ? (next as (value: T) => T)(live.current) : next;
        setValue(live.current);
    }, []);
    return [value, set, live];
}

function NoteEditor({ openingDraftId, openingRecoveryKey }: { openingDraftId: string; openingRecoveryKey?: string | null }) {
    const { t } = useTranslation();
    const router = useRouter();
    const routeId = useRouteId();
    const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
    const [draftWriterId] = useState(newClientId);
    const { uid, notes, notePresence, refetch, confirmedCreationIds, deleteNote, observeTitle, observeType, observeTagBasis, captureActionTime, loading: notesLoading, complete: notesComplete, checking: notesChecking, error: notesError } = useStudyNotes();
    const { creationId, recordingContextId, noteId, isNew, draftDocId } = useNewStudyNoteDraft({
        uid, routeId, createdNoteId, openingDraftId, openingRecoveryKey, notes, confirmedCreationIds,
    });

    const existingNote = useMemo(() => notes.find(note => note.id === noteId), [notes, noteId]);
    const { locale: bibleLocale } = useAppLocale();
    const firstNoteFields = useRef<Pick<StudyNote, 'type' | 'recordingSourceIds' | 'dictationSourceIds'>>({ type: 'note' });
    const { active: ordinarySession, id: sessionId, document: bodySession, projected, stage, changeReferences: editReferences, changeTags: editTags } = useStudyNoteEditingSession({
        uid, noteId, isNew, creationId, existingNote, locale: bibleLocale, captureActionTime, initialFields: () => firstNoteFields.current,
    });
    const stageBody = (content: string, opening: string, sourceId?: string) => {
        if (!ordinarySession) return;
        void stage(current => ({
            ...current, content, ...(sourceId && noteRecordingMetadata(
                addNoteSource(current.dictationSourceIds, sourceId), addNoteSource(current.recordingSourceIds, sourceId),
            )),
        }), { action: { kind: 'study-note-field', field: 'content', opening, ...(sourceId && { saveImmediately: true as const }) } }).catch(() => undefined);
    };
    const stageLiveBody = useRef(stageBody);
    stageLiveBody.current = stageBody;

    const tagSource = useTags(uid);
    const { tags: tagData } = tagSource;
    const { isCopied, copyToClipboard } = useClipboard({ successDuration: 1500 });

    const [title, setTitleState, liveTitle] = useLiveState('');
    const noteEditorRef = useRef<HTMLDivElement>(null);
    const { text: content, follow: setContent, replace: replaceContent, append: appendContent, ownedBy } = useEditorOwnedText('', (value, opening) => stageLiveBody.current(value, opening));
    const [dictationSourceIds, setDictationSourceIds, liveDictation] = useLiveState<string[]>([]);
    const [recordingSourceIds, setRecordingSourceIds] = useState<string[]>([]);
    const [ownedAudioSources, setOwnedAudioSources] = useState<string[]>([]);
    const appendDictation = (block: string, sourceId: string) => appendContent(block, (body, opening) => {
        // The editor calls this only once the text was actually inserted, including after composition.
        // Pair the ID with that exact text in the same edit.
        setDictationSourceIds(previous => addNoteSource(previous, sourceId));
        stageLiveBody.current(body, opening, sourceId);
    });
    const onSourcePersisted = (sourceId: string) => {
        setOwnedAudioSources(previous => addNoteSource(previous, sourceId));
        if (isNew) firstNoteFields.current = { ...firstNoteFields.current,
            recordingSourceIds: addNoteSource(firstNoteFields.current.recordingSourceIds, sourceId) };
        if (ordinarySession) void stage(current => ({
            ...current, recordingSourceIds: addNoteSource(current.recordingSourceIds, sourceId),
        }), undefined, false).catch(() => undefined);
    };
    const linkedRecordingSourceIds = useMemo(() => [...new Set([...recordingSourceIds, ...dictationSourceIds, ...ownedAudioSources])],
        [recordingSourceIds, dictationSourceIds, ownedAudioSources]);
    const [tags, setTags] = useLiveState<string[]>([]);
    const [scriptureRefs, setScriptureRefs] = useLiveState<ScriptureReference[]>([]);
    const [type, setTypeState, liveType] = useLiveState<StudyNoteType>('note');
    const changeReferences: typeof setScriptureRefs = next => {
        void editReferences(typeof next === 'function' ? next : () => next).catch(() => undefined);
    };
    const changeTags: typeof setTags = next => {
        void editTags(typeof next === 'function' ? next : () => next).catch(() => undefined);
    };

    // What the person asked for; the page writes only once nothing waits for an answer (`isEditing` below).
    const [editingWanted, setIsEditing] = useState(isNew);

    // Input states
    const [tagInput, setTagInput] = useState('');
    const [quickRefInput, setQuickRefInput] = useState('');
    const [quickRefError, setQuickRefError] = useState<FailureWords | null>(null);

    // Tag / Reference Pickers
    const [showTagCatalog, setShowTagCatalog] = useState(false);
    const [editingReference, setEditingReference] = useState<{
        initial: ScriptureReference; apply: (ref: Omit<ScriptureReference, 'id'>) => void;
    } | null>(null);
    const [showRefPicker, setShowRefPicker] = useState(false);
    const [previewReference, setPreviewReference] = useState<ScriptureReference | null>(null);
    // A reference in the note's text opens the window its chips open: the passage, and the notes on it.
    const openTextReference = useCallback((reference: SheetReference) => setPreviewReference({
        ...reference,
        id: `text:${reference.bible}:${reference.book}:${reference.chapter ?? ''}:${reference.fromVerse ?? ''}-${reference.toChapter ?? ''}:${reference.toVerse ?? ''}:${reference.endChapter ?? ''}`,
    }), []);
    // The note's own words decide a reference Russian and Ukrainian write alike; read only while it is shown as text.
    const readingLanguage = useMemo(() => (editingWanted ? null : studyNoteLanguage({ title, content })), [editingWanted, title, content]);

    // Load existing note data or create a new empty template
    const sessionPresence = bodySession.presence.kind === 'unknown' ? undefined : bodySession.presence;
    const presence = (ordinarySession ? sessionPresence : undefined) ?? notePresence?.(noteId);
    const unavailable = !isNew && (presence?.kind === 'absent' || presence?.kind === 'deleting' || (!existingNote && !createdNoteId && !projected));
    // The opening has adopted its reserved ID, but the collection can still be showing the
    // complete list from before its create. Keep this editor mounted until the row arrives.
    // The same absence still blocks writes, and a tombstone is an actual removal.
    const awaitingOwnCreate = createdNoteId === noteId && !confirmedCreationIds?.has(noteId)
        && presence?.kind === 'absent' && presence.snapshot.metadata === null;
    // A projected row or a local capture alone cannot confirm this note on the server.
    const noteIsAccepted = Boolean(bodySession.confirmed?.value && bodySession.status?.phase === 'saved');
    const saveConflict = bodySession.status?.phase === 'conflict' || bodySession.status?.phase === 'remoteChanged';
    const isSaving = bodySession.status?.phase === 'sending' || bodySession.status?.phase === 'savingLocally';
    const lastSaved = noteIsAccepted ? new Date(String(bodySession.confirmed?.value?.updatedAt)) : null;
    const isInitialized = ordinarySession ? Boolean(bodySession.state) : Boolean(existingNote);
    // A comment is edited only in its window (the owner, 2026-10-28), here too: the page's pencil opens it.
    const commentWindow = useCommentWindow(existingNote, setIsEditing);
    const changeEditing = (wanted: boolean) => {
        if (!wanted && bodySession.status?.canSave) void bodySession.save().catch(() => undefined);
        commentWindow.setIsEditing(wanted);
    };

    const availableTags = useMemo(() => {
        const fromTags = [...(tagData.requiredTags ?? []), ...(tagData.customTags ?? [])].map(t => t.name);
        const fromNotes = new Set<string>();
        notes.forEach(n => n.tags.forEach(t => fromNotes.add(t)));
        return Array.from(new Set([...fromTags, ...Array.from(fromNotes)])).sort((a, b) => a.localeCompare(b));
    }, [tagData, notes]);

    // ─── PAGINATION LOGIC ──────────────────────────────────────────────────
    const searchParams = useSearchParams();
    // The reading mode, «the map in the margins»: the note alone, its outline and its verses in the margins (`NoteReadingView`).
    // Capture the page's reading position before opening and locking the reading layer.
    const [reading, setReading] = useState(false);
    const [readingStart, setReadingStart] = useState<NoteReadingStart | null>(null);
    const noteTextRef = useRef<HTMLDivElement>(null);
    // The page is built again for every note: turning to the next note from inside the mode hands the mode on
    // (`handReadingTo`), and the next page opens in it once. History and the address keep nothing of it, so Back
    // to a note read earlier opens that note as a page, and the header's own paging stays plain.
    useEffect(() => {
        if (takeReadingHandoff(noteId)) {
            setReadingStart(null);
            setReading(true);
        }
    }, [noteId]);
    const closeReading = useCallback(() => setReading(false), []);
    const { filteredNotes, currentIndex, prevNoteId, nextNoteId, searchQuery } = useFilteredNotes(notes, searchParams, bibleLocale);
    // The reading mode turns only to notes: an analysis in the same list opens elsewhere (the analyses tab) and would
    // end the mode with its hand-over left unread. Its count is of the same notes.
    const readingPager = useMemo(() => {
        const readable = filteredNotes.filter((note) => note.type !== 'analysis');
        const index = readable.findIndex((note) => note.id === noteId);
        return {
            index,
            total: readable.length,
            previous: index > 0 ? readable[index - 1].id : null,
            next: index >= 0 && index < readable.length - 1 ? readable[index + 1].id : null,
        };
    }, [filteredNotes, noteId]);

    // A window over the page — the verse's, the comment's — keeps the arrows: leaving would close it unasked (Codex review, 2026-10-28).
    useNoteKeyboardNavigation({ isEditing: editingWanted || Boolean(previewReference) || commentWindow.open || reading, prevNoteId, nextNoteId, router, searchParams });

    const changeTitle = (value: string) => {
        const opening = liveTitle.current;
        setTitleState(value);
        void stage(current => ({ ...current, title: value }), { action: { kind: 'study-note-field', field: 'title', opening } }).catch(() => undefined);
    };
    const changeType = (value: StudyNoteType) => {
        if (value === liveType.current) return;
        const opening = liveType.current;
        setTypeState(value);
        if (isNew) firstNoteFields.current.type = value;
        void stage(current => ({ ...current, type: value }), { action: { kind: 'study-note-field', field: 'type', opening } }).catch(() => undefined);
    };

    const rowPayload = useMemo<NoteDraftPayload | null>(() => existingNote ? {
        title: existingNote.title || '',
        content: existingNote.content || '',
        tags: existingNote.tags || [],
        scriptureRefs: existingNote.scriptureRefs || [],
        type: existingNote.type || 'note',
        ...noteRecordingMetadata(existingNote.dictationSourceIds, existingNote.recordingSourceIds),
    } : null, [existingNote]);

    // A legacy copy can still be read and explicitly imported into the engine.
    const draftPayload: NoteDraftPayload = useMemo(
        () => ({ title, content, tags, scriptureRefs, type, ...noteRecordingMetadata(dictationSourceIds, recordingSourceIds) }),
        [title, content, tags, scriptureRefs, type, dictationSourceIds, recordingSourceIds]
    );

    const isSettledLegacyCopy = useCallback((copy: { value: NoteDraftPayload; base?: unknown }) =>
        !isNew && !isRecordingOnlyNoteDraft(copy.value) && holdsNothingUnsent(copy, noteId, bibleLocale),
    [isNew, noteId, bibleLocale]);

    const { recovered, recoveredBase, recoveredKey, recoveries, selectRecovered, settleRecovered, acceptRecovered, discardRecovered, captureRecoveredDiscard } = useDurableDraft<NoteDraftPayload>({
        uid, docId: draftDocId, writerId: draftWriterId, findCopies: findNoteDraftCopies,
        isSettledCopy: isSettledLegacyCopy,
        preferredRecoveryKey: openingRecoveryKey, recoveryIdentity: routeId === 'new' ? openingDraftId : noteId,
        aggregate: 'note', value: draftPayload, enabled: false,
        confirmedValue: noteIsAccepted ? rowPayload : undefined,
    });

    // Recovery compares the complete shown payload; delivery remains owned by the shared draft mechanism.
    const recoveredDraft = useMemo(() => (recovered ? withNoteReferenceBibles(recovered, bibleLocale) : recovered), [recovered, bibleLocale]);
    // Audio-only metadata contains no authored fields to restore. Its own card already
    // offers explicit recognition; adopt only the source links and avoid a second prompt.
    useEffect(() => {
        if (!recoveredDraft || !isRecordingOnlyNoteDraft(recoveredDraft)) return;
        const sources = recoveredDraft.recordingSourceIds!;
        setOwnedAudioSources(previous => [...new Set([...previous, ...sources])]);
        if (isNew) firstNoteFields.current.recordingSourceIds = [...new Set([...firstNoteFields.current.recordingSourceIds ?? [], ...sources])];
        acceptRecovered();
    }, [recoveredDraft, acceptRecovered, isNew]);
    const offeredWords = recoveredDraft && !isRecordingOnlyNoteDraft(recoveredDraft) ? recoveredDraft : null;
    // A copy whose words are its own base holds nothing unsent (`holdsNothingUnsent`): settled like words already shown.
    const unsentCopy = useCallback((copy: { value: NoteDraftPayload; base?: unknown }) =>
        !holdsNothingUnsent(copy, noteId, bibleLocale), [noteId, bibleLocale]);
    const offeredCopies = useMemo(() => recoveries.filter(unsentCopy), [recoveries, unsentCopy]);
    const importingLegacy = useRef<object | null>(null);
    const copyContainsOnlyItsOpening = offeredWords !== null && !unsentCopy({ value: offeredWords, base: recoveredBase });
    const settleLegacyCopy = useCallback(() => settleRecovered(copyContainsOnlyItsOpening ? recovered ?? undefined : undefined),
        [settleRecovered, copyContainsOnlyItsOpening, recovered]);
    const unsavedRecovery = useNoteDraftOffer(offeredWords, draftPayload, isInitialized && !importingLegacy.current, settleLegacyCopy, recoveredKey, copyContainsOnlyItsOpening);
    const { held: draftHeld, answer: answerDraftQuestion } = useDraftQuestion(JSON.stringify([uid, draftWriterId]), unsavedRecovery !== null);
    const isEditing = writesNow(editingWanted, draftHeld ? unsavedRecovery : null) && (!ordinarySession || Boolean(bodySession.state));
    // Restoring a field from history can open the editor while the reading view is open.
    useEffect(() => { if (isEditing) setReading(false); }, [isEditing]);

    const restoredContent = useRef<{ value: string } | null>(null);
    useLayoutEffect(() => {
        const shown = projected ?? (ordinarySession ? null : existingNote);
        if (!shown) return;
        const body = shown.content || '';
        if (restoredContent.current?.value === body) {
            restoredContent.current = null;
            replaceContent(body);
        } else setContent(body);
        setTitleState(shown.title || '');
        setTypeState(shown.type || 'note');
        const replaceList = <T,>(old: T[], next: T[]) => serializeContent(old) === serializeContent(next) ? old : next;
        setTags(old => replaceList(old, shown.tags));
        setScriptureRefs(old => replaceList(old, shown.scriptureRefs));
        setDictationSourceIds(old => replaceList(old, shown.dictationSourceIds ?? []));
        setRecordingSourceIds(old => replaceList(old, shown.recordingSourceIds ?? shown.dictationSourceIds ?? []));
    }, [ordinarySession, projected, existingNote, setContent, replaceContent, setTitleState, setTypeState, setTags, setScriptureRefs, setDictationSourceIds, setRecordingSourceIds]);

    useEffect(() => {
        if (!ordinarySession || routeId !== 'new' || createdNoteId || !bodySession.data || !bodySession.state) return;
        const { confirmed, pending } = bodySession.state.checkpoint;
        if (!confirmed.value && !Object.keys(pending).length) return;
        window.history.replaceState(null, '', `/studies/${encodeURIComponent(sessionId)}`);
        setCreatedNoteId(sessionId);
    }, [ordinarySession, routeId, createdNoteId, bodySession.data, bodySession.state, sessionId]);

    // A matching first copy must not hide a different unfinished version.
    useEffect(() => {
        if (!recoveredDraft || !sameNoteDraft(recoveredDraft, draftPayload)) return;
        const alternative = offeredCopies.find(copy => !sameNoteDraft(withNoteReferenceBibles(copy.value, bibleLocale), draftPayload));
        if (alternative) selectRecovered(alternative.key);
    }, [recoveredDraft, draftPayload, offeredCopies, bibleLocale, selectRecovered]);

    const editorIsDirty = Boolean(bodySession.state?.checkpoint.dirty);
    const recoveredChoice = useRef({ uid, noteId, sessionId, recovered, recoveredKey });
    recoveredChoice.current = { uid, noteId, sessionId, recovered, recoveredKey };
    const applyRecovered = () => {
        if (!ordinarySession || !bodySession.state || !unsavedRecovery || importingLegacy.current) return;
        const selected = recoveredChoice.current;
        importingLegacy.current = selected;
        const retireCopy = captureRecoveredDiscard();
        const basis = resumedNoteBaseline(recoveredBase, unsavedRecovery, rowPayload, noteId, bibleLocale);
        const targetGeneration = unsavedRecovery.targetGeneration;
        const generationMatches = targetGeneration === undefined || targetGeneration === bodySession.confirmed?.metadata?.generation;
        const edits = legacyStudyNoteEdits(basis, unsavedRecovery, generationMatches);
        const undoable = { value: unsavedRecovery.content };
        if (content !== undoable.value && (isNew || edits.some(edit => edit.field === 'content'))) restoredContent.current = undoable;
        if (isNew) {
            firstNoteFields.current = { type: unsavedRecovery.type,
                ...noteRecordingMetadata(unsavedRecovery.dictationSourceIds, unsavedRecovery.recordingSourceIds) };
            setTypeState(unsavedRecovery.type);
        }
        const saved = isNew
            ? stage(current => ({ ...current, ...legacyStudyNoteCreationFields(unsavedRecovery) }))
            : bodySession.importLegacyStudyNote(edits);
        void saved.then(() => {
            // The engine durably holds this exact source, even if another copy is now selected.
            retireCopy();
            const current = recoveredChoice.current;
            if (current.uid !== selected.uid || current.sessionId !== selected.sessionId) return;
            answerDraftQuestion();
            setIsEditing(true);
        }).catch(() => {
            if (restoredContent.current === undoable) restoredContent.current = null;
        }).finally(() => {
            if (importingLegacy.current === selected) importingLegacy.current = null;
        });
    };

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
    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
    const [textScrollRoot, setTextScrollRoot] = useState<HTMLDivElement | null>(null);
    const scrollLayout = noteScrollLayout(isWideViewport, navHeight, belowHeader, textScrollRoot);
    useNoteScrollIsolation(scrollRoot, showPanel);
    useNoteScrollPosition(textScrollRoot, isWideViewport, noteId, createdNoteId);

    // Narrow screens get the same content from the bottom instead of the side: the outline,
    // the properties and the dates, on request, so the text never gives up width for them.
    const roomyHeader = useRoomyHeader();
    const [sheetOpen, setSheetOpen] = useState(false);
    const openSheet = useCallback(() => setSheetOpen(true), []);
    const closeSheet = useCallback(() => {
        // Escape belongs to the passage window while it covers the properties tray.
        if (!previewReference) setSheetOpen(false);
    }, [previewReference]);
    // The properties live in EXACTLY ONE place at a time — the panel, the sheet, or the
    // tray under the editor — because each of them carries live inputs and pickers.
    const propertiesInSheet = !isWideViewport && !isEditing;
    // The controls fold away while reading; not while editing, where they are the work.
    // Deliberately NOT disabled while the sheet is open: turning the hook off resets it,
    // and the header sprang back open the moment the sheet came up — a jump the reader
    // did not ask for, on the layer they were not looking at.
    const headerCollapsed = useCollapseOnScroll(!roomyHeader && !isEditing, noteId);

    // Off while the reading mode is open: it draws the same sections over the page, and a search of the whole document
    // would find its copies; the mode counts its own sections.
    const activeSectionId = useActiveSection(scrollLayout.activeOffset, !isEditing && !reading && (showPanel || !isWideViewport), noteId, scrollLayout.activeRoot);
    // Once reading has started the sticky line says which section you are in — the note's
    // title is the one thing the reader already knows.
    const activeSection = findSectionById(outlineControl.outline.sections, activeSectionId);
    const sectionLabel = headerCollapsed && activeSection
        ? sectionDisplayLabel(activeSection, t('textOutline.untitledSection')) : null;
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
        isTargetRunning, isSourceAnalyzing, isVoiceProcessing, aiBlocked, dictationBlocked, dictationBlockedKey, handleAIAnalyze, handleVoiceRecordingComplete,
        voiceError, voiceRetryCount, voiceMaxRetries, handleRetryVoice, handleClearVoiceError,
        resendVoiceBlob, voiceController,
        pendingAnalysisResult, pendingAnalysisKey, dismissAnalysisResult, handleApplyAnalysis
    } = useNoteAIAssistant({
        noteId, recordingContextId, content, availableTags, setTitle: changeTitle, appendDictation, setScriptureRefs: changeReferences, setTags: changeTags,
        t, uid, liveDictation, linkedRecordingSourceIds, onSourcePersisted,
        acceptedDictationSourceIds: bodySession.confirmed?.value?.dictationSourceIds as string[] | undefined
    });

    // ─── HANDLERS ─────────────────────────────────────────────────────────

    const handleBack = () => {
        const query = new URLSearchParams(searchParams.toString());
        query.delete('draft');
        query.delete('draftOwner');
        const queryParams = query.toString();
        router.push(queryParams ? `/studies?${queryParams}` : '/studies');
    };

    const { confirm, confirmDialog } = useConfirm();
    const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion('text');
    useEffect(() => () => { withdraw(); }, [uid, noteId, withdraw]);
    const forgetRecovered = async () => {
        if (!recovered) return;
        const shown = JSON.stringify(recovered);
        const shownKey = recoveredKey;
        await askBeforeDiscard(true, () => { discardRecovered(); answerDraftQuestion(); }, () => {
            const current = recoveredChoice.current;
            return current.uid === uid && current.noteId === noteId && current.recoveredKey === shownKey && JSON.stringify(current.recovered) === shown;
        });
    };
    const handleDelete = useNoteDeletion({
        confirm,
        noteId,
        isNew,
        uid,
        deleteNote,
        removeFromSession: ordinarySession ? bodySession.remove : undefined,
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

    const setTagMembership = (tag: string, present: boolean) => {
        changeTags(current => present ? [...new Set([...current, tag])] : current.filter(item => item !== tag));
    };
    const addTag = () => {
        const value = tagInput.trim();
        if (!value) return;
        setTagMembership(value, true);
        setTagInput('');
    };
    const toggleTag = (tag: string) => setTagMembership(tag, !tags.includes(tag));

    const commentView = commentPageView(type, title, scriptureRefs, bibleLocale);

    // The note's own properties. They are ONE instance, handed either to the side
    // panel or to the narrow-screen tray below the text — never both, because each
    // carries live inputs and pickers.
    const renderScriptureRefs = () => (
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
                                    onClick={() => handleAIAnalyze('scriptureRefs', 'scriptureRefs')}
                                    disabled={isTargetRunning('scriptureRefs') || !content.trim() || aiBlocked}
                                    aria-busy={isSourceAnalyzing('scriptureRefs')}
                                    title={isSourceAnalyzing('scriptureRefs')
                                        ? t('studiesWorkspace.aiAnalyze.analyzing')
                                        : aiBlocked ? t(AI_USAGE_EXHAUSTED_KEY) : t('studiesWorkspace.aiAnalyze.findRefs', { defaultValue: 'Find Scripture Refs' })}
                                    // While it runs the button drops out of the hover-reveal: a control
                                    // the person just pressed must not vanish when the pointer leaves
                                    // the section, or its own feedback becomes invisible.
                                    className={`relative flex items-center justify-center rounded-full p-1.5 transition-opacity focus-visible:opacity-100 text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors ${isSourceAnalyzing('scriptureRefs')
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover/refs:opacity-100 disabled:opacity-50'}`}
                                >
                                    {isSourceAnalyzing('scriptureRefs') && <AiBusyComet inset="-inset-[6px]" />}
                                    <SparklesIcon className="relative h-5 w-5" />
                                </button>
                            )}
                        </div>

                        {scriptureRefs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {scriptureRefs.map(ref => (
                                    <ScriptureRefBadge
                                        key={ref.id}
                                        reference={ref}
                                        isEditing={isEditing && editingReference?.initial.id === ref.id}
                                        onClick={isEditing ? () => {
                                            setEditingReference({ initial: ref, apply: next => changeReferences(previous =>
                                                previous.map(item => item.id === ref.id ? { ...next, id: ref.id } : item)) });
                                            setShowRefPicker(false);
                                        } : () => setPreviewReference(ref)}
                                        tone={commentView.refTone}
                                        onRemove={isEditing ? () => changeReferences(prev => prev.filter(item => item.id !== ref.id)) : undefined}
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
                                            // Typed in the Bible its book's name is written in — the note's words decide one Russian
                                            // and Ukrainian write alike ("1Цар") — and kept so.
                                            const parsed = referenceFromTyped(quickRefInput.trim(), { locale: bibleLocale, written: textLanguage(`${title}\n${content}`) });
                                            if (!parsed) { setQuickRefError({ key: 'studiesWorkspace.quickRefError' }); return; }
                                            changeReferences(prev => [...prev, { ...parsed, id: makeId() }]);
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
                        {isEditing && quickRefError && <p className="text-xs text-red-500 mt-1">{sayFailure(quickRefError, t)}</p>}

                        {showRefPicker && (
                            <ScriptureRefPicker
                                mode="add"
                                onConfirm={(ref) => { changeReferences(prev => [...prev, { ...ref, id: makeId() }]); setShowRefPicker(false); }}
                                onCancel={() => setShowRefPicker(false)}
                            />
                        )}

                        {editingReference && (
                            <ScriptureRefPicker
                                mode="edit"
                                initialRef={editingReference.initial}
                                onConfirm={ref => { editingReference.apply(ref); setEditingReference(null); }}
                                onCancel={() => setEditingReference(null)}
                            />
                        )}
                    </div>
        </>
    );
    const scriptureRefsBlock = renderScriptureRefs();

    const tagHistory = uid && !isNew && !unavailable && existingNote ? observeTagBasis?.(noteId, tags) : undefined;
    const tagsBlock = commentView.tags(
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
                                    onClick={() => handleAIAnalyze('tags', 'tags')}
                                    disabled={isTargetRunning('tags') || !content.trim() || aiBlocked}
                                    aria-busy={isSourceAnalyzing('tags')}
                                    title={isSourceAnalyzing('tags')
                                        ? t('studiesWorkspace.aiAnalyze.analyzing')
                                        : aiBlocked ? t(AI_USAGE_EXHAUSTED_KEY) : t('studiesWorkspace.aiAnalyze.generateTags', { defaultValue: 'Generate Tags' })}
                                    // Same hover-reveal exemption as the references button: while it
                                    // works, it stays on screen.
                                    className={`relative flex items-center justify-center rounded-full p-1.5 transition-opacity focus-visible:opacity-100 text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors ${isSourceAnalyzing('tags')
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover/tags:opacity-100 disabled:opacity-50'}`}
                                >
                                    {isSourceAnalyzing('tags') && <AiBusyComet inset="-inset-[6px]" />}
                                    <SparklesIcon className="relative h-5 w-5" />
                                </button>
                            )}
                        </div>

                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {tags.map(tag => (
                                    <Chip
                                        key={tag}
                                        tone="emerald"
                                        wrapLabel
                                        onRemove={isEditing ? () => toggleTag(tag) : undefined}
                                        removeLabel={t('studiesWorkspace.removeTag', { tag })}
                                    >
                                        {tag}
                                    </Chip>
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
                        {uid && tagHistory && <TagHistory<DocumentTagHistoryPage['entries'][number], DocumentTagHistoryPage>
                            key={JSON.stringify([uid, noteId, tagHistory.generation])} owner={uid} id={noteId} tags={tags}
                            generation={tagHistory.generation} disabled={editorIsDirty || !noteIsAccepted || draftHeld || saveConflict || isSaving}
                            identify={page => page.documentId} path={'/api/data-engine/documents/studyNotes/' + encodeURIComponent(noteId) + '/note-tag-history'}
                            select={entries => entries.flatMap(entry => entry.tags.map(tag => ({ id: entry.id, ...tag })))}
                            onRestore={async (tag, present) => {
                                setIsEditing(true);
                                setTagMembership(tag, present);
                            }} />}
                    </div>
        </>
    );

    const sermonsBlock = (
        <>
                    {/* What was preached out of this note — derived from the sermons that name
                        it, so there is nothing to keep in step. Renders only when there is one. */}
                    <SermonsBuiltOnNote
                        noteId={isNew ? undefined : noteId}
                        noteTitle={commentView.title}
                        scriptureRefs={scriptureRefs}
                        noteContent={content}
                        noteBusy={isSaving || editorIsDirty}
                    />
        </>
    );

    const renderRecoveryBanners = () => (
        <>
                {ordinarySession && <StudyNoteSessionFeedback document={bodySession} onRecover={() => setIsEditing(true)} />}
                {/* A returning user's unfinished recording waits here — survives reload / tab close. */}
                {isEditing && (
                    <RecordingDraftBanner
                        context="study"
                        contextId={recordingContextId}
                        sourceOwnerId={existingNote?.userId}
                        linkedSourceIds={linkedRecordingSourceIds}
                        onResend={resendVoiceBlob}
                        excludeDraftIds={voiceController.appliedDraftIds}
                        resendDisabled={dictationBlocked}
                        isProcessing={isVoiceProcessing}
                        className="mb-2"
                    />
                )}
                {/* Text that was typed but never confirmed saved — a closed tab, a
                    crash or a failed write. Offered, never applied silently: a stale
                    draft must not overwrite text edited later on another device. */}
                {unsavedRecovery && <NoteDraftRecovery draft={unsavedRecovery} copies={offeredCopies}
                    selectedKey={recoveredKey ?? ''} onSelect={selectRecovered} onRestore={applyRecovered}
                    onDiscard={() => { void forgetRecovered(); }} />}
        </>
    );

    const titleHistory = !isNew && !unavailable && (type === 'note' || type === 'question') && existingNote
        ? observeTitle?.(noteId, existingNote.title || '') : undefined;
    const typeHistory = !isNew && !unavailable && existingNote && isOrdinaryStudyNoteType(type)
        ? observeType?.(noteId, type) : undefined;
    const renderHeader = () => (
            <EditorHeader
                handleBack={handleBack} t={t} isEditing={isEditing} filteredNotes={filteredNotes}
                prevNoteId={prevNoteId} nextNoteId={nextNoteId} router={router} searchParams={searchParams}
                currentIndex={currentIndex} type={type} setType={changeType} isSaving={isSaving}
                lastSaved={lastSaved} hasUnsavedEdits={editorIsDirty || !noteIsAccepted} setIsEditing={changeEditing} handleDelete={handleDelete}
                handleCopy={handleCopy} isCopied={isCopied} onRead={() => {
                    const { activeRoot, activeOffset } = scrollLayout;
                    const line = (activeRoot?.getBoundingClientRect().top ?? 0) + activeOffset;
                    setReadingStart({
                        block: noteReadingBlockAtLine(noteTextRef.current, line),
                        sectionId: sectionAtLine(activeOffset, activeRoot) ?? activeSectionId,
                    });
                    setReading(true);
                }}
                headerRef={setHeaderRef} stickyTop={scrollLayout.headerTop}
                roomy={roomyHeader} collapsed={headerCollapsed} sectionLabel={sectionLabel}
                onOpenSheet={propertiesInSheet ? openSheet : undefined}
                editHeld={draftHeld}
                title={commentView.title} setTitle={changeTitle} searchQuery={searchQuery} justSaved={justSaved}
                aiMenu={
                    <NoteAiMenu
                        // Every target picked inside this menu belongs to THIS button.
                        onAnalyze={(target: NoteAiTarget) => handleAIAnalyze(target, 'menu')}
                        isRunning={isSourceAnalyzing('menu')}
                        disabled={!content.trim() || aiBlocked}
                        isTargetDisabled={isTargetRunning}
                        blockedTitle={aiBlocked ? t(AI_USAGE_EXHAUSTED_KEY) : undefined}
                    />
                }
            />
    );

    // ─── RENDER ─────────────────────────────────────────────────────────────

    if (!isNew && !isInitialized && !unsavedRecovery && presence?.kind !== 'absent' && presence?.kind !== 'deleting'
        && (notesLoading || existingNote)) return <NoteDetailSkeleton />;
    if (isNew && notesLoading) {
        if (!unsavedRecovery) return <NoteDetailSkeleton backControl={
            <button type="button" onClick={handleBack} className="font-semibold text-emerald-700 dark:text-emerald-300">{t('common.back')}</button>
        } />;
        return <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6" data-page-loading={unsavedRecovery ? undefined : ''}>
            <button type="button" onClick={handleBack} className="font-semibold text-emerald-700 dark:text-emerald-300">{t('common.back')}</button>
            <div role="status" className="flex items-center gap-2">
                <ArrowPathIcon className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />
                <span>{t('common.loading')}</span>
            </div>
            {unsavedRecovery && <RetainedNoteDraft draft={unsavedRecovery} />}
        </div>;
    }
    if (unavailable && !awaitingOwnCreate) {
        const kept = unsavedRecovery ?? (isInitialized ? draftPayload : null);
        return <RecordUnavailable presence={presence} checking={notesLoading} pageLoading={notesLoading && !kept} onBack={handleBack} onRetry={refetch}>
            {unsavedRecovery ? <NoteDraftRecovery readOnly draft={unsavedRecovery} copies={offeredCopies}
                selectedKey={recoveredKey ?? ''} onSelect={selectRecovered} onRestore={applyRecovered}
                onDiscard={() => { void forgetRecovered(); }} /> : kept && <RetainedNoteDraft draft={kept} />}
        </RecordUnavailable>;
    }

    return (
        <div data-note-workspace data-page-loading={!isInitialized && !unsavedRecovery ? '' : undefined} className="bg-white dark:bg-gray-900 flex flex-col -m-4 md:-m-6 lg:-m-8 relative">
            {/* HEADER TRAY */}
            {renderHeader()}
            {uid && titleHistory && <DocumentFieldHistory key={JSON.stringify([uid, noteId, titleHistory.generation])}
                current={title} disabled={editorIsDirty || !noteIsAccepted || draftHeld || saveConflict}
                session={{ owner: uid, noteId, generation: titleHistory.generation, restore: (value: string) => {
                    setIsEditing(true);
                    changeTitle(value);
                    return Promise.resolve();
                } }} />}
            {uid && typeHistory && <DocumentFieldHistory key={JSON.stringify([uid, noteId, typeHistory.generation, 'type'])}
                current={type} disabled={editorIsDirty || !noteIsAccepted || draftHeld || saveConflict}
                session={{ owner: uid, noteId, generation: typeHistory.generation, field: 'type', restore: async value => {
                    if (!isOrdinaryStudyNoteType(value)) return;
                    setIsEditing(true);
                    changeType(value);
                } }} />}
            {/* Erased from its own page: the page goes too, as a deleted note's does — replace, so Back does not reopen it. */}
            <NoteCommentWindow open={commentWindow.open} note={existingNote} locale={bibleLocale} onClose={commentWindow.close} onErased={() => router.replace('/studies')} />

            {/* EDITOR CONTENT */}
            <div ref={setScrollRoot} className="flex flex-1 min-h-0">
                {/* Everything about the note that is not its text. Rendered ONLY on wide
                    screens — on a phone the same blocks stay where they are today, under
                    the text, so nothing becomes unreachable. */}
                {isWideViewport && (
                    <NoteSidePanel
                        outline={outlineControl}
                        outlineShown={commentView.outlineShown}
                        foldable={!isEditing}
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

                {/* On wide screens both panes own native scrolling. The editor toolbar
                    and heading margins use this pane's coordinates, not the window's. */}
                <div ref={setTextScrollRoot} tabIndex={0} data-note-scroll-region="text" className="flex-1 min-h-0 min-w-0 px-4 py-8 md:px-8 md:py-10 pb-48 md:pb-32 lg:overflow-y-auto lg:overscroll-y-contain">
                  <div className="mx-auto w-full space-y-8">
                {renderRecoveryBanners()}
                <div className="relative group">
                    {isEditing ? (
                        <div ref={noteEditorRef} className="text-lg md:text-xl leading-relaxed">
                            <RichMarkdownEditor
                                ownedBy={ownedBy}
                                placeholder={t('studiesWorkspace.contentPlaceholder')}
                                minHeight="300px"
                                stickyToolbarTop={scrollLayout.toolbarTop}
                            />
                        </div>
                    ) : (
                        <div ref={noteTextRef} className="prose prose-emerald dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-50 prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-p:leading-relaxed max-w-none text-lg md:text-xl prose-scaled">
                            <ScriptureLinks onOpen={openTextReference} writtenIn={readingLanguage}>
                                <FoldableMarkdown
                                    content={content}
                                    searchQuery={searchQuery}
                                    control={outlineControl}
                                    showToggleAll={isWideViewport && panelCollapsed}
                                    scrollMarginTop={scrollLayout.sectionMargin}
                                />
                            </ScriptureLinks>
                        </div>
                    )}

                    {/* Recording lives WITH the text it fills — bottom-right of the editor. */}
                    {isEditing && (
                        <div className="absolute bottom-3 right-3 z-20">
                            <div className="shadow-lg rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                                <FocusRecorderButton
                                    key={voiceController.recordingKey}
                                    onRecordingComplete={handleVoiceRecordingComplete}
                                    onRecordingStateChange={voiceController.setIsRecording}
                                    preserveFocusOnPress={() => {
                                        const focused = document.activeElement;
                                        return focused instanceof HTMLElement && focused.isContentEditable
                                            && noteEditorRef.current?.contains(focused) === true;
                                    }}
                                    onDiscardRecording={voiceController.discard}
                                    isProcessing={isVoiceProcessing}
                                    disabled={dictationBlocked}
                                    title={dictationBlockedKey ? t(dictationBlockedKey) : undefined}
                                    onError={(words) => toast.error(sayFailure(words, t))}
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


                    {/* Narrow screens have no panel. While EDITING the properties stay under
                        the text, where the pickers have room; while READING they move into the
                        bottom sheet, so the text is the whole screen. Never both at once — each
                        block carries live inputs. On a wide screen the collapsed rail leads
                        back to them in one click. */}
                    {!isWideViewport && isEditing && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-gray-100 dark:border-gray-800">
                            {scriptureRefsBlock}
                            {tagsBlock}
                            {sermonsBlock}
                        </div>
                    )}
                  </div>
                </div>
            </div>

            {propertiesInSheet && (
                <NoteMobileSheet
                    open={sheetOpen}
                    onClose={closeSheet}
                    outline={outlineControl}
                    outlineShown={commentView.outlineShown}
                    foldable={!isEditing}
                    activeSectionId={activeSectionId}
                    meta={existingNote ? <NoteDates note={existingNote} t={t} /> : undefined}
                    scriptureRefs={scriptureRefsBlock}
                    tags={tagsBlock}
                    sermons={sermonsBlock}
                />
            )}

            <TagCatalogModal
                isOpen={showTagCatalog}
                onClose={() => setShowTagCatalog(false)}
                availableTags={availableTags}
                readState={listReadState(tagSource, { loading: notesLoading, complete: notesComplete, checking: notesChecking, error: notesError })}
                selectedTags={tags}
                onToggleTag={toggleTag}
            />

            <AnalysisConfirmationModal
                key={pendingAnalysisKey ?? 'empty'}
                isOpen={!!pendingAnalysisResult}
                onClose={dismissAnalysisResult}
                result={pendingAnalysisResult}
                onApply={handleApplyAnalysis}
                bibleLocale={bibleLocale}
                currentTitle={title}
                currentTags={tags}
                currentScriptureRefs={scriptureRefs}
            />

            {/* Reading-mode text size control — same floating violet FAB as preaching view.
                It shares the sheet's stacking level and is rendered after it, so while the
                sheet is up it would sit ON the outline rows. Nothing to size while the
                text is covered anyway. */}
            {previewReference && <ScripturePreviewSheet key={previewReference.id} reference={previewReference} currentNoteId={noteId} onClose={() => setPreviewReference(null)} />}
            {!isEditing && !sheetOpen && !previewReference && !reading && <FloatingTextScaleControls />}
            {reading && !isEditing && (
                <NoteReadingView
                    noteId={noteId}
                    title={commentView.title}
                    typeLabel={t(`studiesWorkspace.type.${type}`)}
                    content={content}
                    searchQuery={searchQuery}
                    outline={outlineControl}
                    writtenIn={readingLanguage}
                    startAt={readingStart}
                    pager={readingPager.index < 0 ? null : {
                        index: readingPager.index,
                        total: readingPager.total,
                        onPrevious: readingPager.previous ? () => { const id = readingPager.previous!; handReadingTo(id); router.push(`/studies/${id}?${searchParams.toString()}`); } : null,
                        onNext: readingPager.next ? () => { const id = readingPager.next!; handReadingTo(id); router.push(`/studies/${id}?${searchParams.toString()}`); } : null,
                    }}
                    onOpenReference={openTextReference}
                    onClose={closeReading}
                />
            )}
            {confirmDialog}
            {discardDialog}
        </div>
    );
}

function EditorHeaderActions({ t, isEditing, justSaved, isSaving, lastSaved, hasUnsavedEdits, handleCopy, isCopied, onRead, setIsEditing, editHeld = false, handleDelete, aiMenu, folded = false }: Pick<EditorHeaderProps, 't' | 'isEditing' | 'justSaved' | 'isSaving' | 'lastSaved' | 'hasUnsavedEdits' | 'handleCopy' | 'isCopied' | 'onRead' | 'setIsEditing' | 'editHeld' | 'handleDelete' | 'aiMenu'> & {
    /** The phone row these actions sit in folded away while reading: its menu closes with it. */
    folded?: boolean;
}) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const copyLabel = isCopied ? t('common.copied') : t('common.copy');

    useEffect(() => {
        if (folded) setShowMenu(false);
    }, [folded]);

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
        <>
            {isEditing && aiMenu}
            <div className={`text-sm flex items-center gap-1.5 text-gray-500 dark:text-gray-400 ${isEditing || justSaved ? '' : 'hidden'}`}>
                {isSaving ? (
                    <><ArrowPathIcon className="h-4 w-4 animate-spin" /> <span>{t('common.saving')}</span></>
                ) : lastSaved && !hasUnsavedEdits ? (
                    /* "Saved" means THIS text is on the server — not "a save happened once".
                       Found in the browser: the tick stayed up while newer keystrokes sat
                       unsent, which is the one claim this whole migration exists to stop
                       the app from making. */
                    <><CheckCircleIcon className="h-4 w-4 text-emerald-500" /> <span className="hidden sm:inline">{t('common.saved')}</span></>
                ) : null}
            </div>

            {!isEditing && (
                <button
                    type="button"
                    onClick={onRead}
                    className="inline-flex items-center justify-center rounded-lg bg-gray-100 p-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                    title={t('notePanel.readingMode')}
                    aria-label={t('notePanel.readingMode')}
                >
                    <Glasses className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                </button>
            )}

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
                disabled={editHeld}
                className={`p-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isEditing
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                title={isEditing ? t('common.done') : t('common.edit')}
                aria-label={isEditing ? t('common.done') : t('common.edit')}
            >
                {isEditing ? <CheckIcon className="h-5 w-5" /> : <PencilIcon className="h-5 w-5" />}
            </button>

            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                    title={t('common.more')}
                    aria-label={t('common.more')}
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
        </>
    );
}

function EditorTitleField({ isEditing, title, setTitle, t, searchQuery }: Pick<EditorHeaderProps, 'isEditing' | 'title' | 'setTitle' | 't' | 'searchQuery'>) {
    return isEditing ? (
        <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('studiesWorkspace.titlePlaceholder')}
            aria-label={t('studiesWorkspace.titlePlaceholder')}
            className={`w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-center font-bold text-gray-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-50 dark:focus:border-emerald-500 dark:focus:ring-emerald-900 ${noteTitleSizeClass(title)}`}
        />
    ) : (
        <h1
            className={`break-words text-center font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-50 ${noteTitleSizeClass(title)}`}
            title={title || undefined}
        >
            {renderEditorTitle(title, searchQuery, t)}
        </h1>
    );
}

function renderEditorTitle(title: string, searchQuery: string, t: EditorHeaderProps['t']) {
    if (!title) return t('studiesWorkspace.untitled');
    return searchQuery ? <HighlightedText text={title} searchQuery={searchQuery} /> : title;
}
