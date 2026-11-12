import type { ScriptureReference, StudyNoteType } from '@/models/models';

/** The compared saved reference list and its scoped alternative for an unanswered choice. */
export interface NoteReferenceRecovery {
    accepted: ScriptureReference[];
    acceptedRevision?: number;
    engineRevision?: number;
    stored: ScriptureReference[];
}

/**
 * Exactly the fields the note editor owns. The durable draft stores this shape, so a
 * recovered draft can be compared against, and applied to, the editor state without
 * dragging along server-owned fields (ids, timestamps, materialIds).
 *
 * It is shared by the note editor, autosave and discovery of unfinished notes.
 */
export interface NoteDraftPayload {
    title: string;
    content: string;
    dictationSourceIds?: string[];
    recordingSourceIds?: string[];
    tags: string[];
    scriptureRefs: ScriptureReference[];
    referenceRecovery?: NoteReferenceRecovery;
    type: StudyNoteType;
}
