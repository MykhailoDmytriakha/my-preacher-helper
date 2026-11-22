import { isOrdinaryStudyNote } from '@/utils/studyNoteType';

import { equalValues, readField, writeField } from './fieldValues';

import type { ConflictDetail, FieldValue, ResourceSnapshot } from './types';

export interface LegacyStudyNoteEdit {
  field: 'content' | 'title' | 'type' | 'scriptureRefs' | 'tags' | 'dictationSourceIds' | 'recordingSourceIds';
  /** Missing means this copy was saved before the old editor recorded a basis. */
  opening?: FieldValue;
  value: FieldValue;
}

export function projectLegacyStudyNote(snapshot: ResourceSnapshot, edits: readonly LegacyStudyNoteEdit[]) {
  if (snapshot.resource.collection !== 'studyNotes' || !snapshot.value || !isOrdinaryStudyNote(snapshot.value)
    || snapshot.metadata?.deleted) throw Object.assign(new Error('The original study note is unavailable'), { code: 'decision-changed' });
  const stored = snapshot.value;
  let value = stored;
  const conflicts: ConflictDetail[] = [];
  for (const { field, opening, value: mine } of edits) {
    const path = [field];
    const theirs = readField(stored, path);
    if (equalValues(mine, theirs)) continue;
    value = writeField(value, path, mine);
    if (opening && equalValues(opening, theirs)) continue;
    conflicts.push({ path, base: opening ?? { exists: false }, mine, theirs });
  }
  return { value, conflicts };
}
