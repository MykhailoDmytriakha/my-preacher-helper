import { isOrdinaryStudyNote, isStudyNoteBodyDocument } from '@/utils/studyNoteType';

import { boundedActionTime } from './actionClock';
import { equalValues, readField } from './fieldValues';
import { proofRevision } from './rowFieldAction';

import type { CommitRequest } from './commits';
import type { DocumentFieldObservation, StudyNoteTimedField } from './documentFieldAction';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot, StudyNoteContentCapture } from './types';

export const COMMENT_TEXT_REVIEW = 'comment-text-review';

export type StudyNoteContentObservation = DocumentFieldObservation<FieldValue> & { reviewed?: true };

/** Follow exact same-document saves that carried the visible text without authoring it. */
function contentPredecessor(baseline: ResourceSnapshot, opening: string, predecessor: CommitRequest | undefined, records: readonly CommitRequest[]) {
  if (!predecessor) return undefined;
  const byId = new Map(records.map(record => [record.id, record]));
  const owner = predecessor.owner;
  let current: CommitRequest | undefined = predecessor;
  while (current && current.owner === owner && equalValues(current.baseline.resource, baseline.resource)
    && current.baseline.metadata?.generation === baseline.metadata?.generation && current.value?.content === opening
    && !['conflict', 'refused', 'cancelled'].includes(current.state)) {
    const action = current.studyNoteContentAction;
    if (action) return action.after.value === opening ? { id: current.command?.operationId ?? current.id, requestId: current.id, revision: action.observedRevision } : undefined;
    const earlier: CommitRequest | undefined = current.predecessor ? byId.get(current.predecessor) : undefined;
    if ((earlier ? earlier.value?.content : current.baseline.value?.content) !== opening) return undefined;
    byId.delete(current.id);
    current = earlier;
  }
}

export function captureStudyNoteContent(baseline: ResourceSnapshot, draft: DocumentData | null,
  predecessor: CommitRequest | undefined, capture: StudyNoteContentCapture | null | undefined, records: readonly CommitRequest[]): StudyNoteContentObservation | undefined {
  const { metadata, resource, value } = baseline;
  const after = draft?.content;
  // Null explicitly marks a screen whose edit opening could not be verified.
  if (capture === null || resource.collection !== 'studyNotes' || !metadata || metadata.deleted || value?.type === 'analysis'
    || draft?.type === 'analysis' || typeof after !== 'string'
    || (capture?.reviewed && (value?.type !== 'comment' || capture.opening !== value.content))) return;

  const predecessorWords = predecessor?.value?.content;
  const sameGeneration = predecessor?.baseline.metadata?.generation === metadata.generation;
  const opening = capture?.opening ?? (sameGeneration && typeof predecessorWords === 'string' ? predecessorWords : value?.content);
  if (typeof opening !== 'string' || opening === after) return;
  const previous = contentPredecessor(baseline, opening, predecessor, records);
  if (capture?.requestId && previous?.requestId !== capture.requestId) return;
  const observedRevision = previous?.revision ?? capture?.observedRevision ?? metadata.revision;
  if (!proofRevision(observedRevision) || observedRevision > metadata.revision
    || (capture && capture.generation !== metadata.generation)) return;
  const time = capture?.time == null ? null : boundedActionTime(capture.time) ?? null;
  return { before: { exists: true, value: opening }, after: { exists: true, value: after }, observedRevision, time,
    ...(previous && { predecessorOperationId: previous.id }), ...(capture?.reviewed && { reviewed: true }) };
}

/** A confirmed copy may arrive before the editor displays it. Keep the actual opening of the edit. */
export function unseenStudyNoteField(checkpoint: SessionCheckpoint, value: DocumentData | null,
  shown: ShownCopy | undefined, field: StudyNoteTimedField): { snapshot: ResourceSnapshot; conflict: ConflictDetail | null } | undefined {
  const { confirmed } = checkpoint, fieldPath = [field];
  const acceptsDocument = field === 'content' ? isStudyNoteBodyDocument : isOrdinaryStudyNote;
  if (confirmed.resource.collection !== 'studyNotes' || !value || !acceptsDocument(value)) return;
  const prior = checkpoint.conflicts.find(({ path }) => path.length === 1 && path[0] === field);
  const snapshot = prior ? checkpoint.remoteCandidate : confirmed;
  if (!snapshot?.value || !acceptsDocument(snapshot.value)) return;
  const stored = readField(snapshot.value, fieldPath);
  const mine = readField(value, fieldPath);
  if (prior) {
    return { snapshot, conflict: equalValues(mine, stored) ? null : { ...prior, mine, theirs: stored } };
  }
  if (!shown?.confirmed.metadata || !confirmed.metadata || !shown.draft
    || !equalValues(confirmed.resource, shown.confirmed.resource)
    || confirmed.metadata.generation !== shown.confirmed.metadata.generation
    || confirmed.metadata.revision <= shown.confirmed.metadata.revision) return;
  const base = readField(shown.draft, fieldPath);
  if (equalValues(stored, base) || equalValues(stored, mine)
    || equalValues(stored, readField(shown.confirmed.value ?? {}, fieldPath))) return;
  return { snapshot, conflict: { path: fieldPath, base, mine, theirs: stored } };
}
