/**
 * Autosave for the study-note editor, extracted so its ORDER can be tested.
 *
 * The order is not cosmetic. A new note is drafted at its reserved address;
 * the moment the create returns a real id the durable record has to be CARRIED to
 * that id before the save is reported, because reporting it retires the draft under
 * the key the draft hook still holds — leaving nothing to carry and no safety net
 * while the write is still in flight. That was a live P0.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { changedFields } from '@/utils/changedFields';
import { prepareDraftCapture, prepareNoteDraftCapture } from '@/utils/draftCaptureRecovery.client';
import { draftKey, clearDraftIfMatches, clearCreationDraft, moveDraft, readDraft, saveDraft } from '@/utils/durableDraft';
import { announceIfPersisted, awaitAcceptance } from '@/utils/recoverableWrite';
import { noteRecordingMetadata } from '@/utils/studyNoteRecordings';
import { useTranslation } from '@locales/useTranslation';

import type { NoteDraftPayload } from './noteDraft';
import type { StudyNoteSubmission } from '@/hooks/useStudyNotesEngine';
import type { ScriptureReference, StudyNote } from '@/models/models';

const EMPTY_SOURCE_IDS: string[] = [];

/** A returned canonical request owns the full payload; server/audio proof stays separate. */
function afterCanonicalCapture(submission: StudyNoteSubmission, payload: NoteDraftPayload, targetId: string,
    onCaptured?: (captured: NoteDraftPayload, targetId: string) => void) {
    if (!submission.capture || !onCaptured) return;
    void submission.capture.then(receipt => {
        if (receipt.kind === 'submitted' && receipt.requestId) onCaptured(payload, targetId);
    }).catch(() => undefined);
}

export function useNoteAutoSave({
    noteId, isNew, creationId, draftDocId = 'new', isInitialized, title, content, tags, scriptureRefs, type, updateNote, createNote, uid, setCreatedNoteId, baselineRef, revisionRef, deliberateOverwriteRef, resaveNonce, saveBlocked, onConflict, onSaved, onCaptured, saveAtOnceRef, captureRecordingHandoff, dictationSourceIds = EMPTY_SOURCE_IDS, recordingSourceIds = EMPTY_SOURCE_IDS
}: {
    dictationSourceIds?: string[];
    recordingSourceIds?: string[];
    creationId?: string;
    /** Durable precreate address; legacy callers still use the shared placeholder. */
    draftDocId?: string;
    noteId: string; isNew: boolean; isInitialized: boolean; existingNote?: StudyNote; title: string;
    content: string; tags: string[]; scriptureRefs: ScriptureReference[]; type: 'note' | 'question';
    updateNote: (args: {
        id: string;
        updates: Partial<StudyNote>;
        captureScope?: string;
        expectedRevision?: number | null;
        expectedBaseline?: Record<string, unknown> | null;
    }) => StudyNoteSubmission & { result: Promise<StudyNote & { revision?: number }> };
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>, options?: { id: string; captureScope?: string }) =>
        StudyNoteSubmission & { note: StudyNote };
    uid: string | undefined; setCreatedNoteId: (id: string) => void;
    t: ReturnType<typeof useTranslation>['t'];
    /** Baseline owned by the page so both autosave and "load newer" can move it. */
    baselineRef: React.MutableRefObject<NoteDraftPayload | null>;
    /** Revision this text was built from; null keeps the write unguarded. */
    revisionRef: React.MutableRefObject<number | null>;
    /**
     * The next save is a DELIBERATE overwrite chosen by the person after a refusal.
     * It suppresses the content check for that one send — otherwise the check
     * compares their text against what the other device stored, mismatches by
     * definition, and refuses the action they just confirmed, every time.
     */
    deliberateOverwriteRef: React.MutableRefObject<boolean>;
    /** Changes when the person asks to send the same text again after a refusal. */
    resaveNonce: number;
    /** While true the server already refused: stop saving until the person chooses. */
    saveBlocked: boolean;
    /** Raised when the server refused a stale write — the text is NOT lost. */
    onConflict: () => void;
    /**
     * Called ONLY after the server accepted exactly this payload. Canonical local
     * capture can already own its backup, but never confirms server status.
     */
    onSaved?: (saved: NoteDraftPayload) => void;
    /** Called only after an exact canonical request durably owns these words. */
    onCaptured?: (captured: NoteDraftPayload, targetId: string) => void;
    /** Capture source IDs at submission time; later dictation belongs to a later save. */
    captureRecordingHandoff?: () => { accepted: () => Promise<void>; carryTo: (id: string) => Promise<void>; canChangeDestination?: () => boolean } | undefined;
    /**
     * Set by the page right before a change that must not wait for the pause — dictated text
     * landing in the note. The next save goes at once; the flag clears when a save starts.
     */
    saveAtOnceRef?: React.MutableRefObject<boolean>;
}) {
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    // A save asked for at once while another was still running: it goes the moment that one ends.
    const ownAtOnceRef = useRef(false);
    // A save is running. Unlike `isSaving` it is true at once — two departure events in a row
    // (`visibilitychange`, then `pagehide`) reach the same render, and a state-only guard let
    // both create the same new note.
    const inFlightRef = useRef(false);
    const atOnceRef = saveAtOnceRef ?? ownAtOnceRef;

    const saveNewNote = useCallback(async () => {
        if (!title.trim() && !content.trim() && tags.length === 0 && scriptureRefs.length === 0) return;
        const recording = captureRecordingHandoff?.();
        // Creation adopts a new destination and remounts the recorder; keep its sole source safe first.
        if (recording?.canChangeDestination?.() === false) return;

        setIsSaving(true);
        setSaveError(null);
        setLastSaved(null);
        try {
            const confirmedPayload: NoteDraftPayload = {
                title, content, tags, scriptureRefs, type,
                ...noteRecordingMetadata(dictationSourceIds, recordingSourceIds),
            };
            // Immediate dictation can beat the backup debounce. Carry the submitted words,
            // never an older copy; a refused backup keeps its source and existing warning.
            const sourceKey = uid ? draftKey(uid, draftDocId, 'note') : null;
            const sourceDraft = sourceKey ? readDraft<NoteDraftPayload>(sourceKey) : null;
            // Do not claim another creation's copy or an untagged legacy source for this ID.
            const ownsSource = !sourceDraft || sourceDraft.creationTargetId === creationId;
            const backupReady = sourceKey && ownsSource ? saveDraft(sourceKey, confirmedPayload, creationId, true) : false;
            const input = { ...confirmedPayload, userId: uid ?? '', materialIds: [], relatedSermonIds: [] };
            const captureScope = sourceKey && backupReady && creationId
                ? prepareDraftCapture(sourceKey, confirmedPayload, { collection: 'studyNotes', id: creationId }) : undefined;
            const submission = creationId ? createNote(input, { id: creationId, ...(captureScope ? { captureScope } : {}) }) : createNote(input);
            const newNote = submission.note;
            void recording?.carryTo(newNote.id).catch(() => undefined);
            void submission.persistence.then(() => recording?.accepted()).catch(() => undefined);
            // CARRY THE DRAFT FIRST, THEN report the save.
            //
            // The note was drafted at its reserved (or legacy placeholder) address and now has a
            // real id. The record is carried, not deleted: the id arrived before
            // the server may have confirmed anything, and a plain clear would leave
            // the text with no durable home until the next keystroke. Reporting the
            // save BEFORE the move broke exactly that —
            // `markSaved` retires the draft under the key the hook still holds
            // ("new"), so the move found nothing left to carry and the safety net
            // was gone while the write was still in flight.
            if (uid && backupReady) moveDraft(draftKey(uid, draftDocId, 'note'), draftKey(uid, newNote.id, 'note'), creationId);
            window.history.replaceState(null, '', `/studies/${newNote.id}`);
            setCreatedNoteId(newNote.id);

            // The stable id prevents a second create while an online request is
            // awaiting `persisted` acceptance. On a refusal the editor remains on
            // screen with this same text and with its draft carried to this id.
            // useStudyNotes' create recovery descriptor reports a late refusal while this screen is mounted.
            afterCanonicalCapture(submission, confirmedPayload, newNote.id, onCaptured);
            const acceptance = await awaitAcceptance(submission, () => undefined);

            const retirePersistedCreateDraft = () => {
                // The draft was moved to the real id before the route changed. Never
                // retire it from the old hook's moving key; remove only this exact,
                // server-confirmed payload at its stable destination.
                if (uid) clearDraftIfMatches(draftKey(uid, newNote.id, 'note'), confirmedPayload);
                if (uid && creationId === newNote.id) clearCreationDraft(draftKey(uid, draftDocId, 'note'), creationId);
            };
            if (acceptance.kind === 'persisted') {
                retirePersistedCreateDraft();
                announceIfPersisted(acceptance, () => {
                    baselineRef.current = confirmedPayload;
                    onSaved?.(confirmedPayload);
                    setLastSaved(new Date());
                });
            } else if (acceptance.kind === 'queued') {
                baselineRef.current = confirmedPayload;
                // Local handoff is not acceptance. The later whole-write proof
                // confirms only this payload; newer typing keeps its own baseline.
                void submission.persistence.then(() => {
                    retirePersistedCreateDraft();
                    onSaved?.(confirmedPayload);
                    setLastSaved(new Date());
                }).catch(() => undefined);
            }
        } catch (e) {
            /**
             * A STATUS, not a second explanation. The refusal itself is announced by
             * the note's recovery descriptor (and a version conflict opens the choice
             * instead); this flag only tells the person that the last auto-save did
             * not go through. It holds a translation KEY — the screen translates it.
             */
            console.error('Auto-create error', e);
            setSaveError('common.saveError');
        } finally {
            setIsSaving(false);
        }
    }, [title, content, tags, scriptureRefs, type, dictationSourceIds, recordingSourceIds, createNote, creationId, draftDocId, uid, setCreatedNoteId, baselineRef, onSaved, onCaptured, captureRecordingHandoff]);

    const saveChanges = useCallback(async () => {
        if (!noteId || !isInitialized) return;
        // Moving a new note to its client id re-renders this hook before the first
        // create is accepted. A second save in that gap must not become an update
        // against a document the server may still refuse to create.
        if (isSaving || inFlightRef.current) return;
        // This save is the one asked for at once (or the ordinary one): the request is met.
        atOnceRef.current = false;
        // A refusal is already on screen. Continuing to autosave would keep firing
        // writes at a document we know is newer — and one of them could land.
        if (saveBlocked) return;

        if (isNew) {
            inFlightRef.current = true;
            try { await saveNewNote(); } finally { inFlightRef.current = false; }
            return;
        }

        // Send ONLY the fields this editor actually changed. Sending all five means
        // an untouched field is written back from the snapshot this tab loaded, so
        // a stale tab silently reverts text edited elsewhere. The baseline advances
        // only after acceptance, so a failed write remains changed on the next pass.
        const payload: NoteDraftPayload = {
            title, content, tags, scriptureRefs, type,
            ...noteRecordingMetadata(dictationSourceIds, recordingSourceIds),
        };
        const updates: Partial<StudyNote> = changedFields(baselineRef.current, payload);

        if (Object.keys(updates).length === 0) return;

        // An unchanged picker or recovery can copy reference values without retaining
        // their raw read provenance. Keep the opened identity until references change;
        // all other fields must still match the exact editor payload being confirmed.
        const submittedPayload: NoteDraftPayload = {
            ...payload,
            scriptureRefs: updates.scriptureRefs ?? baselineRef.current?.scriptureRefs ?? scriptureRefs,
        };

        inFlightRef.current = true;
        setIsSaving(true);
        setSaveError(null);
        // A previous server save says nothing about the text currently being sent.
        // Clear it before this write so `queued` cannot fall back to a stale Saved
        // indicator after the spinner ends.
        setLastSaved(null);
        const wasDeliberate = deliberateOverwriteRef.current;
        try {
            const recording = captureRecordingHandoff?.();
            const captureScope = prepareNoteDraftCapture(uid, noteId, submittedPayload);
            const submission = updateNote({
                id: noteId,
                captureScope,
                updates,
                expectedRevision: revisionRef.current,
                // WHAT THIS TEXT WAS BUILT FROM. Not a fresh read: the service used
                // to fingerprint the document it had just fetched, which compares the
                // server with itself, always agrees, and let a stale save through.
                // The baseline is the last text the server confirmed for this editor.
                // ⚠️ OMITTED for a DELIBERATE overwrite. The person saw the conflict
                // and chose their own text; carrying the opening values would compare
                // them against what the other device stored, mismatch by definition,
                // and refuse the very action they just confirmed — forever. Then the
                // counter alone decides, and it was set to the revision seen at the
                // refusal, which is exactly the "yes, replace that" statement.
                expectedBaseline: deliberateOverwriteRef.current
                    ? null
                    : (baselineRef.current as unknown as Record<string, unknown>),
            });
            afterCanonicalCapture(submission, submittedPayload, noteId, onCaptured);
            void submission.persistence.then(() => recording?.accepted()).catch(() => undefined);
            // useStudyNotes' update recovery descriptor reports a late refusal while this screen is mounted.
            const acceptance = await awaitAcceptance(submission, () => undefined);
            if (acceptance.kind !== 'persisted') {
                /**
                 * A QUEUED write is a durable hand-off: the text is in the outbox and will
                 * replay. The status stays quiet — nothing is on the server yet, so no
                 * "saved" tick — but the BASELINE must move, otherwise this exact note is
                 * enqueued again on the next autosave tick, and again, every 1.5 seconds,
                 * each time under a fresh id. That fills the outbox with copies of one
                 * note and can exhaust storage the later typing depends on.
                 */
                if (acceptance.kind === 'queued') {
                    baselineRef.current = submittedPayload;
                    // A deliberate overwrite is one send; left armed, every later save
                    // would go out unguarded until the next persisted one.
                    if (wasDeliberate) deliberateOverwriteRef.current = false;
                    // Canonical capture may already own the backup. Confirmed UI
                    // still waits for the exact whole-write server result.
                    void submission.persistence.then(async () => {
                        const saved = await submission.result;
                        if (!saved) return;
                        if (typeof saved.revision === 'number') {
                            if (saved.revision < (revisionRef.current ?? 0)) return;
                            revisionRef.current = saved.revision;
                        }
                        onSaved?.(submittedPayload);
                        setLastSaved(new Date());
                    }).catch(() => undefined);
                }
                return;
            }
            const saved = await submission.result;
            // The server accepted it, so this is now what our text is built from.
            if (typeof saved?.revision === 'number') {
                // A newer server proof may have arrived before this write response.
                if (saved.revision < (revisionRef.current ?? 0)) return;
                revisionRef.current = saved.revision;
            }
            // Confirmed by the server, so it becomes the new baseline: these fields
            // are no longer "changed by the user" and must not be re-sent.
            baselineRef.current = submittedPayload;
            if (wasDeliberate) deliberateOverwriteRef.current = false;
            onSaved?.(submittedPayload);
            announceIfPersisted(acceptance, () => setLastSaved(new Date()));
        } catch (e) {
            if (isStaleWriteError(e)) {
                // REFUSED, not failed. The server holds a newer version, so this text
                // was NOT written — and it was NOT lost either: the durable draft
                // already holds it and the inputs still show it. Stop hammering the
                // server and hand the decision to the person.
                onConflict();
                setSaveError(null);
                return;
            }
            /**
             * The MESSAGE belongs to the note's recovery descriptor (useStudyNotes): it
             * carries the text and follows the person off this screen. This flag stays a
             * STATUS — "the last auto-save did not go through" — so the editor can show
             * that something is unsaved without repeating the explanation.
             */
            // Same status flag as the create branch above.
            console.error('Auto-save error', e);
            setSaveError('common.saveError');
        } finally {
            inFlightRef.current = false;
            setIsSaving(false);
        }
    }, [uid, noteId, isNew, isInitialized, isSaving, saveBlocked, saveNewNote, title, content, tags, scriptureRefs, type, dictationSourceIds, recordingSourceIds, updateNote, baselineRef, revisionRef, deliberateOverwriteRef, onConflict, onSaved, onCaptured, atOnceRef, captureRecordingHandoff]);

    useEffect(() => {
        if (!isInitialized) return;
        // Typing waits for the pause; a change asked for at once (dictation, or a save that the
        // page's hiding found still running) goes as soon as this render has the text.
        const timeoutId = setTimeout(() => {
            saveChanges();
        }, atOnceRef.current ? 0 : 1500);
        return () => clearTimeout(timeoutId);
    }, [title, content, tags, scriptureRefs, type, dictationSourceIds, recordingSourceIds, isInitialized, resaveNonce, saveChanges, atOnceRef]);

    /**
     * THE PAGE GOING AWAY IS THE LAST MOMENT TO HAND THE TEXT OVER (BUG-20261006-hidden-tab-holds-last-edit).
     * A screen locked inside the pause held the note on the phone: on a locked iPhone the device
     * storage freezes, so what the engine did not receive before the lock waits for the next
     * opening. Hiding saves at once; a save still running is followed by one for the newest text.
     */
    useEffect(() => {
        if (!isInitialized) return;
        const saveNow = () => {
            atOnceRef.current = true;
            void saveChanges();
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') saveNow(); };
        window.addEventListener('pagehide', saveNow);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', saveNow);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [isInitialized, saveChanges, atOnceRef]);

    return { isSaving, lastSaved, saveError, setLastSaved };
}
