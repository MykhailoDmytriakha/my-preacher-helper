import { newClientId } from '@/utils/clientId';
import { draftKey, saveDraft } from '@/utils/durableDraft';
import { newNoteDraftHref, newNoteDraftId, type NewNoteDraft } from '@/utils/newNoteDrafts';
import { getRecordingDraft, saveRecordingDraft, saveRecordingDraftText, type RecordingDraft } from '@/utils/recordingDraftStore';

import type { StudyNote } from '@/models/models';
import type { NoteDraftPayload } from '@/models/studyNoteDraft';

type AudioNote = Pick<StudyNote, 'id' | 'recordingSourceIds' | 'dictationSourceIds'>;

/** Known notes own their sources even before text or a local metadata link lands. */
export function unassignedStudyRecordingFilter(notes: readonly AudioNote[], drafts: readonly NewNoteDraft[]) {
  const destinations = new Set(notes.map(note => note.id));
  const sources = new Set<string>();
  for (const value of [...notes, ...drafts.map(draft => draft.value)]) {
    for (const id of [...(value.recordingSourceIds ?? []), ...(value.dictationSourceIds ?? [])]) sources.add(id);
  }
  for (const draft of drafts) if (draft.creationTargetId) destinations.add(draft.creationTargetId);
  return (draft: RecordingDraft) => draft.context === 'study' && !sources.has(draft.id) && !destinations.has(draft.contextId ?? '');
}

export function isRecordingOnlyNoteDraft(value: NoteDraftPayload): boolean {
  return value.type === 'note' && !value.title.trim() && !value.content.trim() && value.tags.length === 0 && value.scriptureRefs.length === 0
    && !value.dictationSourceIds?.length && Boolean(value.recordingSourceIds?.length);
}

/** Explicit recovery copies a take; an old source acknowledgement cannot retire its new copy. */
export async function copyRecordingIntoNewNote(sourceId: string, uid: string): Promise<string> {
  const original = await getRecordingDraft(sourceId, uid);
  if (!original || original.context !== 'study' || original.blob.size === 0) throw new Error('Saved study recording is unavailable');
  const creationId = newClientId();
  const copyId = await saveRecordingDraft({ ownerId: uid, blob: original.blob, mimeType: original.mimeType,
    context: 'study', contextId: creationId });
  if (original.transcript !== undefined && !await saveRecordingDraftText(copyId, uid, original.transcript)) {
    throw new Error('Recording copy is no longer available');
  }
  const docId = newNoteDraftId(creationId);
  const payload: NoteDraftPayload = { title: '', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: [copyId] };
  if (!saveDraft(draftKey(uid, docId, 'note'), payload, creationId)) throw new Error('Recording copy cannot be opened without its local draft');
  return newNoteDraftHref(docId, uid);
}
