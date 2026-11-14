import { boundedActionTime } from './actionClock';
import { equalValues } from './fieldValues';
import { proofRevision } from './rowFieldAction';

import type { CommitRequest } from './commits';
import type { DocumentFieldObservation } from './documentFieldAction';
import type { DocumentData, FieldValue, ResourceSnapshot, StudyNoteContentCapture } from './types';

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
  predecessor: CommitRequest | undefined, capture: StudyNoteContentCapture | null | undefined, records: readonly CommitRequest[]): DocumentFieldObservation<FieldValue> | undefined {
  const { metadata, resource, value } = baseline;
  const after = draft?.content;
  // Null explicitly marks a screen whose edit opening could not be verified.
  if (capture === null || resource.collection !== 'studyNotes' || !metadata || metadata.deleted || value?.type === 'analysis'
    || draft?.type === 'analysis' || typeof after !== 'string') return;

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
    ...(previous && { predecessorOperationId: previous.id }) };
}
