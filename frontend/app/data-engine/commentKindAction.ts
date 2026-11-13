import { boundedActionTime, type ActionTime } from './actionClock';
import { confirmedCommentOpening, matchesCommentOpeningRequest, submittedCommentOpening } from './commentOpening';
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

function matchesKindOpening(note: DocumentData | null, reference: FieldValue, kind: FieldValue): boolean {
  return note !== null && matchesCommentKindPlace(note, reference) && equalValues(readField(note, ['paragraph']), kind);
}

/** The pending request that supplied the passage and kind currently shown by the reader. */
export function submittedCommentKind(owner: string, checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[]): CommentKindSeen | undefined {
  const shown = checkpoint?.draft;
  if (shown?.type !== 'comment') return undefined;
  const reference = readField(shown, ['scriptureRefs']);
  const kind = readField(shown, ['paragraph']);
  if (kind.exists && typeof kind.value !== 'boolean') return undefined;
  const opening = submittedCommentOpening(owner, checkpoint, requests, value => matchesKindOpening(value, reference, kind));
  return opening && { ...opening, reference, kind };
}

export function matchesCommentKindRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef, seen: CommentKindSeen): boolean {
  return matchesCommentOpeningRequest(request, owner, resource, seen, value => matchesKindOpening(value, seen.reference, seen.kind));
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
    ...((knownPredecessor || confirmedCommentOpening(baseline, seen, note => matchesKindOpening(note, seen.reference, seen.kind)))
      && seen.requestId && { predecessorOperationId: seen.requestId }) };
}
