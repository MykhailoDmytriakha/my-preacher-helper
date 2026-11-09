import { boundedActionTime, type ActionTime } from './actionClock';
import { equalValues, readField } from './fieldValues';

import type { CommitRequest } from './commits';
import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue, ResourceRef, ResourceSnapshot } from './types';

export type CommentKindSeen = {
  generation: string;
  revision: number;
  kind: FieldValue;
  reference: FieldValue;
  requestId?: string;
};
export type CommentKindCapture = { seen: CommentKindSeen; time: ActionTime | null };
export type CommentKindObservation = DocumentFieldObservation<FieldValue> & { reference: FieldValue };
export type CommentKindHistoryPage = {
  owner: string;
  noteId: string;
  generation: string;
  entries: { id: string; paragraph: boolean; winnerParagraph: boolean }[];
  nextCursor: string | null;
};
export type CommentKindStamp = DocumentFieldStamp & { reference: FieldValue };

export function matchesCommentKindPlace(note: DocumentData | null, reference: FieldValue): boolean {
  return note?.type === 'comment' && equalValues(readField(note, ['scriptureRefs']), reference);
}

/** The pending request that supplied the kind currently shown by the reader. */
export function submittedCommentKind(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[]): CommentKindSeen | undefined {
  const shown = checkpoint?.draft;
  if (!checkpoint || shown?.type !== 'comment' || typeof shown.paragraph !== 'boolean') return undefined;
  const reference = readField(shown, ['scriptureRefs']);
  const kind = readField(shown, ['paragraph']);
  const byId = new Map(requests.map(request => [request.id, request]));
  let id = Object.keys(checkpoint.pending).at(-1);
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = byId.get(id);
    if (!request || !matchesCommentKindPlace(request.value, reference) || request.value?.paragraph !== shown.paragraph) return undefined;
    const action = request.commentKindAction;
    const generation = request.baseline.metadata?.generation;
    if (action && generation && generation === checkpoint.confirmed.metadata?.generation && equalValues(action.after, kind)) {
      return { generation, revision: action.observedRevision, reference, kind, requestId: request.id };
    }
    id = request.predecessor ?? undefined;
  }
  return undefined;
}

export function matchesCommentKindRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: CommentKindSeen): boolean {
  const action = request?.commentKindAction;
  return Boolean(request && action && request.id === seen.requestId && request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.baseline.metadata?.generation === seen.generation && matchesCommentKindPlace(request.value, seen.reference)
    && equalValues(action.after, seen.kind) && action.observedRevision === seen.revision
    && !['conflict', 'refused', 'cancelled'].includes(request.state));
}

export function captureCommentKind(baseline: ResourceSnapshot, value: DocumentData | null, capture: CommentKindCapture,
  knownPredecessor: boolean): CommentKindObservation | undefined {
  const { seen } = capture;
  const metadata = baseline.metadata;
  if (baseline.resource.collection !== 'studyNotes' || value?.type !== 'comment' || typeof value.paragraph !== 'boolean'
    || !metadata || metadata.deleted || metadata.generation !== seen.generation || !Number.isSafeInteger(seen.revision)
    || seen.revision < 1 || seen.revision > metadata.revision
    || (!knownPredecessor && (!matchesCommentKindPlace(baseline.value, seen.reference)
      || (seen.requestId && !equalValues(readField(baseline.value ?? {}, ['paragraph']), seen.kind))))) return undefined;
  const before = seen.kind, after = readField(value, ['paragraph']);
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if ((before.exists && typeof before.value !== 'boolean') || equalValues(before, after) || time === undefined) return undefined;
  return { before, after, observedRevision: seen.revision, time, reference: seen.reference,
    ...(knownPredecessor && seen.requestId && { predecessorOperationId: seen.requestId }) };
}
