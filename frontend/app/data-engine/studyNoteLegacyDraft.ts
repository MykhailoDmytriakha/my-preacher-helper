import { isOrdinaryStudyNote } from '@/utils/studyNoteType';

import { commentPlaceValue, firstCommentReference, replaceCommentReference } from './commentPlaceAction';
import { equalValues, object, readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot } from './types';

export interface LegacyStudyNoteEdit {
  field: 'content' | 'title' | 'type' | 'scriptureRefs' | 'tags' | 'dictationSourceIds' | 'recordingSourceIds';
  /** Missing means this copy was saved before the old editor recorded a basis. */
  opening?: FieldValue;
  value: FieldValue;
}

export type LegacyStudyCommentEdit =
  | { field: 'content' | 'title'; value: FieldValue; opening?: FieldValue }
  | { field: 'paragraph'; value: FieldValue; opening?: FieldValue; referenceOpening?: FieldValue }
  | { field: 'place'; value: FieldValue; opening?: FieldValue; paragraphOpening?: FieldValue };

export type LegacyStudyNoteImport = readonly LegacyStudyNoteEdit[] | {
  kind: 'comment';
  edits: readonly LegacyStudyCommentEdit[];
};

const LEGACY_COMMENT_REVIEW = 'legacy-comment-opening';

function unavailableComment() {
  return Object.assign(new Error('The original comment or its reference is unavailable'), { code: 'decision-changed' });
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

function commentPlacePath(stored: FieldValue, mine: FieldValue, opening: FieldValue | undefined): string[] {
  const place = mine.exists && firstCommentReference([mine.value]);
  if (!place || !object(stored.value) || place.id !== stored.value.id
    || (opening !== undefined && (!object(opening.value) || place.id !== opening.value.id))) throw unavailableComment();
  return ['scriptureRefs', 'id:' + place.id];
}

function withLegacyCommentPlace(note: DocumentData, place: FieldValue): DocumentData {
  const references = replaceCommentReference(note.scriptureRefs, place);
  return references === undefined ? note : { ...note, scriptureRefs: references };
}

/** Restore only what was edited in the original window, against the saved comment at this address. */
export function projectLegacyStudyComment(snapshot: ResourceSnapshot, edits: readonly LegacyStudyCommentEdit[]) {
  const stored = snapshot.value;
  if (snapshot.resource.collection !== 'studyNotes' || stored?.type !== 'comment' || snapshot.metadata?.deleted) throw unavailableComment();
  const storedPlace = commentPlaceValue(stored);
  const storedKind = readField(stored, ['paragraph']);
  let value = stored;
  const conflicts: ConflictDetail[] = [];
  for (const edit of edits) {
    const { field, opening, value: mine } = edit;
    const path = field === 'place' ? commentPlacePath(storedPlace, mine, opening) : [field];
    const theirs = field === 'place' ? storedPlace : readField(stored, path);
    if (equalValues(mine, theirs)) continue;
    const sameContext = field === 'place' ? equalValues(edit.paragraphOpening, storedKind)
      : field !== 'paragraph' || equalValues(edit.referenceOpening, storedPlace);
    value = field === 'place' ? withLegacyCommentPlace(value, mine) : writeField(value, path, mine);
    if (!sameContext || !opening || !equalValues(opening, theirs)) {
      conflicts.push({ path, code: LEGACY_COMMENT_REVIEW, base: opening ?? { exists: false }, mine, theirs });
    }
  }
  return { value, conflicts };
}

/** Typing and Put Back update the same comparison without answering for any other field. */
export function reviseLegacyCommentConflicts(checkpoint: SessionCheckpoint, draft: DocumentData | null): ConflictDetail[] {
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  const stored = remoteCandidate?.value;
  if (draft?.type !== 'comment' || stored?.type !== 'comment' || confirmed.metadata?.generation !== remoteCandidate?.metadata?.generation) return conflicts;
  return conflicts.flatMap(conflict => {
    if (conflict.code !== LEGACY_COMMENT_REVIEW) return [conflict];
    const { path } = conflict;
    const place = path[0] === 'scriptureRefs';
    const mine = place ? commentPlaceValue(draft) : readField(draft, path);
    const theirs = place ? commentPlaceValue(stored) : readField(stored, path);
    return equalValues(mine, theirs) ? [] : [{ ...conflict, mine, theirs }];
  });
}

/** A review opened for a comment cannot recreate a place removed during that review. */
export function assertLegacyCommentLocalChoice({ confirmed, draft, remoteCandidate, conflicts }: SessionCheckpoint): void {
  if (!remoteCandidate || !conflicts.some(conflict => conflict.code === LEGACY_COMMENT_REVIEW)) return;
  const stored = remoteCandidate.value;
  if (stored?.type !== 'comment' || remoteCandidate.metadata?.generation !== confirmed.metadata?.generation) throw unavailableComment();
  const opening = commentPlaceValue(confirmed.value);
  const mine = commentPlaceValue(draft);
  const latest = commentPlaceValue(stored);
  if (!equalValues(opening, mine)) commentPlacePath(latest, mine, opening);
}

/** Choosing the stored version in recovery leaves independent edits in the pending comment. */
export function keepUncontestedLegacyComment(basis: ResourceSnapshot, draft: DocumentData | null, saved: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (!conflicts.length || !conflicts.every(conflict => conflict.code === LEGACY_COMMENT_REVIEW)) return undefined;
  const opening = basis.value;
  if (opening?.type !== 'comment' || draft?.type !== 'comment' || saved?.value?.type !== 'comment'
    || basis.metadata?.generation !== saved.metadata?.generation || saved.metadata?.deleted) return undefined;
  const retained = conflicts.reduce((value, { path }) => path[0] === 'scriptureRefs'
    ? withLegacyCommentPlace(value, commentPlaceValue(opening))
    : writeField(value, path, readField(opening, path)), draft);
  const merged = mergeDocumentFields(opening, retained, saved.value);
  if (merged.conflicts.length || !merged.value.exists) throw unavailableComment();
  return merged.value.value as DocumentData;
}
