import { editorSlot } from './editorIdentity';

import type { EditorRecord } from './controller';
import type { ScriptureReference } from '@/models/models';

export const COMMENT_EDITOR_SLOT = 'study-comment';
const CREATION_PREFIX = COMMENT_EDITOR_SLOT + ':new:';

/** An opening is the authored passage, independent of the generated reference ID. */
export function newCommentEditorSlot(reference: ScriptureReference | null, choosesPlace: boolean): string {
  if (choosesPlace) return CREATION_PREFIX + 'studies';
  return CREATION_PREFIX + JSON.stringify([
    reference?.bible, reference?.book, reference?.chapter, reference?.fromVerse,
    reference?.toVerse, reference?.toChapter, reference?.toVerseChapter,
  ]);
}

export function isNewCommentEditor(editorId: string): boolean {
  return editorSlot(editorId)?.startsWith(CREATION_PREFIX) === true;
}

export function isCommentCreationCopy(record: EditorRecord, slot: string): boolean {
  const { confirmed, draft } = record.checkpoint;
  return slot.startsWith(CREATION_PREFIX) && confirmed.resource.collection === 'studyNotes' && editorSlot(record.editorId) === slot
    && confirmed.value === null && confirmed.metadata === null && (draft?.type === 'comment' || draft?.type === 'note');
}
