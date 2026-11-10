import { boundedActionTime, type ActionTime } from './actionClock';
import { equalValues, object, readField } from './fieldValues';

import type { CommitRequest } from './commits';
import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldChange, FieldValue, Json, ResourceRef, ResourceSnapshot } from './types';

export type CommentPlaceSeen = {
  generation: string;
  revision: number;
  reference: FieldValue;
  paragraph: FieldValue;
  requestId?: string;
};
export type CommentPlaceCapture = { seen: CommentPlaceSeen; time: ActionTime | null; compound?: true; reviewed?: true };
export type CommentPlaceObservation = DocumentFieldObservation<FieldValue> & { paragraph: FieldValue; compound?: true; reviewed?: true };
export type CommentPlaceStamp = DocumentFieldStamp & { paragraph: FieldValue; compound?: true; reviewed?: true };

/** One existing leading reference is the comment's place. Secondary references belong to the note. */
export function firstCommentReference(rows: unknown): DocumentData | undefined {
  if (!Array.isArray(rows)) return undefined;
  const first: unknown = rows[0];
  if (!object(first) || typeof first.id !== 'string' || !first.id || typeof first.book !== 'string'
    || typeof first.chapter !== 'number' || rows.slice(1).some(row => object(row) && row.id === first.id)) return undefined;
  return first;
}

export function leadingReferenceValue(note: DocumentData | null): FieldValue {
  const reference = firstCommentReference(note?.scriptureRefs);
  return reference ? { exists: true, value: reference } : { exists: false };
}

export function commentPlaceValue(note: DocumentData | null): FieldValue {
  return note?.type === 'comment' ? leadingReferenceValue(note) : { exists: false };
}

export function placeOfCommentChange(changes: readonly FieldChange[], includeTailChanges = false): FieldChange | undefined {
  const root = changes.find(change => change.path.length === 1 && change.path[0] === 'scriptureRefs');
  const before = firstCommentReference(root?.before.value), after = firstCommentReference(root?.after.value);
  if (!before || !after || before.id !== after.id || !Array.isArray(root?.before.value) || !Array.isArray(root.after.value)
    || (!includeTailChanges && !equalValues(root.before.value.slice(1), root.after.value.slice(1)))) return undefined;
  return { path: ['scriptureRefs', 'id:' + before.id], before: { exists: true, value: before }, after: { exists: true, value: after } };
}

/** Replace only the proved first ID, retaining the exact stored shape of every other reference. */
export function replaceCommentReference(rows: Json | undefined, selected: FieldValue): Json | undefined {
  const current = firstCommentReference(rows);
  if (!current || !selected.exists || !object(selected.value) || current.id !== selected.value.id || !Array.isArray(rows)) return rows;
  return [selected.value, ...rows.slice(1)];
}

export function matchesCommentPlaceScope(note: DocumentData | null, reference: FieldValue, paragraph: FieldValue): boolean {
  const current = commentPlaceValue(note);
  return current.exists && reference.exists && object(current.value) && object(reference.value)
    && current.value.id === reference.value.id && equalValues(readField(note!, ['paragraph']), paragraph);
}

export function validCommentPlaceStamp(stamp: unknown, changes: readonly FieldChange[]): stamp is CommentPlaceStamp {
  if (!object(stamp) || typeof stamp.observedRevision !== 'number' || !Number.isSafeInteger(stamp.observedRevision)
    || stamp.observedRevision < 1 || (stamp.time !== null && boundedActionTime(stamp.time) === undefined)
    || (stamp.reviewed !== undefined && stamp.reviewed !== true)
    || (stamp.predecessorOperationId !== undefined && (typeof stamp.predecessorOperationId !== 'string' || !stamp.predecessorOperationId))) return false;
  const paragraph = stamp.paragraph;
  const changesRole = changes.some(({ path }) => path[0] === 'type' || path[0] === 'paragraph');
  return Boolean(object(paragraph) && (paragraph.exists === true ? typeof paragraph.value === 'boolean'
    : paragraph.exists === false && paragraph.value === undefined)
    && (changesRole ? stamp.compound === true : stamp.compound === undefined) && placeOfCommentChange(changes));
}

export function captureCommentPlace(baseline: ResourceSnapshot, value: DocumentData | null, capture: CommentPlaceCapture,
  knownPredecessor: boolean): CommentPlaceObservation | undefined {
  const { seen } = capture;
  const metadata = baseline.metadata;
  if (baseline.resource.collection !== 'studyNotes' || !metadata || metadata.deleted || metadata.generation !== seen.generation
    || !Number.isSafeInteger(seen.revision) || seen.revision < 1 || seen.revision > metadata.revision
    || !matchesCommentPlaceScope(baseline.value, seen.reference, seen.paragraph)
    || !matchesCommentPlaceDestination(value, seen.reference, seen.paragraph, capture.compound)
    || (seen.requestId && !knownPredecessor && !equalValues(commentPlaceValue(baseline.value), seen.reference))) return undefined;
  const after = leadingReferenceValue(value);
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined || equalValues(seen.reference, after)) return undefined;
  return { before: seen.reference, after, paragraph: seen.paragraph, observedRevision: seen.revision, time,
    ...(capture.compound && { compound: true }),
    ...(capture.reviewed && { reviewed: true }),
    ...(knownPredecessor && seen.requestId && { predecessorOperationId: seen.requestId }) };
}

export function matchesCommentPlaceDestination(note: DocumentData | null, reference: FieldValue, paragraph: FieldValue, compound?: true): boolean {
  if (!compound) return matchesCommentPlaceScope(note, reference, paragraph);
  const destination = leadingReferenceValue(note);
  return (note?.type === 'comment' || note?.type === 'note') && object(reference.value) && object(destination.value)
    && reference.value.id === destination.value.id;
}

export function matchesCommentPlaceRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: CommentPlaceSeen): boolean {
  const action = request?.commentPlaceAction;
  return Boolean(request && action && request.id === seen.requestId && request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.baseline.metadata?.generation === seen.generation && action.observedRevision === seen.revision
    && equalValues(action.after, seen.reference) && equalValues(action.paragraph, seen.paragraph)
    && !['conflict', 'refused', 'cancelled'].includes(request.state));
}

export function submittedCommentPlace(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[]): CommentPlaceSeen | undefined {
  const shown = checkpoint?.draft;
  const reference = commentPlaceValue(shown ?? null);
  const generation = checkpoint?.confirmed.metadata?.generation;
  if (!shown || !generation || !reference.exists) return undefined;
  const paragraph = readField(shown, ['paragraph']);
  const byId = new Map(requests.map(request => [request.id, request]));
  let id = Object.keys(checkpoint.pending).at(-1);
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = byId.get(id);
    if (!request || !matchesCommentPlaceScope(request.value, reference, paragraph)
      || !equalValues(commentPlaceValue(request.value), reference)) return undefined;
    const action = request.commentPlaceAction;
    if (action && request.baseline.metadata?.generation === generation
      && equalValues(action.after, reference) && equalValues(action.paragraph, paragraph)) {
      return { generation, revision: action.observedRevision, reference, paragraph, requestId: request.id };
    }
    id = request.predecessor ?? undefined;
  }
  return undefined;
}
