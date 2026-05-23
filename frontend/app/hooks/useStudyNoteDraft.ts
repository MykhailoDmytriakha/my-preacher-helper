'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAutoSave, type AutoSaveStatus } from '@/hooks/useAutoSave';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { ContentNode, ScriptureReference, StudyNote } from '@/models/models';
import { createDebug } from '@/utils/debug';
import { nodeTreeToMarkdown } from '@/utils/nodeTreeAdapter';

import type { Dispatch, SetStateAction } from 'react';

const debug = createDebug('studies/page');

export interface StudyNoteDraft {
    title: string;
    content: string;
    tags: string[];
    scriptureRefs: ScriptureReference[];
    type: 'note' | 'question';
    rootNode: ContentNode | null;
}

interface StudyNoteDraftSetters {
    setTitle: Dispatch<SetStateAction<string>>;
    setContent: Dispatch<SetStateAction<string>>;
    setTags: Dispatch<SetStateAction<string[]>>;
    setScriptureRefs: Dispatch<SetStateAction<ScriptureReference[]>>;
    setType: Dispatch<SetStateAction<'note' | 'question'>>;
    setRootNode: Dispatch<SetStateAction<ContentNode | null>>;
}

interface StudyNoteDraftAutoSave {
    isSaving: boolean;
    saveStatus: AutoSaveStatus;
    lastSaved: Date | null;
    saveError: unknown;
    hasUnsavedChanges: boolean;
    flushSave: () => Promise<void>;
    retrySave: () => Promise<void>;
    autoSaveEnabled: boolean;
    setAutoSaveEnabled: (v: boolean) => void;
}

interface StudyNoteDraftMeta {
    isInitialized: boolean;
    existingNote: StudyNote | undefined;
    isNew: boolean;
    uid: string | undefined;
}

export interface UseStudyNoteDraftResult {
    draft: StudyNoteDraft;
    setters: StudyNoteDraftSetters;
    autoSave: StudyNoteDraftAutoSave;
    meta: StudyNoteDraftMeta;
}

interface InitializationContext {
    notesLoading: boolean;
    uid: string | undefined;
    isNew: boolean;
    isInitialized: boolean;
    existingNote: StudyNote | undefined;
    noteId: string;
    setIsInitialized: Dispatch<SetStateAction<boolean>>;
    setTitle: Dispatch<SetStateAction<string>>;
    setContent: Dispatch<SetStateAction<string>>;
    setTags: Dispatch<SetStateAction<string[]>>;
    setScriptureRefs: Dispatch<SetStateAction<ScriptureReference[]>>;
    setType: Dispatch<SetStateAction<'note' | 'question'>>;
    setLastSaved: Dispatch<SetStateAction<Date | null>>;
    setRootNode: Dispatch<SetStateAction<ContentNode | null>>;
}

interface AutoSaveContext {
    noteId: string;
    isNew: boolean;
    isInitialized: boolean;
    autoSaveEnabled: boolean;
    existingNote?: StudyNote;
    draft: StudyNoteDraft;
    uid: string | undefined;
    updateNote: (args: { id: string; updates: Partial<StudyNote> }) => Promise<StudyNote>;
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) => Promise<StudyNote>;
    setCreatedNoteId: (id: string) => void;
    setCreatedNote: Dispatch<SetStateAction<StudyNote | undefined>>;
    t: ReturnType<typeof useTranslation>['t'];
}

function shallowArrayEquals<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function useNoteInitialization({
    notesLoading, uid, isNew, isInitialized, existingNote, noteId,
    setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved, setRootNode,
}: InitializationContext) {
    const lastInitializedNoteIdRef = useRef<string | null>(null);

    // Reset the init guard whenever the active noteId changes (e.g. prev/next
    // arrow navigation reuses the mounted page component). Without this the
    // next note's data would never load into local state — `isInitialized`
    // stays `true` from the previous note and the effect below short-circuits.
    useEffect(() => {
        const previousNoteId = lastInitializedNoteIdRef.current;
        if (previousNoteId === noteId) return;

        lastInitializedNoteIdRef.current = noteId;
        if (previousNoteId === 'new' && noteId !== 'new') return;

        setIsInitialized(false);
    }, [noteId, setIsInitialized]);

    useEffect(() => {
        if (notesLoading || !uid) return;

        if (isNew && !isInitialized) {
            setTitle('');
            setContent('');
            setTags([]);
            setScriptureRefs([]);
            setType('note');
            setRootNode(null);
            setIsInitialized(true);
            return;
        }

        if (existingNote && !isInitialized) {
            setTitle(existingNote.title || '');
            setContent(existingNote.content || '');
            setTags(existingNote.tags || []);
            setScriptureRefs(existingNote.scriptureRefs || []);
            setType(existingNote.type || 'note');
            setRootNode(existingNote.rootNode ?? null);
            setIsInitialized(true);
            setLastSaved(new Date(existingNote.updatedAt));
        }
    }, [notesLoading, isNew, existingNote, isInitialized, uid, setIsInitialized, setTitle, setContent, setTags, setScriptureRefs, setType, setLastSaved, setRootNode]);
}

function useNoteAutoSave(ctx: AutoSaveContext) {
    const {
        noteId, isNew, isInitialized, existingNote, draft, updateNote, createNote, uid,
        setCreatedNoteId, setCreatedNote, t, autoSaveEnabled,
    } = ctx;
    const { title, content, tags, scriptureRefs, type, rootNode } = draft;
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [saveError, setSaveError] = useState<unknown>(null);

    // Client-side signature of what we'd persist. Primary autosave guard:
    // a tick fires `saveChanges` only when this signature differs from the
    // signature at the last successful save. Independent of `existingNote`
    // (which can momentarily diverge from local after server-side derivation
    // like `syncContentWithTree`), so we don't get phantom saves while the
    // server roundtrip catches up.
    const editableSignature = useMemo(
        () => JSON.stringify({ title, content, tags, scriptureRefs, type, rootNode: rootNode ?? null }),
        [title, content, tags, scriptureRefs, type, rootNode]
    );
    const lastSavedSignatureRef = useRef<string | null>(null);
    const lastSeenNoteIdRef = useRef<string | null>(null);
    // Initialise the saved-signature ref to the *first* signature we see
    // after the note is initialised — and reset when `noteId` changes
    // (e.g. navigating between notes via the URL without a remount).
    // Otherwise a stale signature from the previous note would let the
    // autosave skip a real change or fire a normalization save on switch.
    useEffect(() => {
        if (!isInitialized) return;
        if (lastSeenNoteIdRef.current !== noteId) {
            lastSeenNoteIdRef.current = noteId;
            lastSavedSignatureRef.current = editableSignature;
        }
    }, [isInitialized, noteId, editableSignature]);

    const saveChanges = useCallback(async () => {
        if (!noteId || !isInitialized) {
            debug.log('saveChanges: skip — not initialized', { noteId, isInitialized });
            return;
        }

        // Primary guard: if the editable signature hasn't moved since our
        // last save attempt, there is nothing to send.
        if (lastSavedSignatureRef.current === editableSignature) {
            debug.log('saveChanges: skip — signature unchanged');
            return;
        }
        debug.log('saveChanges: triggered', {
            noteId,
            isNew,
            hasRootNode: Boolean(rootNode),
            rootNodeChildren: rootNode?.children?.length ?? 0,
            autoSaveEnabled,
        });
        const signatureAtAttempt = editableSignature;

        if (isNew) {
            if (!title.trim() && !content.trim() && tags.length === 0 && scriptureRefs.length === 0 && !rootNode) return;

            setSaveError(null);
            const newNote = await createNote({
                title, content, tags, scriptureRefs, type,
                userId: uid ?? '', materialIds: [], relatedSermonIds: [],
                ...(rootNode ? { rootNode } : {}),
            });
            lastSavedSignatureRef.current = signatureAtAttempt;
            setLastSaved(new Date());
            setCreatedNote(newNote);
            setCreatedNoteId(newNote.id);
            return;
        }

        if (existingNote) {
            // When a node tree exists the server derives `content` from it on
            // every write — so the local `content` state can lag the cached
            // server value by one round-trip. Compare canonical text on both
            // sides instead of raw `content` to avoid a save-loop where the
            // mismatch is purely "I haven't caught up yet".
            const localCanonical = rootNode ? nodeTreeToMarkdown(rootNode) : content;
            const remoteCanonical = existingNote.rootNode
                ? nodeTreeToMarkdown(existingNote.rootNode)
                : (existingNote.content ?? '');
            const localRootNode = rootNode ?? null;
            const remoteRootNode = existingNote.rootNode ?? null;
            const rootNodesMatch =
                (localRootNode === null && remoteRootNode === null) ||
                (localRootNode !== null && remoteRootNode !== null && localCanonical === remoteCanonical);

            // Shallow compares everywhere we can. Root nodes compare by
            // canonical structure instead of object reference because React
            // Query refetches can materialize an equivalent tree as a fresh
            // object.
            const isUnchanged =
                existingNote.title === title &&
                localCanonical === remoteCanonical &&
                existingNote.type === type &&
                shallowArrayEquals(existingNote.tags, tags) &&
                shallowArrayEquals(existingNote.scriptureRefs, scriptureRefs) &&
                rootNodesMatch;

            if (isUnchanged) {
                // Advance the signature — server already has this state.
                // Without this the next render will compare a stale ref and
                // try to save again on every tick.
                debug.log('saveChanges: server-side already matches, advancing signature');
                lastSavedSignatureRef.current = signatureAtAttempt;
                return;
            }
        }

        setSaveError(null);
        debug.log('saveChanges: sending update to server', {
            noteId,
            rootChildCount: rootNode?.children?.length ?? 0,
        });
        // Don't ship local `content` when a tree is present — the server
        // will overwrite it via `syncContentWithTree` anyway, and sending
        // a stale string just makes the diff noisy.
        const updates: Partial<StudyNote> = rootNode
            ? { title, tags, scriptureRefs, type, rootNode }
            : { title, content, tags, scriptureRefs, type };
        await updateNote({
            id: noteId,
            updates,
        });
        lastSavedSignatureRef.current = signatureAtAttempt;
        setLastSaved(new Date());
    }, [noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, rootNode, updateNote, createNote, uid, setCreatedNoteId, setCreatedNote, editableSignature, autoSaveEnabled]);

    const { debouncedSave, saveNow, status: saveStatus } = useAutoSave(saveChanges, {
        delay: 1500,
        onError: (error) => {
            if (isNew) {
                console.error('Auto-create error', error);
            } else {
                console.error('Auto-save error', error);
            }
            setSaveError(t('common.saveError') || 'Error saving changes');
        },
    });

    useEffect(() => {
        if (!isInitialized) return;
        // Skip scheduling entirely if there's no actual change yet — avoids
        // a 1.5s ghost timer firing right after page load.
        if (lastSavedSignatureRef.current === editableSignature) {
            debouncedSave.cancel();
            return;
        }
        // Autosave off: keep tracking dirty signature, but don't schedule any
        // background save. The user is expected to click the manual Save button.
        if (!autoSaveEnabled) {
            debouncedSave.cancel();
            return;
        }
        debouncedSave();
    }, [debouncedSave, editableSignature, isInitialized, autoSaveEnabled]);

    const hasUnsavedChanges = isInitialized && lastSavedSignatureRef.current !== editableSignature;

    const retrySave = useCallback(async () => {
        await saveNow();
    }, [saveNow]);

    return {
        isSaving: saveStatus === 'saving',
        saveStatus,
        lastSaved,
        saveError,
        setLastSaved,
        hasUnsavedChanges,
        flushSave: saveNow,
        retrySave,
    };
}

export function useStudyNoteDraft(noteId: string): UseStudyNoteDraftResult {
    const { t } = useTranslation();
    const { uid, notes, createNote, updateNote, loading: notesLoading } = useStudyNotes();
    const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
    const [createdNote, setCreatedNote] = useState<StudyNote | undefined>(undefined);
    const effectiveNoteId = createdNoteId || noteId;
    const isNew = effectiveNoteId === 'new';
    const existingNote = useMemo(
        () => notes.find(n => n.id === effectiveNoteId) ?? (createdNote?.id === effectiveNoteId ? createdNote : undefined),
        [createdNote, notes, effectiveNoteId]
    );

    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [scriptureRefs, setScriptureRefs] = useState<ScriptureReference[]>([]);
    const [type, setType] = useState<'note' | 'question'>('note');
    const [rootNode, setRootNode] = useState<ContentNode | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [autoSaveEnabled, setAutoSaveEnabledState] = useState(true);

    const draft = useMemo<StudyNoteDraft>(
        () => ({ title, content, tags, scriptureRefs, type, rootNode }),
        [title, content, tags, scriptureRefs, type, rootNode]
    );

    const { isSaving, saveStatus, lastSaved, saveError, setLastSaved, hasUnsavedChanges, flushSave, retrySave } = useNoteAutoSave({
        noteId: effectiveNoteId,
        isNew,
        isInitialized,
        existingNote,
        autoSaveEnabled,
        draft,
        updateNote,
        createNote,
        uid,
        setCreatedNoteId,
        setCreatedNote,
        t,
    });

    useNoteInitialization({
        notesLoading,
        uid,
        isNew,
        isInitialized,
        existingNote,
        noteId: effectiveNoteId,
        setIsInitialized,
        setTitle,
        setContent,
        setTags,
        setScriptureRefs,
        setType,
        setLastSaved,
        setRootNode,
    });

    const setAutoSaveEnabled = useCallback((value: boolean) => {
        setAutoSaveEnabledState(value);
    }, []);

    return {
        draft,
        setters: {
            setTitle,
            setContent,
            setTags,
            setScriptureRefs,
            setType,
            setRootNode,
        },
        autoSave: {
            isSaving,
            saveStatus,
            lastSaved,
            saveError,
            hasUnsavedChanges,
            flushSave,
            retrySave,
            autoSaveEnabled,
            setAutoSaveEnabled,
        },
        meta: {
            isInitialized,
            existingNote,
            isNew,
            uid,
        },
    };
}
