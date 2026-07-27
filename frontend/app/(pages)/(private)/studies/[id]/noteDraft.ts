import type { ScriptureReference } from '@/models/models';

/**
 * Exactly the fields the note editor owns. The durable draft stores this shape, so a
 * recovered draft can be compared against, and applied to, the editor state without
 * dragging along server-owned fields (ids, timestamps, materialIds).
 *
 * It lives here, and not in the page, because the autosave hook needs it too and a
 * hook importing its own page would be a cycle.
 */
export interface NoteDraftPayload {
    title: string;
    content: string;
    tags: string[];
    scriptureRefs: ScriptureReference[];
    type: 'note' | 'question';
}
