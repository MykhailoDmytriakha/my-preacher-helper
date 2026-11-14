import type { StudyNoteTitleCapture, StudyNoteTypeCapture } from '@/data-engine/documentFieldAction';
import type { StudyNoteContentCapture } from '@/data-engine/types';
import type { ScriptureReference, StudyNoteType } from '@/models/models';

/** The compared saved reference list and its scoped alternative for an unanswered choice. */
export interface NoteReferenceRecovery {
    accepted: ScriptureReference[];
    acceptedRevision?: number;
    engineRevision?: number;
    stored: ScriptureReference[];
}

/** The fields actually changed by an existing note's unfinished edit. */
export interface NoteDraftOrigin {
    fields: Partial<Pick<NoteDraftPayload, 'title' | 'content' | 'tags' | 'scriptureRefs' | 'type'>>;
    title?: StudyNoteTitleCapture;
    content?: StudyNoteContentCapture;
    type?: StudyNoteTypeCapture;
}

/**
 * The editable fields the note editor owns. The durable draft stores this shape, so a
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
    origin?: NoteDraftOrigin;
    /** This copy still needs explicit review because its original opening is unknown. */
    reviewLegacyFields?: true;
    /** Generation of the original saved note when the draft is tied to it. */
    targetGeneration?: string | null;
    type: StudyNoteType;
}
