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
import { draftKey, moveDraft } from '@/utils/durableDraft';

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
    }) => Promise<StudyNote & { revision?: number }>;
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) => Promise<StudyNote>;
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
        // A refusal is already on screen. Continuing to autosave would keep firing
        // writes at a document we know is newer — and one of them could land.
        if (saveBlocked) return;

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
                baselineRef.current = { title, content, tags, scriptureRefs, type };
                // CARRY THE DRAFT FIRST, THEN report the save.
                //
                // The note was drafted under the placeholder id "new" and now has a
                // real id. The record is carried, not deleted: the create resolved
                // optimistically, so the server has confirmed nothing yet, and a plain
                // clear would leave the text with no durable home until the next
                // keystroke. Reporting the save BEFORE the move broke exactly that —
                // `markSaved` retires the draft under the key the hook still holds
                // ("new"), so the move found nothing left to carry and the safety net
                // was gone while the write was still in flight.
                if (uid) moveDraft(draftKey(uid, 'new', 'note'), draftKey(uid, newNote.id, 'note'));
                onSaved?.({ title, content, tags, scriptureRefs, type });
                window.history.replaceState(null, '', `/studies/${newNote.id}`);
                setCreatedNoteId(newNote.id);
            } catch (e) {
                console.error('Auto-create error', e);
                setSaveError(t('common.saveError') || 'Error saving changes');
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
        const wasDeliberate = deliberateOverwriteRef.current;
        try {
            const saved = await updateNote({
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
            });
            // The server accepted it, so this is now what our text is built from.
            if (typeof (saved as { revision?: number })?.revision === 'number') {
                revisionRef.current = (saved as { revision?: number }).revision as number;
            }
            setLastSaved(new Date());
            // Confirmed by the server, so it becomes the new baseline: these fields
            // are no longer "changed by the user" and must not be re-sent.
            baselineRef.current = { title, content, tags, scriptureRefs, type };
            if (wasDeliberate) deliberateOverwriteRef.current = false;
            onSaved?.({ title, content, tags, scriptureRefs, type });
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
            console.error('Auto-save error', e);
            setSaveError(t('common.saveError') || 'Error saving changes');
        } finally {
            setIsSaving(false);
        }
    }, [noteId, isNew, isInitialized, existingNote, title, content, tags, scriptureRefs, type, updateNote, createNote, uid, setCreatedNoteId, t, baselineRef, revisionRef, onConflict, onSaved]);

    useEffect(() => {
        if (!isInitialized) return;
        const timeoutId = setTimeout(() => {
            saveChanges();
        }, 1500);
        return () => clearTimeout(timeoutId);
    }, [title, content, tags, scriptureRefs, type, isInitialized, resaveNonce, saveChanges]);

    return { isSaving, lastSaved, saveError, setLastSaved };
}
