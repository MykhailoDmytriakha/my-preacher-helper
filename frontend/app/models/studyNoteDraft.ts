import type { ScriptureReference } from '@/models/models';

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
    type: 'note' | 'question';
}
