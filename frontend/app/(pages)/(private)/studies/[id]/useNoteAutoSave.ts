/**
 * Autosave for the study-note editor, extracted so its ORDER can be tested.
 *
 * The order is not cosmetic. A new note is drafted under the placeholder id "new";
 * the moment the create returns a real id the durable record has to be CARRIED to
 * that id before the save is reported, because reporting it retires the draft under
 * the key the draft hook still holds — leaving nothing to carry and no safety net
 * while the write is still in flight. That was a live P0.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { changedFields } from '@/utils/changedFields';
import { draftKey, clearDraftIfMatches, moveDraft } from '@/utils/durableDraft';
import { announceIfPersisted, awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { formatScriptureRefs, recoveryText } from '@/utils/writeRecovery';

import type { NoteDraftPayload } from './noteDraft';
import type { ScriptureReference, StudyNote } from '@/models/models';

export function useNoteAutoSave({
    noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, updateNote, createNote, uid, setCreatedNoteId, t, baselineRef, revisionRef, deliberateOverwriteRef, resaveNonce, saveBlocked, onConflict, onSaved
}: {
    noteId: string; isNew: boolean; isInitialized: boolean; existingNote?: StudyNote; title: string;
    content: string; tags: string[]; scriptureRefs: ScriptureReference[]; type: 'note' | 'question';
    updateNote: (args: {
        id: string;
        updates: Partial<StudyNote>;
        expectedRevision?: number | null;
        expectedBaseline?: Record<string, unknown> | null;
        recoveryDraft?: string;
    }) => WriteSubmission & { result: Promise<StudyNote & { revision?: number }> };
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) =>
        WriteSubmission & { note: StudyNote };
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
     * Called ONLY after the server accepted exactly this payload, so the durable
     * draft holding the same text can be retired. Never called on failure — a
     * surviving draft is precisely the signal that text is unconfirmed.
     */
    onSaved?: (saved: NoteDraftPayload) => void;
}) {
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);


    const saveChanges = useCallback(async () => {
        if (!noteId || !isInitialized) return;
        // Moving a new note to its client id re-renders this hook before the first
        // create is accepted. A second save in that gap must not become an update
        // against a document the server may still refuse to create.
        if (isSaving) return;
        // A refusal is already on screen. Continuing to autosave would keep firing
        // writes at a document we know is newer — and one of them could land.
        if (saveBlocked) return;

        if (isNew) {
            if (!title.trim() && !content.trim() && tags.length === 0 && scriptureRefs.length === 0) return;

            setIsSaving(true);
            setSaveError(null);
            setLastSaved(null);
            try {
                const submission = createNote({
                    title, content, tags, scriptureRefs, type,
                    userId: uid ?? '', materialIds: [], relatedSermonIds: []
                });
                const newNote = submission.note;
                // CARRY THE DRAFT FIRST, THEN report the save.
                //
                // The note was drafted under the placeholder id "new" and now has a
                // real id. The record is carried, not deleted: the id arrived before
                // the server may have confirmed anything, and a plain clear would leave
                // the text with no durable home until the next keystroke. Reporting the
                // save BEFORE the move broke exactly that —
                // `markSaved` retires the draft under the key the hook still holds
                // ("new"), so the move found nothing left to carry and the safety net
                // was gone while the write was still in flight.
                if (uid) moveDraft(draftKey(uid, 'new', 'note'), draftKey(uid, newNote.id, 'note'));
                window.history.replaceState(null, '', `/studies/${newNote.id}`);
                setCreatedNoteId(newNote.id);

                // The stable id prevents a second create while an online request is
                // awaiting `persisted` acceptance. On a refusal the editor remains on
                // screen with this same text and with its draft carried to this id.
                // useStudyNotes' create recovery descriptor reports a late refusal while this screen is mounted.
                const acceptance = await awaitAcceptance(submission, () => undefined);

                const confirmedPayload = { title, content, tags, scriptureRefs, type };
                const retirePersistedCreateDraft = () => {
                    // The draft was moved to the real id before the route changed. Never
                    // retire it from the old hook's moving key; remove only this exact,
                    // server-confirmed payload at its stable destination.
                    if (uid) clearDraftIfMatches(draftKey(uid, newNote.id, 'note'), confirmedPayload);
                };
                if (acceptance.kind === 'persisted') {
                    retirePersistedCreateDraft();
                    announceIfPersisted(acceptance, () => {
                        baselineRef.current = confirmedPayload;
                        setLastSaved(new Date());
                    });
                } else if (acceptance.kind === 'queued') {
                    // A queued write stays silent forever as a *queued* submission.
                    // Once persistence really lands we may retire its exact durable
                    // copy, but still do not set Saved: `queued` is not `persisted`.
                    void submission.persistence.then(retirePersistedCreateDraft).catch(() => undefined);
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
            return;
        }

        // Send ONLY the fields this editor actually changed. Sending all five means
        // an untouched field is written back from the snapshot this tab loaded, so
        // a stale tab silently reverts text edited elsewhere. `existingNote` is the
        // live cache entry, so a failed write (rolled back) shows up as changed
        // again on the next pass and is re-sent.
        const updates: Partial<StudyNote> = changedFields(baselineRef.current, {
            title, content, tags, scriptureRefs, type,
        });

        if (Object.keys(updates).length === 0) return;

        setIsSaving(true);
        setSaveError(null);
        // A previous server save says nothing about the text currently being sent.
        // Clear it before this write so `queued` cannot fall back to a stale Saved
        // indicator after the spinner ends.
        setLastSaved(null);
        const wasDeliberate = deliberateOverwriteRef.current;
        try {
            const submission = updateNote({
                id: noteId,
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
                recoveryDraft: recoveryText([
                    title,
                    content,
                    tags.join(', '),
                    formatScriptureRefs(scriptureRefs),
                    type,
                ]),
            });
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
                    baselineRef.current = { title, content, tags, scriptureRefs, type };
                    onSaved?.({ title, content, tags, scriptureRefs, type });
                }
                return;
            }
            const saved = await submission.result;
            // The server accepted it, so this is now what our text is built from.
            if (typeof (saved as { revision?: number })?.revision === 'number') {
                revisionRef.current = (saved as { revision?: number }).revision as number;
            }
            // Confirmed by the server, so it becomes the new baseline: these fields
            // are no longer "changed by the user" and must not be re-sent.
            baselineRef.current = { title, content, tags, scriptureRefs, type };
            if (wasDeliberate) deliberateOverwriteRef.current = false;
            onSaved?.({ title, content, tags, scriptureRefs, type });
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
            setIsSaving(false);
        }
    }, [noteId, isNew, isInitialized, isSaving, existingNote, title, content, tags, scriptureRefs, type, updateNote, createNote, uid, setCreatedNoteId, t, baselineRef, revisionRef, onConflict, onSaved]);

    useEffect(() => {
        if (!isInitialized) return;
        const timeoutId = setTimeout(() => {
            saveChanges();
        }, 1500);
        return () => clearTimeout(timeoutId);
    }, [title, content, tags, scriptureRefs, type, isInitialized, resaveNonce, saveChanges]);

    return { isSaving, lastSaved, saveError, setLastSaved };
}
