import { isOrdinaryStudyNote, isStudyNoteBodyDocument } from '@/utils/studyNoteType';

import { boundedActionTime } from './actionClock';
import { equalValues, readField } from './fieldValues';
import { proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { AutosaveFieldDraft, DocumentFieldObservation, StudyNoteTimedField } from './documentFieldAction';
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

/** Only an unsubmitted body gesture can be canceled by returning to its old display. */
export function canceledStudyNoteBody(checkpoint: SessionCheckpoint, proposed: DocumentData | null): string | undefined {
  const { confirmed, studyNoteContentDraft: edit } = checkpoint;
  const saved = confirmed.value?.content;
  if (confirmed.resource.collection !== 'studyNotes' || !edit || !isStudyNoteBodyDocument(confirmed.value)
    || !proposed || !isStudyNoteBodyDocument(proposed) || typeof saved !== 'string' || !confirmed.metadata || confirmed.metadata.deleted
    || edit.generation !== confirmed.metadata.generation
    || !equalValues(edit.action.before, readField(proposed, ['content']))
    || !equalValues(edit.action.after, readField(checkpoint.draft ?? {}, ['content']))
    || proposed.content === saved || checkpoint.draft?.content === saved
    || Object.values(checkpoint.pending).some(request => request.studyNoteContentAction || request.value?.content !== saved)) return undefined;
  return saved;
}

type DeletionSpan = { start: number; count: number };
export type NoteDeletionTrace = { opening: string; spans: readonly DeletionSpan[] };
export type StudyNoteContentReturn = AutosaveFieldDraft & { deletions?: readonly DeletionSpan[] };

/** Keep the states actually displayed by consecutive deletions without copying the body at each key. */
export function traceUnsubmittedNoteDeletion(checkpoint: SessionCheckpoint, proposed: DocumentData | null): NoteDeletionTrace | undefined {
  const { confirmed, draft, studyNoteContentDraft: staged } = checkpoint;
  const previous = draft?.content, next = proposed?.content;
  if (!staged || !isOrdinaryStudyNote(confirmed.value) || !isOrdinaryStudyNote(proposed)
    || !equalValues(staged.action.after, readField(draft ?? {}, ['content']))
    || typeof previous !== 'string' || typeof next !== 'string' || next.length >= previous.length) return;
  let start = 0;
  while (start < next.length && previous[start] === next[start]) start += 1;
  if (!previous.endsWith(next.slice(start))) return;
  const trace = staged.noteDeletion;
  return { opening: trace?.opening ?? previous, spans: [...trace?.spans ?? [], { start, count: previous.length - next.length }] };
}

function replayDeletions(opening: string, spans: readonly DeletionSpan[], length?: number): string | undefined {
  let content = opening;
  for (const { start, count } of spans) {
    if (length !== undefined && content.length <= length) break;
    const end = start + count;
    if (start < 0 || count < 1 || end > content.length || (length !== undefined && content.length - count < length)) return;
    content = content.slice(0, start) + content.slice(end);
  }
  return content;
}

function fieldText(value: AutosaveFieldDraft['action']['before']): string | undefined {
  return typeof value !== 'string' && value.exists && typeof value.value === 'string' ? value.value : undefined;
}

/** A shorter version only matches if an actual step reached that length and those exact words. */
export function matchesUnsubmittedNoteReturn(returned: StudyNoteContentReturn, candidate: unknown): candidate is string {
  const opening = fieldText(returned.action.before);
  return typeof candidate === 'string' && opening !== undefined
    && replayDeletions(opening, returned.deletions ?? [], candidate.length) === candidate;
}

/** Disk data is a witness only if it reconstructs the actual draft and belongs to this edit. */
export function validateNoteContentTracking(checkpoint: SessionCheckpoint): void {
  const { confirmed, draft, studyNoteContentDraft: staged, studyNoteContentReturn: returned } = checkpoint;
  const metadata = confirmed.metadata;
  const belongsToNote = confirmed.resource.collection === 'studyNotes' && isOrdinaryStudyNote(confirmed.value)
    && isOrdinaryStudyNote(draft) && metadata && !metadata.deleted;
  const valid = (proof: AutosaveFieldDraft) => belongsToNote && proof.generation === metadata?.generation
    && proof.editGeneration !== undefined && proof.editGeneration <= checkpoint.editGeneration
    && proof.action.observedRevision <= (metadata?.revision ?? -1) && fieldText(proof.action.after) === draft?.content;
  if (staged?.noteDeletion && (!valid(staged)
    || replayDeletions(staged.noteDeletion.opening, staged.noteDeletion.spans) !== fieldText(staged.action.after))) delete staged.noteDeletion;
  if (staged?.noteReturn && !valid(staged)) delete staged.noteReturn;
  if (!returned) return;
  const opening = fieldText(returned.action.before), after = fieldText(returned.action.after);
  if (!valid(returned) || opening === undefined || after === undefined || opening === after || after !== confirmed.value?.content
    || (returned.deletions && replayDeletions(opening, returned.deletions) !== after)) delete checkpoint.studyNoteContentReturn;
}

/** Returning to saved words cancels typing unless an exact abandoned version also exists on the server. */
export function captureUnsubmittedNoteReturn(checkpoint: SessionCheckpoint, proposed: DocumentData | null, shown: ShownCopy | undefined,
  editGeneration: number, time: ActionTime | null, deletion: NoteDeletionTrace | undefined, server: ResourceSnapshot | undefined): StudyNoteContentReturn | undefined {
  const { confirmed, draft, studyNoteContentDraft: staged } = checkpoint;
  if (confirmed.resource.collection !== 'studyNotes' || !isOrdinaryStudyNote(confirmed.value)
    || !isOrdinaryStudyNote(proposed) || !staged || !confirmed.metadata || confirmed.metadata.deleted
    || staged.generation !== confirmed.metadata.generation || typeof proposed?.content !== 'string'
    || typeof draft?.content !== 'string' || draft.content === proposed.content || proposed.content !== confirmed.value?.content
    || (shown?.draft && shown.draft.content !== draft.content)
    || !equalValues(staged.action.before, readField(proposed, ['content']))
    || !equalValues(staged.action.after, readField(draft, ['content']))
    || Object.values(checkpoint.pending).some(request => request.studyNoteContentAction || request.value?.content !== proposed.content)) return;
  const returned: StudyNoteContentReturn = {
    generation: staged.generation, editGeneration,
    action: { before: { exists: true, value: deletion?.opening ?? draft.content }, after: staged.action.before,
      observedRevision: staged.action.observedRevision, time: boundedActionTime(time) ?? null },
    ...(deletion && { deletions: deletion.spans }),
  };
  const waiting = server?.metadata?.generation === staged.generation && server.metadata.revision > confirmed.metadata.revision
    ? server.value?.content : undefined;
  if (waiting !== undefined && waiting !== proposed.content && !matchesUnsubmittedNoteReturn(returned, waiting)) return;
  return returned;
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
