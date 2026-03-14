'use client';

import { ArrowLeftIcon, ArrowPathIcon, CheckCircleIcon, SparklesIcon, TagIcon, BookmarkIcon, PlusIcon, BookOpenIcon, XMarkIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, QuestionMarkCircleIcon, PencilIcon, TrashIcon, CheckIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useMemo, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import { FocusRecorderButton } from '@/components/FocusRecorderButton';
import {
    RichMarkdownEditor,
    type OutlineBranchSelectionRequest,
    type PendingHeadingSelectionRequest,
    type PendingMarkdownInsertionRequest,
} from '@/components/ui/RichMarkdownEditor';
import { useClipboard } from '@/hooks/useClipboard';
import { studyNoteBranchStatesKey, useStudyNoteBranchStates } from '@/hooks/useStudyNoteBranchStates';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import {
    ScriptureReference,
    StudyNoteBranchKind,
    StudyNote,
    StudyNoteBranchOverlayTone,
    StudyNoteBranchState,
    StudyNoteBranchStateRecord,
    StudyNoteBranchStatus,
} from '@/models/models';
import {
    getStudyNoteBranchState,
    updateStudyNoteBranchState,
} from '@/services/studies.service';
import { deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import { debugLog } from '@/utils/debugMode';
import {
    buildStudyNoteBranchMarkdownReference,
    getStudyNoteBranchHash,
    parseStudyNoteBranchIdFromHash,
} from '@/utils/studyNoteBranchLinks';
import HighlightedText from '@components/HighlightedText';
import MarkdownDisplay from '@components/MarkdownDisplay';

import AnalysisConfirmationModal, { AnalysisResultData } from '../AnalysisConfirmationModal';
import { BibleLocale } from '../bibleData';
import {
    createStudyNoteBranchStateRecord,
    filterKnownBranchIds,
    hydrateStudyNoteBranchIdentity,
    mapFoldedBranchIdsToKeys,
    normalizeStudyNoteBranchKind,
    normalizeStudyNoteBranchSemanticLabel,
    normalizeStudyNoteBranchStatus,
    upsertStudyNoteBranchStateRecords,
} from '../components/studyNoteBranchIdentity';
import {
    findStudyNoteOutlineBranchByKey,
    findStudyNoteOutlinePreviousSiblingKey,
    getCollapsibleStudyNoteBranchKeys,
    parseStudyNoteOutline,
    remapStudyNoteOutlineKeyIgnoringHeadingLevel,
    flattenStudyNoteOutlineBranches,
} from '../components/studyNoteOutline';
import {
    insertStudyNoteOutlineBranch,
    insertStudyNoteOutlineRootBranch,
    moveStudyNoteOutlineBranch,
    shiftStudyNoteOutlineBranchDepth,
} from '../components/studyNoteOutlineActions';
import { StudyNoteOutlineView } from '../components/StudyNoteOutlineView';
import { STUDIES_INPUT_SHARED_CLASSES } from '../constants';
import { parseReferenceText } from '../referenceParser';
import ScriptureRefBadge from '../ScriptureRefBadge';
import ScriptureRefPicker from '../ScriptureRefPicker';
import TagCatalogModal from '../TagCatalogModal';
import { filterAndSortStudyNotes } from '../utils/filterStudyNotes';
import {
    buildStudyNoteMetadataSummaryMap,
    type StudyNoteMetadataLabelFilter,
    type StudyNoteMetadataSummary,
} from '../utils/studyNoteMetadataSummary';

import { useResizableOutlinePreview } from './useResizableOutlinePreview';

const makeId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// Local helper until API has a specific noteId delete
const deleteStudyNoteShareLinkByNoteId = async (userId: string, noteId: string, currentLinks: { noteId: string; id: string }[]) => {
    const link = currentLinks.find(l => l.noteId === noteId);
    if (link) {
        await deleteStudyNoteShareLink(userId, link.id);
    }
};

function useFilteredNotes(
    notes: StudyNote[],
    searchParams: URLSearchParams,
    bibleLocale: BibleLocale,
    noteMetadataSummaryByNoteId?: Map<string, StudyNoteMetadataSummary>
) {
    const params = useParams();
    const noteId = params.id as string;

    const searchQuery = searchParams.get('search')?.trim() || '';
    const tagFilter = searchParams.get('tag') || '';
    const bookFilter = searchParams.get('book') || '';
    const activeTab = searchParams.get('tab') || 'all';
    const branchKindFilter = normalizeStudyNoteBranchKind(
        (searchParams.get('branchKind') as StudyNoteBranchKind | null) ?? null
    ) ?? '';
    const branchStatusFilter = normalizeStudyNoteBranchStatus(
        (searchParams.get('branchStatus') as StudyNoteBranchStatus | null) ?? null
    ) ?? '';
    const branchLabelFilter: StudyNoteMetadataLabelFilter =
        searchParams.get('branchLabel') === 'labeled' ? 'labeled' : 'all';

    const searchTokens = useMemo(() => searchQuery.toLowerCase().split(/\s+/).filter(Boolean), [searchQuery]);

    const filteredNotes = useMemo(() => {
        return filterAndSortStudyNotes({
            notes,
            activeTab: activeTab as 'all' | 'notes' | 'questions',
            tagFilter,
            bookFilter,
            searchTokens,
            branchKindFilter,
            branchStatusFilter,
            branchLabelFilter,
            noteMetadataSummaryByNoteId,
            bibleLocale,
        });
    }, [
        notes,
        activeTab,
        tagFilter,
        bookFilter,
        searchTokens,
        branchKindFilter,
        branchStatusFilter,
        branchLabelFilter,
        noteMetadataSummaryByNoteId,
        bibleLocale,
    ]);

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
function useNoteDeletion({ t, noteId, isNew, uid, deleteNote, router }: any) {
    return async () => {
        if (window.confirm(t('studiesWorkspace.deleteConfirm'))) {
            if (noteId && !isNew && uid) {
                try {
                    await deleteNote(noteId);
                } catch (e) {
                    debugLog('Study note delete failed', { noteId, error: e });
                }
                try {
                    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE || ''}/api/studies/share-links?userId=${uid}`);
                    if (res.ok) {
                        const links = await res.json();
                        await deleteStudyNoteShareLinkByNoteId(uid, noteId, links);
                    }
                } catch (e) {
                    debugLog('Study note share-link delete failed', { noteId, error: e });
                }
            }
            router.push('/studies');
        }
    };
}

function useNoteAutoSave({
    noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, updateNote, createNote, uid, setCreatedNoteId, t
}: {
    noteId: string; isNew: boolean; isInitialized: boolean; existingNote?: StudyNote; title: string;
    content: string; tags: string[]; scriptureRefs: ScriptureReference[]; type: 'note' | 'question';
    updateNote: (args: { id: string; updates: Partial<StudyNote> }) => Promise<StudyNote>;
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) => Promise<StudyNote>;
    uid: string | undefined; setCreatedNoteId: (id: string) => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const saveChanges = useCallback(async () => {
        if (!noteId || !isInitialized) return;

        if (isNew) {
            if (!title.trim() && !content.trim() && tags.length === 0 && scriptureRefs.length === 0) return;

            setIsSaving(true);
            setSaveError(null);
            try {
                const newNote = await createNote({
                    title, content, tags, scriptureRefs, type,
                    userId: uid ?? '', materialIds: [], relatedSermonIds: []
                });
                setLastSaved(new Date());
                window.history.replaceState(null, '', `/studies/${newNote.id}`);
                setCreatedNoteId(newNote.id);
            } catch (e) {
                debugLog('Study note auto-create failed', { noteId, error: e });
                setSaveError(t('common.saveError') || 'Error saving changes');
            } finally {
                setIsSaving(false);
            }
            return;
        }

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
            debugLog('Study note auto-save failed', { noteId, error: e });
            setSaveError(t('common.saveError') || 'Error saving changes');
        } finally {
            setIsSaving(false);
        }
    }, [noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, updateNote, createNote, uid, setCreatedNoteId, t]);

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
    content, availableTags, setTitle, setContent, setScriptureRefs, setTags, t
}: {
    content: string; availableTags: string[];
    setTitle: (t: string) => void; setContent: (c: string | ((prev: string) => string)) => void;
    setScriptureRefs: (refs: ScriptureReference[] | ((prev: ScriptureReference[]) => ScriptureReference[])) => void; setTags: (tags: string[] | ((prev: string[]) => string[])) => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);

    const [pendingAnalysisResult, setPendingAnalysisResult] = useState<AnalysisResultData | null>(null);

    const handleAIAnalyze = async (analysisType: 'all' | 'title' | 'tags' | 'scriptureRefs' = 'all') => {
        if (!content.trim()) {
            toast.error(t('studiesWorkspace.aiAnalyze.emptyContent') || 'Please enter note content');
            return;
        }

        setIsAnalyzing(true);
        try {
            const response = await fetch('/api/studies/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, existingTags: availableTags, analysisType }),
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

        } catch {
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

    return {
        isAnalyzing, isVoiceProcessing, handleAIAnalyze, handleVoiceRecordingComplete,
        pendingAnalysisResult, setPendingAnalysisResult, handleApplyAnalysis
    };
}

function useStructuredOutlineState({
    content,
    noteId,
    uid,
    isNew,
    isContentReady,
}: {
    content: string;
    noteId: string;
    uid: string | undefined;
    isNew: boolean;
    isContentReady: boolean;
}) {
    const queryClient = useQueryClient();
    const parsedOutline = useMemo(() => parseStudyNoteOutline(content), [content]);
    const [branchRecords, setBranchRecords] = useState<StudyNoteBranchStateRecord[]>([]);
    const [readFoldedBranchIds, setReadFoldedBranchIds] = useState<string[]>([]);
    const [previewFoldedBranchIds, setPreviewFoldedBranchIds] = useState<string[]>([]);
    const [hasLoadedBranchState, setHasLoadedBranchState] = useState(false);
    const lastPersistedSnapshotRef = useRef<string>('');
    const preserveLocalBranchRecordsOnLoadRef = useRef(false);
    const preserveLocalReadFoldStateOnLoadRef = useRef(false);
    const preserveLocalPreviewFoldStateOnLoadRef = useRef(false);

    const getAncestorBranchKeys = useCallback((branchKey: string) => {
        const pathSegments = branchKey.split('.');
        return pathSegments
            .slice(0, -1)
            .map((_, index) => pathSegments.slice(0, index + 1).join('.'));
    }, []);

    useEffect(() => {
        setBranchRecords([]);
        setReadFoldedBranchIds([]);
        setPreviewFoldedBranchIds([]);
        lastPersistedSnapshotRef.current = '';
        preserveLocalBranchRecordsOnLoadRef.current = false;
        preserveLocalReadFoldStateOnLoadRef.current = false;
        preserveLocalPreviewFoldStateOnLoadRef.current = false;

        if (!uid || isNew) {
            setHasLoadedBranchState(true);
            return;
        }

        let isCancelled = false;
        setHasLoadedBranchState(false);

        void getStudyNoteBranchState(noteId, uid)
            .then((branchState) => {
                if (isCancelled) {
                    return;
                }

                const loadedBranchRecords = branchState?.branchRecords ?? [];
                const loadedReadFoldedBranchIds = branchState?.readFoldedBranchIds ?? [];
                const loadedPreviewFoldedBranchIds = branchState?.previewFoldedBranchIds ?? [];
                const shouldPreserveLocalBranchRecords = preserveLocalBranchRecordsOnLoadRef.current;
                const shouldPreserveLocalReadFoldState = preserveLocalReadFoldStateOnLoadRef.current;
                const shouldPreserveLocalPreviewFoldState = preserveLocalPreviewFoldStateOnLoadRef.current;

                setBranchRecords((currentRecords) => (
                    shouldPreserveLocalBranchRecords
                        ? currentRecords
                        : loadedBranchRecords
                ));
                setReadFoldedBranchIds((currentBranchIds) => (
                    shouldPreserveLocalReadFoldState
                        ? currentBranchIds
                        : loadedReadFoldedBranchIds
                ));
                setPreviewFoldedBranchIds((currentBranchIds) => (
                    shouldPreserveLocalPreviewFoldState
                        ? currentBranchIds
                        : loadedPreviewFoldedBranchIds
                ));
                preserveLocalBranchRecordsOnLoadRef.current = false;
                preserveLocalReadFoldStateOnLoadRef.current = false;
                preserveLocalPreviewFoldStateOnLoadRef.current = false;
                lastPersistedSnapshotRef.current = JSON.stringify({
                    branchRecords: loadedBranchRecords,
                    readFoldedBranchIds: loadedReadFoldedBranchIds,
                    previewFoldedBranchIds: loadedPreviewFoldedBranchIds,
                });
                setHasLoadedBranchState(true);
            })
            .catch((error) => {
                debugLog('Study note branch-state load failed', { noteId, error });
                if (!isCancelled) {
                    setHasLoadedBranchState(true);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [isNew, noteId, uid]);

    const hydratedOutlineState = useMemo(
        () => hydrateStudyNoteBranchIdentity(parsedOutline.branches, branchRecords),
        [branchRecords, parsedOutline.branches]
    );
    const noteOutline = useMemo(
        () => ({
            ...parsedOutline,
            branches: hydratedOutlineState.branches,
        }),
        [hydratedOutlineState.branches, parsedOutline]
    );
    const collapsibleBranchKeys = useMemo(
        () => getCollapsibleStudyNoteBranchKeys(noteOutline.branches),
        [noteOutline.branches]
    );

    useEffect(() => {
        if (!hasLoadedBranchState || !isContentReady) {
            return;
        }

        const nextBranchRecords = hydratedOutlineState.branchRecords;

        setBranchRecords((currentRecords) => (
            JSON.stringify(currentRecords) === JSON.stringify(nextBranchRecords)
                ? currentRecords
                : nextBranchRecords
        ));
    }, [hasLoadedBranchState, hydratedOutlineState.branchRecords, isContentReady]);

    const ensureBranchRecordsForKeys = useCallback((branchKeys: string[]): string[] => {
        const nextRecords: StudyNoteBranchStateRecord[] = [];
        const nextBranchIds: string[] = [];

        branchKeys.forEach((branchKey) => {
            const existingBranchId = hydratedOutlineState.branchIdByKey[branchKey];

            if (existingBranchId) {
                nextBranchIds.push(existingBranchId);
                return;
            }

            const nextRecord = createStudyNoteBranchStateRecord(
                noteOutline.branches,
                branchKey,
                makeId()
            );

            if (!nextRecord) {
                return;
            }

            nextRecords.push(nextRecord);
            nextBranchIds.push(nextRecord.branchId);
        });

        if (nextRecords.length > 0) {
            if (!hasLoadedBranchState) {
                preserveLocalBranchRecordsOnLoadRef.current = true;
            }
            setBranchRecords((currentRecords) =>
                upsertStudyNoteBranchStateRecords(currentRecords, nextRecords)
            );
        }

        return nextBranchIds;
    }, [hasLoadedBranchState, hydratedOutlineState.branchIdByKey, noteOutline.branches]);

    const ensureBranchIdForBranchKey = useCallback((branchKey: string): string | null => {
        return ensureBranchRecordsForKeys([branchKey])[0] ?? null;
    }, [ensureBranchRecordsForKeys]);

    const setBranchOverlayTone = useCallback((branchKey: string, overlayTone: StudyNoteBranchOverlayTone | null) => {
        const existingBranchId = hydratedOutlineState.branchIdByKey[branchKey];

        if (overlayTone === null && !existingBranchId) {
            return;
        }

        const branchId = existingBranchId ?? makeId();
        const nextRecord = createStudyNoteBranchStateRecord(noteOutline.branches, branchKey, branchId);

        if (!nextRecord) {
            return;
        }

        nextRecord.overlayTone = overlayTone;

        if (!hasLoadedBranchState) {
            preserveLocalBranchRecordsOnLoadRef.current = true;
        }

        setBranchRecords((currentRecords) =>
            upsertStudyNoteBranchStateRecords(currentRecords, [nextRecord])
        );
    }, [hasLoadedBranchState, hydratedOutlineState.branchIdByKey, noteOutline.branches]);

    const setBranchSemanticLabel = useCallback((branchKey: string, semanticLabel: string | null) => {
        const normalizedSemanticLabel = normalizeStudyNoteBranchSemanticLabel(semanticLabel);
        const existingBranchId = hydratedOutlineState.branchIdByKey[branchKey];

        if (normalizedSemanticLabel === null && !existingBranchId) {
            return;
        }

        const branchId = existingBranchId ?? makeId();
        const nextRecord = createStudyNoteBranchStateRecord(noteOutline.branches, branchKey, branchId);

        if (!nextRecord) {
            return;
        }

        nextRecord.semanticLabel = normalizedSemanticLabel;

        if (!hasLoadedBranchState) {
            preserveLocalBranchRecordsOnLoadRef.current = true;
        }

        setBranchRecords((currentRecords) =>
            upsertStudyNoteBranchStateRecords(currentRecords, [nextRecord])
        );
    }, [hasLoadedBranchState, hydratedOutlineState.branchIdByKey, noteOutline.branches]);

    const setBranchKind = useCallback((branchKey: string, branchKind: StudyNoteBranchKind | null) => {
        const normalizedBranchKind = normalizeStudyNoteBranchKind(branchKind);
        const existingBranchId = hydratedOutlineState.branchIdByKey[branchKey];

        if (normalizedBranchKind === null && !existingBranchId) {
            return;
        }

        const branchId = existingBranchId ?? makeId();
        const nextRecord = createStudyNoteBranchStateRecord(noteOutline.branches, branchKey, branchId);

        if (!nextRecord) {
            return;
        }

        nextRecord.branchKind = normalizedBranchKind;

        if (!hasLoadedBranchState) {
            preserveLocalBranchRecordsOnLoadRef.current = true;
        }

        setBranchRecords((currentRecords) =>
            upsertStudyNoteBranchStateRecords(currentRecords, [nextRecord])
        );
    }, [hasLoadedBranchState, hydratedOutlineState.branchIdByKey, noteOutline.branches]);

    const setBranchStatus = useCallback((branchKey: string, branchStatus: StudyNoteBranchStatus | null) => {
        const normalizedBranchStatus = normalizeStudyNoteBranchStatus(branchStatus);
        const existingBranchId = hydratedOutlineState.branchIdByKey[branchKey];

        if (normalizedBranchStatus === null && !existingBranchId) {
            return;
        }

        const branchId = existingBranchId ?? makeId();
        const nextRecord = createStudyNoteBranchStateRecord(noteOutline.branches, branchKey, branchId);

        if (!nextRecord) {
            return;
        }

        nextRecord.branchStatus = normalizedBranchStatus;

        if (!hasLoadedBranchState) {
            preserveLocalBranchRecordsOnLoadRef.current = true;
        }

        setBranchRecords((currentRecords) =>
            upsertStudyNoteBranchStateRecords(currentRecords, [nextRecord])
        );
    }, [hasLoadedBranchState, hydratedOutlineState.branchIdByKey, noteOutline.branches]);

    const readFoldedBranchKeys = useMemo(
        () => mapFoldedBranchIdsToKeys(readFoldedBranchIds, hydratedOutlineState.keyByBranchId),
        [hydratedOutlineState.keyByBranchId, readFoldedBranchIds]
    );
    const previewFoldedBranchKeys = useMemo(
        () => mapFoldedBranchIdsToKeys(previewFoldedBranchIds, hydratedOutlineState.keyByBranchId),
        [hydratedOutlineState.keyByBranchId, previewFoldedBranchIds]
    );

    const handleToggleReadBranch = useCallback((branchKey: string) => {
        const [branchId] = ensureBranchRecordsForKeys([branchKey]);

        if (!branchId) {
            return;
        }

        if (!hasLoadedBranchState) {
            preserveLocalReadFoldStateOnLoadRef.current = true;
        }
        setReadFoldedBranchIds((currentBranchIds) =>
            currentBranchIds.includes(branchId)
                ? currentBranchIds.filter((candidateBranchId) => candidateBranchId !== branchId)
                : [...currentBranchIds, branchId]
        );
    }, [ensureBranchRecordsForKeys, hasLoadedBranchState]);

    const handleTogglePreviewBranch = useCallback((branchKey: string) => {
        const [branchId] = ensureBranchRecordsForKeys([branchKey]);

        if (!branchId) {
            return;
        }

        if (!hasLoadedBranchState) {
            preserveLocalPreviewFoldStateOnLoadRef.current = true;
        }
        setPreviewFoldedBranchIds((currentBranchIds) =>
            currentBranchIds.includes(branchId)
                ? currentBranchIds.filter((candidateBranchId) => candidateBranchId !== branchId)
                : [...currentBranchIds, branchId]
        );
    }, [ensureBranchRecordsForKeys, hasLoadedBranchState]);

    const handleExpandAllReadBranches = useCallback(() => {
        if (!hasLoadedBranchState) {
            preserveLocalReadFoldStateOnLoadRef.current = true;
        }
        setReadFoldedBranchIds([]);
    }, [hasLoadedBranchState]);

    const handleExpandAllPreviewBranches = useCallback(() => {
        if (!hasLoadedBranchState) {
            preserveLocalPreviewFoldStateOnLoadRef.current = true;
        }
        setPreviewFoldedBranchIds([]);
    }, [hasLoadedBranchState]);

    const handleCollapseAllReadBranches = useCallback(() => {
        if (!hasLoadedBranchState) {
            preserveLocalReadFoldStateOnLoadRef.current = true;
        }
        setReadFoldedBranchIds(ensureBranchRecordsForKeys(collapsibleBranchKeys));
    }, [collapsibleBranchKeys, ensureBranchRecordsForKeys, hasLoadedBranchState]);

    const handleCollapseAllPreviewBranches = useCallback(() => {
        if (!hasLoadedBranchState) {
            preserveLocalPreviewFoldStateOnLoadRef.current = true;
        }
        setPreviewFoldedBranchIds(ensureBranchRecordsForKeys(collapsibleBranchKeys));
    }, [collapsibleBranchKeys, ensureBranchRecordsForKeys, hasLoadedBranchState]);

    const clearPreviewFoldedBranch = useCallback((branchKey: string) => {
        const branchId = hydratedOutlineState.branchIdByKey[branchKey];

        if (!branchId) {
            return;
        }

        if (!hasLoadedBranchState) {
            preserveLocalPreviewFoldStateOnLoadRef.current = true;
        }
        setPreviewFoldedBranchIds((currentBranchIds) =>
            currentBranchIds.filter((candidateBranchId) => candidateBranchId !== branchId)
        );
    }, [hasLoadedBranchState, hydratedOutlineState.branchIdByKey]);

    const revealReadBranchPath = useCallback((branchKey: string) => {
        const ancestorKeySet = new Set(getAncestorBranchKeys(branchKey));

        if (!hasLoadedBranchState) {
            preserveLocalReadFoldStateOnLoadRef.current = true;
        }
        setReadFoldedBranchIds((currentBranchIds) =>
            currentBranchIds.filter((branchId) => {
                const mappedKey = hydratedOutlineState.keyByBranchId[branchId];

                return !mappedKey || !ancestorKeySet.has(mappedKey);
            })
        );
    }, [getAncestorBranchKeys, hasLoadedBranchState, hydratedOutlineState.keyByBranchId]);

    const revealPreviewBranchPath = useCallback((branchKey: string) => {
        const ancestorKeySet = new Set(getAncestorBranchKeys(branchKey));

        if (!hasLoadedBranchState) {
            preserveLocalPreviewFoldStateOnLoadRef.current = true;
        }
        setPreviewFoldedBranchIds((currentBranchIds) =>
            currentBranchIds.filter((branchId) => {
                const mappedKey = hydratedOutlineState.keyByBranchId[branchId];

                return !mappedKey || !ancestorKeySet.has(mappedKey);
            })
        );
    }, [getAncestorBranchKeys, hasLoadedBranchState, hydratedOutlineState.keyByBranchId]);

    const persistableBranchStateSnapshot = useMemo(() => JSON.stringify({
        branchRecords: hydratedOutlineState.branchRecords,
        readFoldedBranchIds: filterKnownBranchIds(readFoldedBranchIds, hydratedOutlineState.branchRecords),
        previewFoldedBranchIds: filterKnownBranchIds(previewFoldedBranchIds, hydratedOutlineState.branchRecords),
    }), [
        hydratedOutlineState.branchRecords,
        previewFoldedBranchIds,
        readFoldedBranchIds,
    ]);

    useEffect(() => {
        if (!uid || isNew || !hasLoadedBranchState || !isContentReady) {
            return;
        }

        if (persistableBranchStateSnapshot === lastPersistedSnapshotRef.current) {
            return;
        }

        const snapshot = JSON.parse(persistableBranchStateSnapshot) as Pick<
            StudyNoteBranchState,
            'branchRecords' | 'readFoldedBranchIds' | 'previewFoldedBranchIds'
        >;

        if (
            snapshot.branchRecords.length === 0 &&
            snapshot.readFoldedBranchIds.length === 0 &&
            snapshot.previewFoldedBranchIds.length === 0
        ) {
            lastPersistedSnapshotRef.current = persistableBranchStateSnapshot;
            return;
        }

        const timeoutId = setTimeout(() => {
            void updateStudyNoteBranchState(noteId, uid, snapshot)
                .then(() => {
                    lastPersistedSnapshotRef.current = persistableBranchStateSnapshot;
                    void queryClient.invalidateQueries({
                        queryKey: studyNoteBranchStatesKey(uid),
                    });
                })
                .catch((error) => {
                    debugLog('Study note branch-state save failed', { noteId, error });
                });
        }, 1200);

        return () => clearTimeout(timeoutId);
    }, [hasLoadedBranchState, isContentReady, isNew, noteId, persistableBranchStateSnapshot, queryClient, uid]);

    return {
        noteOutline,
        branchIdByKey: hydratedOutlineState.branchIdByKey,
        keyByBranchId: hydratedOutlineState.keyByBranchId,
        isBranchStateReady: hasLoadedBranchState,
        readFoldedBranchKeys,
        previewFoldedBranchKeys,
        handleToggleReadBranch,
        handleTogglePreviewBranch,
        handleExpandAllReadBranches,
        handleExpandAllPreviewBranches,
        handleCollapseAllReadBranches,
        handleCollapseAllPreviewBranches,
        clearPreviewFoldedBranch,
        ensureBranchIdForBranchKey,
        setBranchOverlayTone,
        setBranchSemanticLabel,
        setBranchKind,
        setBranchStatus,
        revealReadBranchPath,
        revealPreviewBranchPath,
    };
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

function OutlineWorkspaceModeToggle({
    effectiveMode,
    onModeChange,
    t,
}: {
    effectiveMode: 'editor' | 'split' | 'preview';
    onModeChange: (mode: 'editor' | 'split' | 'preview') => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    const activeClassName = 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200';
    const inactiveClassName = 'border-gray-200 text-gray-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200';

    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                data-testid="study-note-layout-mode-editor"
                onClick={() => onModeChange('editor')}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    effectiveMode === 'editor' ? activeClassName : inactiveClassName
                }`}
            >
                {t('studiesWorkspace.outlinePilot.focusEditor')}
            </button>
            <button
                type="button"
                data-testid="study-note-layout-mode-split"
                onClick={() => onModeChange('split')}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    effectiveMode === 'split' ? activeClassName : inactiveClassName
                }`}
            >
                {t('studiesWorkspace.outlinePilot.focusSplit')}
            </button>
            <button
                type="button"
                data-testid="study-note-layout-mode-preview"
                onClick={() => onModeChange('preview')}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    effectiveMode === 'preview' ? activeClassName : inactiveClassName
                }`}
            >
                {t('studiesWorkspace.outlinePilot.focusPreview')}
            </button>
        </div>
    );
}

function StudyNotePreviewResizer({
    isPreviewResizing,
    onResizeStart,
    onResizeReset,
    t,
}: {
    isPreviewResizing: boolean;
    onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onResizeReset: () => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    return (
        <div className="hidden xl:flex xl:w-5 xl:flex-none xl:items-stretch xl:justify-center">
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('studiesWorkspace.outlinePilot.resizePreview')}
                title={t('studiesWorkspace.outlinePilot.resizePreview')}
                data-testid="study-note-outline-resizer"
                onPointerDown={onResizeStart}
                onDoubleClick={onResizeReset}
                className={`group/resizer flex h-full w-3 cursor-col-resize items-center justify-center rounded-full transition-colors ${
                    isPreviewResizing ? 'bg-emerald-100/70 dark:bg-emerald-900/40' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
            >
                <div className="h-16 w-1 rounded-full bg-gray-300 transition-colors group-hover/resizer:bg-emerald-400 dark:bg-gray-700 dark:group-hover/resizer:bg-emerald-500" />
            </div>
        </div>
    );
}

function StudyNoteEmptyOutline({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
    return (
        <div
            data-testid="study-note-outline-empty"
            className="not-prose rounded-[28px] border border-dashed border-gray-200 bg-white/80 px-5 py-5 text-sm leading-6 text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400"
        >
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">
                {t('studiesWorkspace.outlinePilot.previewTitle')}
            </p>
            <p className="mt-3">
                {t('studiesWorkspace.outlinePilot.noBranches')}
            </p>
        </div>
    );
}

function StudyNoteContentSurface({
    isEditing,
    noteOutline,
    content,
    searchQuery,
    readFoldedBranchKeys,
    previewFoldedBranchKeys,
    handleToggleReadBranch,
    handleTogglePreviewBranch,
    handleExpandAllReadBranches,
    handleExpandAllPreviewBranches,
    handleCollapseAllReadBranches,
    handleCollapseAllPreviewBranches,
    handleSetBranchOverlayTone,
    handleSetBranchSemanticLabel,
    handleSetBranchKind,
    handleSetBranchStatus,
    isPreviewResizing,
    previewPanelWidth,
    handlePreviewResizeStart,
    handlePreviewResizeReset,
    setContent,
    handleMoveBranch,
    handleCreateBranch,
    handleShiftBranchDepth,
    outlineWorkspaceMode,
    setOutlineWorkspaceMode,
    pendingHeadingSelection,
    currentEditorOutlineBranchSelection,
    setCurrentEditorOutlineBranchSelection,
    currentEditorOutlineBranch,
    handleCreateBranchFromEditor,
    handlePendingHeadingSelectionConsumed,
    pendingMarkdownInsertion,
    handlePendingMarkdownInsertionConsumed,
    preferredOutlineActiveBranchRequest,
    onCopyBranchLink,
    onCopyBranchReference,
    onBranchLinkClick,
    onInsertBranchReference,
    t,
}: {
    isEditing: boolean;
    noteOutline: ReturnType<typeof parseStudyNoteOutline>;
    content: string;
    searchQuery: string;
    readFoldedBranchKeys: string[];
    previewFoldedBranchKeys: string[];
    handleToggleReadBranch: (branchKey: string) => void;
    handleTogglePreviewBranch: (branchKey: string) => void;
    handleExpandAllReadBranches: () => void;
    handleExpandAllPreviewBranches: () => void;
    handleCollapseAllReadBranches: () => void;
    handleCollapseAllPreviewBranches: () => void;
    handleSetBranchOverlayTone: (branchKey: string, overlayTone: StudyNoteBranchOverlayTone | null) => void;
    handleSetBranchSemanticLabel: (branchKey: string, semanticLabel: string | null) => void;
    handleSetBranchKind: (branchKey: string, branchKind: StudyNoteBranchKind | null) => void;
    handleSetBranchStatus: (branchKey: string, branchStatus: StudyNoteBranchStatus | null) => void;
    isPreviewResizing: boolean;
    previewPanelWidth: number;
    handlePreviewResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
    handlePreviewResizeReset: () => void;
    setContent: Dispatch<SetStateAction<string>>;
    handleMoveBranch: (branchKey: string, direction: 'up' | 'down') => void;
    handleCreateBranch: (branchKey: string, position: 'sibling' | 'child') => void;
    handleShiftBranchDepth: (branchKey: string, direction: 'promote' | 'demote') => void;
    outlineWorkspaceMode: 'editor' | 'split' | 'preview';
    setOutlineWorkspaceMode: Dispatch<SetStateAction<'editor' | 'split' | 'preview'>>;
    pendingHeadingSelection: PendingHeadingSelectionRequest | null;
    currentEditorOutlineBranchSelection: OutlineBranchSelectionRequest | null;
    setCurrentEditorOutlineBranchSelection: Dispatch<SetStateAction<OutlineBranchSelectionRequest | null>>;
    currentEditorOutlineBranch: ReturnType<typeof findStudyNoteOutlineBranchBySelectionRequest>;
    handleCreateBranchFromEditor: (position: 'sibling' | 'child') => void;
    handlePendingHeadingSelectionConsumed: (token: string) => void;
    pendingMarkdownInsertion: PendingMarkdownInsertionRequest | null;
    handlePendingMarkdownInsertionConsumed: (token: string) => void;
    preferredOutlineActiveBranchRequest: { key: string; token: string } | null;
    onCopyBranchLink: (branchKey: string) => void;
    onCopyBranchReference: (branchKey: string, relationLabel?: string) => void;
    onBranchLinkClick: (branchId: string) => void;
    onInsertBranchReference: (branchKey: string, relationLabel?: string) => void;
    t: ReturnType<typeof useTranslation>['t'];
}) {
    const shouldShowOutlinePreview = noteOutline.hasOutline || content.trim();
    const effectiveOutlineWorkspaceMode = shouldShowOutlinePreview ? outlineWorkspaceMode : 'editor';
    const showEditorPane = effectiveOutlineWorkspaceMode !== 'preview';
    const showPreviewPane = shouldShowOutlinePreview && effectiveOutlineWorkspaceMode !== 'editor';
    const isSplitMode = effectiveOutlineWorkspaceMode === 'split';
    if (isEditing) {
        return (
            <div className="space-y-4">
                {shouldShowOutlinePreview && (
                    <OutlineWorkspaceModeToggle
                        effectiveMode={effectiveOutlineWorkspaceMode}
                        onModeChange={setOutlineWorkspaceMode}
                        t={t}
                    />
                )}

                <div className={`flex flex-col gap-6 ${isSplitMode ? 'xl:flex-row xl:items-start' : ''}`}>
                    {showEditorPane && (
                        <div className="min-w-0 flex-1 text-lg md:text-xl leading-relaxed">
                            <RichMarkdownEditor
                                value={content}
                                onChange={setContent}
                                placeholder={t('studiesWorkspace.contentPlaceholder') || 'Start typing your thoughts here...'}
                                minHeight="300px"
                                stickyToolbar
                                stickyToolbarTop="5rem"
                                showOutlineStructureControls
                                pendingHeadingSelection={pendingHeadingSelection}
                                outlineBranchSelection={currentEditorOutlineBranchSelection}
                                onOutlineBranchSelectionChange={setCurrentEditorOutlineBranchSelection}
                                onCreateSiblingBranch={() => handleCreateBranchFromEditor('sibling')}
                                onCreateChildBranch={() => handleCreateBranchFromEditor('child')}
                                canCreateSiblingBranch={Boolean(currentEditorOutlineBranch) || !noteOutline.hasOutline}
                                canCreateChildBranch={Boolean(
                                    currentEditorOutlineBranch && currentEditorOutlineBranch.headingLevel < 6
                                )}
                                onPendingHeadingSelectionConsumed={handlePendingHeadingSelectionConsumed}
                                pendingMarkdownInsertion={pendingMarkdownInsertion}
                                onPendingMarkdownInsertionConsumed={handlePendingMarkdownInsertionConsumed}
                            />
                        </div>
                    )}

                    {showPreviewPane && (
                        <>
                            {isSplitMode && (
                                <StudyNotePreviewResizer
                                    isPreviewResizing={isPreviewResizing}
                                    onResizeStart={handlePreviewResizeStart}
                                    onResizeReset={handlePreviewResizeReset}
                                    t={t}
                                />
                            )}

                            <aside
                                className={isSplitMode ? 'xl:sticky xl:top-24 xl:flex-none' : 'w-full'}
                                style={isSplitMode ? { width: `${previewPanelWidth}px`, maxWidth: '100%' } : undefined}
                            >
                                {noteOutline.hasOutline ? (
                                    <StudyNoteOutlineView
                                        outline={noteOutline}
                                        foldedBranchKeys={previewFoldedBranchKeys}
                                        onToggleBranch={handleTogglePreviewBranch}
                                        onExpandAll={handleExpandAllPreviewBranches}
                                        onCollapseAll={handleCollapseAllPreviewBranches}
                                        onMoveBranch={handleMoveBranch}
                                        onCreateBranch={handleCreateBranch}
                                        onShiftBranchDepth={handleShiftBranchDepth}
                                        preferredActiveBranchRequest={preferredOutlineActiveBranchRequest}
                                        showNavigator={isSplitMode}
                                        searchQuery={searchQuery}
                                        mode="preview"
                                        testId="study-note-outline-preview"
                                        onCopyBranchLink={onCopyBranchLink}
                                        onCopyBranchReference={onCopyBranchReference}
                                        onBranchLinkClick={onBranchLinkClick}
                                        onInsertBranchReference={showEditorPane ? onInsertBranchReference : undefined}
                                        onSetBranchOverlayTone={handleSetBranchOverlayTone}
                                        onSetBranchSemanticLabel={handleSetBranchSemanticLabel}
                                        onSetBranchKind={handleSetBranchKind}
                                        onSetBranchStatus={handleSetBranchStatus}
                                    />
                                ) : (
                                    <StudyNoteEmptyOutline t={t} />
                                )}
                            </aside>
                        </>
                    )}
                </div>
            </div>
        );
    }

    if (noteOutline.hasOutline) {
        return (
            <StudyNoteOutlineView
                outline={noteOutline}
                foldedBranchKeys={readFoldedBranchKeys}
                onToggleBranch={handleToggleReadBranch}
                onExpandAll={handleExpandAllReadBranches}
                onCollapseAll={handleCollapseAllReadBranches}
                preferredActiveBranchRequest={preferredOutlineActiveBranchRequest}
                searchQuery={searchQuery}
                mode="read"
                testId="study-note-outline-read"
                onCopyBranchLink={onCopyBranchLink}
                onCopyBranchReference={onCopyBranchReference}
                onBranchLinkClick={onBranchLinkClick}
                onSetBranchOverlayTone={undefined}
                onSetBranchSemanticLabel={undefined}
                onSetBranchKind={undefined}
                onSetBranchStatus={undefined}
            />
        );
    }

    return (
        <div className="prose prose-emerald dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-50 prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-p:leading-relaxed max-w-none text-lg md:text-xl">
            <MarkdownDisplay
                content={content}
                searchQuery={searchQuery}
                onBranchLinkClick={onBranchLinkClick}
            />
        </div>
    );
}

function shiftStudyNoteOutlineKey(branchKey: string, delta: number): string | null {
    const path = branchKey
        .split('.')
        .map((segment) => Number.parseInt(segment, 10));

    if (path.some((segment) => Number.isNaN(segment))) {
        return null;
    }

    const nextLastSegment = path[path.length - 1] + delta;

    if (nextLastSegment <= 0) {
        return null;
    }

    path[path.length - 1] = nextLastSegment;

    return path.join('.');
}

function getBranchSelectionOccurrenceIndex(
    branches: ReturnType<typeof parseStudyNoteOutline>['branches'],
    targetBranch: NonNullable<ReturnType<typeof findStudyNoteOutlineBranchByKey>>
): number {
    return flattenStudyNoteOutlineBranches(branches)
        .filter((branch) =>
            branch.headingLevel === targetBranch.headingLevel &&
            branch.title === targetBranch.title
        )
        .findIndex((branch) => branch.key === targetBranch.key);
}

function buildPendingHeadingSelectionRequest(
    branches: ReturnType<typeof parseStudyNoteOutline>['branches'],
    targetBranch: NonNullable<ReturnType<typeof findStudyNoteOutlineBranchByKey>>
): PendingHeadingSelectionRequest {
    return {
        token: makeId(),
        headingText: targetBranch.title,
        headingLevel: targetBranch.headingLevel,
        occurrenceIndex: getBranchSelectionOccurrenceIndex(branches, targetBranch),
    };
}

function findStudyNoteOutlineBranchBySelectionRequest(
    branches: ReturnType<typeof parseStudyNoteOutline>['branches'],
    selection: OutlineBranchSelectionRequest | null
) {
    if (!selection) {
        return null;
    }

    return flattenStudyNoteOutlineBranches(branches)
        .filter((branch) =>
            branch.headingLevel === selection.headingLevel &&
            branch.title === selection.headingText
        )[selection.occurrenceIndex] ?? null;
}

export default function StudyNoteEditorPage() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
    const noteId = createdNoteId || (params.id as string);
    const isNew = noteId === 'new';

    const { uid, notes, createNote, updateNote, deleteNote, loading: notesLoading } = useStudyNotes();
    const hasMetadataNavigationFilters = useMemo(
        () =>
            Boolean(searchParams.get('branchKind') || searchParams.get('branchStatus')) ||
            searchParams.get('branchLabel') === 'labeled',
        [searchParams]
    );
    const { branchStates } = useStudyNoteBranchStates({ enabled: hasMetadataNavigationFilters });
    const { tags: tagData } = useTags(uid);

    // Local state for the editor
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);
    const [type, setType] = useState<'note' | 'question'>('note');
    const [isEditing, setIsEditing] = useState(isNew);
    const [outlineWorkspaceMode, setOutlineWorkspaceMode] = useState<'editor' | 'split' | 'preview'>('split');
    const [pendingHeadingSelection, setPendingHeadingSelection] = useState<PendingHeadingSelectionRequest | null>(null);
    const [pendingMarkdownInsertion, setPendingMarkdownInsertion] = useState<PendingMarkdownInsertionRequest | null>(null);
    const [preferredOutlineActiveBranchRequest, setPreferredOutlineActiveBranchRequest] = useState<{ key: string; token: string } | null>(null);
    const [currentEditorOutlineBranchSelection, setCurrentEditorOutlineBranchSelection] = useState<OutlineBranchSelectionRequest | null>(null);

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
    const noteMetadataSummaryByNoteId = useMemo(
        () => buildStudyNoteMetadataSummaryMap(branchStates),
        [branchStates]
    );
    const [isInitialized, setIsInitialized] = useState(false);
    const {
        noteOutline,
        keyByBranchId,
        isBranchStateReady,
        readFoldedBranchKeys,
        previewFoldedBranchKeys,
        handleToggleReadBranch,
        handleTogglePreviewBranch,
        handleExpandAllReadBranches,
        handleExpandAllPreviewBranches,
        handleCollapseAllReadBranches,
        handleCollapseAllPreviewBranches,
        clearPreviewFoldedBranch,
        ensureBranchIdForBranchKey,
        setBranchOverlayTone,
        setBranchSemanticLabel,
        setBranchKind,
        setBranchStatus,
        revealReadBranchPath,
        revealPreviewBranchPath,
    } = useStructuredOutlineState({
        content,
        noteId,
        uid,
        isNew,
        isContentReady: isInitialized,
    });
    const {
        previewPanelWidth,
        isPreviewResizing,
        handlePreviewResizeStart,
        handlePreviewResizeReset,
    } = useResizableOutlinePreview();
    const currentEditorOutlineBranch = useMemo(
        () => findStudyNoteOutlineBranchBySelectionRequest(noteOutline.branches, currentEditorOutlineBranchSelection),
        [currentEditorOutlineBranchSelection, noteOutline.branches]
    );
    const { copyToClipboard } = useClipboard();

    // ─── PAGINATION LOGIC ──────────────────────────────────────────────────
    const { filteredNotes, currentIndex, prevNoteId, nextNoteId, searchQuery } = useFilteredNotes(
        notes,
        searchParams,
        bibleLocale,
        noteMetadataSummaryByNoteId
    );

    useNoteKeyboardNavigation({ isEditing, prevNoteId, nextNoteId, router, searchParams });

    const { isSaving, lastSaved, saveError, setLastSaved } = useNoteAutoSave({
        noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type,
        updateNote, createNote, uid, setCreatedNoteId, t
    });

    const [isAIPopoverOpen, setIsAIPopoverOpen] = useState(false);

    // AI assistant hook
    const {
        isAnalyzing, isVoiceProcessing, handleAIAnalyze, handleVoiceRecordingComplete,
        pendingAnalysisResult, setPendingAnalysisResult, handleApplyAnalysis
    } = useNoteAIAssistant({
        content, availableTags, setTitle, setContent, setScriptureRefs, setTags, t
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

    const handleActivateOutlineBranchById = useCallback((branchId: string) => {
        const branchKey = keyByBranchId[branchId];

        if (!branchKey) {
            return;
        }

        revealReadBranchPath(branchKey);
        revealPreviewBranchPath(branchKey);
        setPreferredOutlineActiveBranchRequest({
            key: branchKey,
            token: makeId(),
        });
    }, [keyByBranchId, revealPreviewBranchPath, revealReadBranchPath]);

    const handleFollowOutlineBranchLink = useCallback((branchId: string) => {
        if (typeof window !== 'undefined') {
            const nextUrl = `${window.location.pathname}${window.location.search}${getStudyNoteBranchHash(branchId)}`;
            window.history.replaceState(window.history.state, '', nextUrl);
        }

        handleActivateOutlineBranchById(branchId);
    }, [handleActivateOutlineBranchById]);

    const handleCopyOutlineBranchLink = useCallback(async (branchKey: string) => {
        const branchId = ensureBranchIdForBranchKey(branchKey);

        if (!branchId || typeof window === 'undefined') {
            return;
        }

        const branchUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${getStudyNoteBranchHash(branchId)}`;
        const isCopied = await copyToClipboard(branchUrl);

        if (isCopied) {
            toast.success(t('common.copied'));
        } else {
            toast.error(t('common.copyError') || 'Failed to copy to clipboard');
        }
    }, [copyToClipboard, ensureBranchIdForBranchKey, t]);

    const handleCopyOutlineBranchReference = useCallback(async (branchKey: string, relationLabel?: string) => {
        const branchId = ensureBranchIdForBranchKey(branchKey);
        const branch = findStudyNoteOutlineBranchByKey(noteOutline.branches, branchKey);

        if (!branchId || !branch) {
            return;
        }

        const isCopied = await copyToClipboard(
            buildStudyNoteBranchMarkdownReference(branch.title, branchId, relationLabel)
        );

        if (isCopied) {
            toast.success(t('common.copied'));
        } else {
            toast.error(t('common.copyError') || 'Failed to copy to clipboard');
        }
    }, [copyToClipboard, ensureBranchIdForBranchKey, noteOutline.branches, t]);

    const handleInsertOutlineBranchReference = useCallback((branchKey: string, relationLabel?: string) => {
        const branchId = ensureBranchIdForBranchKey(branchKey);
        const branch = findStudyNoteOutlineBranchByKey(noteOutline.branches, branchKey);

        if (!branchId || !branch) {
            return;
        }

        setPendingMarkdownInsertion({
            token: makeId(),
            text: buildStudyNoteBranchMarkdownReference(branch.title, branchId, relationLabel),
        });
    }, [ensureBranchIdForBranchKey, noteOutline.branches]);

    const handleDelete = useNoteDeletion({ t, noteId, isNew, uid, deleteNote, router });

    useEffect(() => {
        if (!isBranchStateReady || !isInitialized || typeof window === 'undefined') {
            return;
        }

        const syncFromHash = () => {
            const branchId = parseStudyNoteBranchIdFromHash(window.location.hash);

            if (!branchId) {
                return;
            }

            handleActivateOutlineBranchById(branchId);
        };

        syncFromHash();
        window.addEventListener('hashchange', syncFromHash);

        return () => {
            window.removeEventListener('hashchange', syncFromHash);
        };
    }, [handleActivateOutlineBranchById, isBranchStateReady, isInitialized]);

    const handlePendingMarkdownInsertionConsumed = useCallback((token: string) => {
        setPendingMarkdownInsertion((currentRequest) => (
            currentRequest?.token === token ? null : currentRequest
        ));
    }, []);

    const handleMoveOutlineBranch = useCallback((branchKey: string, direction: 'up' | 'down') => {
        const nextContent = moveStudyNoteOutlineBranch(content, branchKey, direction);

        if (nextContent === content) {
            return;
        }

        const nextOutline = parseStudyNoteOutline(nextContent);
        const shiftedBranchKey = shiftStudyNoteOutlineKey(branchKey, direction === 'up' ? -1 : 1);
        const shiftedBranch = shiftedBranchKey
            ? findStudyNoteOutlineBranchByKey(nextOutline.branches, shiftedBranchKey)
            : null;

        if (shiftedBranch) {
            setPreferredOutlineActiveBranchRequest({
                key: shiftedBranch.key,
                token: makeId(),
            });
        }

        setContent(nextContent);
    }, [content, setContent]);

    const handleCreateOutlineBranch = useCallback((branchKey: string, position: 'sibling' | 'child') => {
        const nextContent = insertStudyNoteOutlineBranch(content, branchKey, position, {
            title: t('studiesWorkspace.outlinePilot.newBranchTitle'),
        });

        if (nextContent === content) {
            return;
        }

        const currentBranch = findStudyNoteOutlineBranchByKey(noteOutline.branches, branchKey);
        const nextOutline = parseStudyNoteOutline(nextContent);
        const insertedBranchKey = currentBranch
            ? position === 'child'
                ? `${branchKey}.${currentBranch.children.length + 1}`
                : shiftStudyNoteOutlineKey(branchKey, 1)
            : null;
        const insertedBranch = insertedBranchKey
            ? findStudyNoteOutlineBranchByKey(nextOutline.branches, insertedBranchKey)
            : null;

        if (position === 'child') {
            clearPreviewFoldedBranch(branchKey);
        }

        if (insertedBranch) {
            setPreferredOutlineActiveBranchRequest({
                key: insertedBranch.key,
                token: makeId(),
            });
            setPendingHeadingSelection(
                buildPendingHeadingSelectionRequest(nextOutline.branches, insertedBranch)
            );
        }

        if (outlineWorkspaceMode === 'preview') {
            setOutlineWorkspaceMode('editor');
        }

        setContent(nextContent);
    }, [clearPreviewFoldedBranch, content, noteOutline.branches, outlineWorkspaceMode, setContent, t]);

    const handleCreateOutlineRootBranch = useCallback(() => {
        const nextContent = insertStudyNoteOutlineRootBranch(content, {
            title: t('studiesWorkspace.outlinePilot.newBranchTitle'),
        });

        if (nextContent === content) {
            return;
        }

        const nextOutline = parseStudyNoteOutline(nextContent);
        const insertedBranch = nextOutline.branches.at(-1) ?? null;

        if (insertedBranch) {
            setPreferredOutlineActiveBranchRequest({
                key: insertedBranch.key,
                token: makeId(),
            });
            setPendingHeadingSelection(
                buildPendingHeadingSelectionRequest(nextOutline.branches, insertedBranch)
            );
        }

        if (outlineWorkspaceMode === 'preview') {
            setOutlineWorkspaceMode('editor');
        }

        setContent(nextContent);
    }, [content, outlineWorkspaceMode, setContent, t]);

    const handleShiftOutlineBranchDepth = useCallback((branchKey: string, direction: 'promote' | 'demote') => {
        const nextContent = shiftStudyNoteOutlineBranchDepth(content, branchKey, direction);

        if (nextContent === content) {
            return;
        }

        const currentBranch = findStudyNoteOutlineBranchByKey(noteOutline.branches, branchKey);
        const nextOutline = parseStudyNoteOutline(nextContent);
        const nextBranchKey = currentBranch
            ? remapStudyNoteOutlineKeyIgnoringHeadingLevel(branchKey, noteOutline.branches, nextOutline.branches)
            : null;
        const nextBranch = nextBranchKey
            ? findStudyNoteOutlineBranchByKey(nextOutline.branches, nextBranchKey)
            : null;

        if (direction === 'demote') {
            const previousSiblingKey = findStudyNoteOutlinePreviousSiblingKey(
                noteOutline.branches,
                branchKey
            );

            if (previousSiblingKey) {
                clearPreviewFoldedBranch(previousSiblingKey);
            }
        }

        if (nextBranch) {
            setPreferredOutlineActiveBranchRequest({
                key: nextBranch.key,
                token: makeId(),
            });
            setPendingHeadingSelection(
                buildPendingHeadingSelectionRequest(nextOutline.branches, nextBranch)
            );
        }

        setContent(nextContent);
    }, [clearPreviewFoldedBranch, content, noteOutline.branches, setContent]);

    const handleCreateOutlineBranchFromEditor = useCallback((position: 'sibling' | 'child') => {
        if (!currentEditorOutlineBranch) {
            if (position === 'sibling' && !noteOutline.hasOutline) {
                handleCreateOutlineRootBranch();
            }
            return;
        }

        handleCreateOutlineBranch(currentEditorOutlineBranch.key, position);
    }, [currentEditorOutlineBranch, handleCreateOutlineBranch, handleCreateOutlineRootBranch, noteOutline.hasOutline]);

    const handlePendingHeadingSelectionConsumed = useCallback((token: string) => {
        setPendingHeadingSelection((currentSelection) => {
            if (!currentSelection || currentSelection.token !== token) {
                return currentSelection;
            }

            return null;
        });
    }, []);

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
                <div className="relative group/title">
                    {isEditing ? (
                        <div className="flex items-start gap-4 w-full">
                            <TextareaAutosize
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder={t('studiesWorkspace.titlePlaceholder') || 'Note Title...'}
                                className="flex-1 text-4xl md:text-5xl font-extrabold tracking-tight bg-transparent border-none outline-none resize-none placeholder:text-gray-200 dark:placeholder:text-gray-800 text-gray-900 dark:text-gray-50 transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => handleAIAnalyze('title')}
                                disabled={isAnalyzing || !content.trim()}
                                title={t('studiesWorkspace.aiAnalyze.generateTitle', { defaultValue: 'Generate Title' })}
                                className="hidden group-hover/title:flex items-center justify-center p-2 rounded-lg text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50 shrink-0 mt-1"
                            >
                                <SparklesIcon className="h-6 w-6" />
                            </button>
                        </div>
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
                    <StudyNoteContentSurface
                        isEditing={isEditing}
                        noteOutline={noteOutline}
                        content={content}
                        searchQuery={searchQuery}
                        readFoldedBranchKeys={readFoldedBranchKeys}
                        previewFoldedBranchKeys={previewFoldedBranchKeys}
                        handleToggleReadBranch={handleToggleReadBranch}
                        handleTogglePreviewBranch={handleTogglePreviewBranch}
                        handleExpandAllReadBranches={handleExpandAllReadBranches}
                        handleExpandAllPreviewBranches={handleExpandAllPreviewBranches}
                        handleCollapseAllReadBranches={handleCollapseAllReadBranches}
                        handleCollapseAllPreviewBranches={handleCollapseAllPreviewBranches}
                        handleSetBranchOverlayTone={setBranchOverlayTone}
                        handleSetBranchSemanticLabel={setBranchSemanticLabel}
                        handleSetBranchKind={setBranchKind}
                        handleSetBranchStatus={setBranchStatus}
                        isPreviewResizing={isPreviewResizing}
                        previewPanelWidth={previewPanelWidth}
                        handlePreviewResizeStart={handlePreviewResizeStart}
                        handlePreviewResizeReset={handlePreviewResizeReset}
                        setContent={setContent}
                        handleMoveBranch={handleMoveOutlineBranch}
                        handleCreateBranch={handleCreateOutlineBranch}
                        handleShiftBranchDepth={handleShiftOutlineBranchDepth}
                        outlineWorkspaceMode={outlineWorkspaceMode}
                        setOutlineWorkspaceMode={setOutlineWorkspaceMode}
                        pendingHeadingSelection={pendingHeadingSelection}
                        currentEditorOutlineBranchSelection={currentEditorOutlineBranchSelection}
                        setCurrentEditorOutlineBranchSelection={setCurrentEditorOutlineBranchSelection}
                        currentEditorOutlineBranch={currentEditorOutlineBranch}
                        handleCreateBranchFromEditor={handleCreateOutlineBranchFromEditor}
                        handlePendingHeadingSelectionConsumed={handlePendingHeadingSelectionConsumed}
                        pendingMarkdownInsertion={pendingMarkdownInsertion}
                        handlePendingMarkdownInsertionConsumed={handlePendingMarkdownInsertionConsumed}
                        preferredOutlineActiveBranchRequest={preferredOutlineActiveBranchRequest}
                        onCopyBranchLink={handleCopyOutlineBranchLink}
                        onCopyBranchReference={handleCopyOutlineBranchReference}
                        onBranchLinkClick={handleFollowOutlineBranchLink}
                        onInsertBranchReference={handleInsertOutlineBranchReference}
                        t={t}
                    />
                </div>

                {isEditing && (
                    <div className="fixed bottom-6 right-4 md:bottom-8 md:right-8 z-50 flex flex-col gap-3">
                        <div className="relative">
                            {/* Inner wrapper to handle outside clicks or state toggling */}
                            <button
                                type="button"
                                onClick={() => setIsAIPopoverOpen(!isAIPopoverOpen)}
                                disabled={isAnalyzing || !content.trim()}
                                title={t('studiesWorkspace.aiAnalyze.button')}
                                className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg hover:from-purple-600 hover:to-indigo-600 hover:scale-105 disabled:opacity-50 transition-all border border-purple-400 dark:border-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-2 dark:focus:ring-offset-gray-900 relative z-20"
                            >
                                <SparklesIcon className={`h-6 w-6 ${isAnalyzing ? 'animate-spin' : ''}`} />
                            </button>

                            {/* Popover Menu */}
                            {isAIPopoverOpen && (
                                <div className="absolute bottom-full right-0 mb-3 w-56 rounded-xl bg-white shadow-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-700 py-2 z-10 origin-bottom-right animate-in slide-in-from-bottom-2 fade-in duration-200">
                                    <div className="px-4 py-2 border-b border-gray-50 dark:border-gray-700/50 mb-1">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            {t('studiesWorkspace.aiAnalyze.popoverTitle', { defaultValue: 'AI Actions' })}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className="w-full text-left px-4 py-2.5 text-sm font-medium text-purple-700 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30 transition-colors flex items-center justify-between group"
                                        onClick={() => { handleAIAnalyze('all'); setIsAIPopoverOpen(false); }}
                                    >
                                        {t('studiesWorkspace.aiAnalyze.full', { defaultValue: 'Full Analysis' })}
                                        <SparklesIcon className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                    <button
                                        type="button"
                                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors"
                                        onClick={() => { handleAIAnalyze('title'); setIsAIPopoverOpen(false); }}
                                    >
                                        {t('studiesWorkspace.aiAnalyze.generateTitle', { defaultValue: 'Generate Title' })}
                                    </button>
                                    <button
                                        type="button"
                                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors"
                                        onClick={() => { handleAIAnalyze('scriptureRefs'); setIsAIPopoverOpen(false); }}
                                    >
                                        {t('studiesWorkspace.aiAnalyze.findRefs', { defaultValue: 'Find Scripture Refs' })}
                                    </button>
                                    <button
                                        type="button"
                                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors"
                                        onClick={() => { handleAIAnalyze('tags'); setIsAIPopoverOpen(false); }}
                                    >
                                        {t('studiesWorkspace.aiAnalyze.generateTags', { defaultValue: 'Generate Tags' })}
                                    </button>
                                </div>
                            )}

                            {/* Invisible overlay to close popover when clicking outside */}
                            {isAIPopoverOpen && (
                                <div
                                    className="fixed inset-0 z-0"
                                    onClick={() => setIsAIPopoverOpen(false)}
                                    aria-hidden="true"
                                />
                            )}
                        </div>
                        <div className="shadow-lg rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 relative z-20">
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
                                    disabled={isAnalyzing || !content.trim()}
                                    title={t('studiesWorkspace.aiAnalyze.findRefs', { defaultValue: 'Find Scripture Refs' })}
                                    className="hidden group-hover/refs:flex items-center justify-center p-1.5 rounded-lg text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
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
                                    disabled={isAnalyzing || !content.trim()}
                                    title={t('studiesWorkspace.aiAnalyze.generateTags', { defaultValue: 'Generate Tags' })}
                                    className="hidden group-hover/tags:flex items-center justify-center p-1.5 rounded-lg text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
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
        </div>
    );
}
