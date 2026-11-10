import { createHash } from 'node:crypto';

import { commentPlaceValue, placeOfCommentChange } from './commentPlaceAction';
import { commandFingerprint, equalValues, object, readField } from './fieldValues';

import type { ConflictDetail, DataCommand, DocumentData, FieldValue, ResourceSnapshot } from './types';

const MAX_PRIOR_PLACES = 16;

function placeFrame(note: DocumentData | null): string | undefined {
  const place = commentPlaceValue(note);
  return place.exists ? createHash('sha256').update(commandFingerprint(place)).digest('base64url') : undefined;
}

function priorFrames(raw: unknown): string[] | null | undefined {
  if (!object(raw)) return undefined;
  const frames = raw.commentPlaceFrames;
  return frames === null || (Array.isArray(frames) && frames.every(frame => typeof frame === 'string')) ? frames : undefined;
}

export function nextCommentPlaceFrames(snapshot: ResourceSnapshot, raw: DocumentData | undefined): string[] | null | undefined {
  if (snapshot.resource.collection !== 'studyNotes') return undefined;
  const metadata = raw?._dataEngine;
  const sameGeneration = object(metadata) && metadata.generation === snapshot.metadata?.generation;
  const previous = sameGeneration ? priorFrames(metadata) : undefined;
  if (previous === null) return null;
  const opening = sameGeneration && raw ? placeFrame(raw) : undefined;
  const stored = placeFrame(snapshot.value);
  if (!opening && !stored && !previous) return undefined;
  const frames = previous ?? [];
  const kindUnchanged = raw && snapshot.value && equalValues(readField(raw, ['paragraph']), readField(snapshot.value, ['paragraph']));
  if (!opening || (opening === stored && kindUnchanged) || frames.includes(opening)) return frames;
  return frames.length < MAX_PRIOR_PLACES ? [...frames, opening] : null;
}

/** Older packets can continue a continuous opening, but a returned place cannot date an old save. */
export function commentPlaceReview(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot, raw: unknown,
  stored: FieldValue, previous: { revision: number; operationId?: string } | undefined, validAction: boolean): ConflictDetail | undefined {
  const change = placeOfCommentChange(command.changes, !command.commentPlaceAction);
  if (!change || !current.metadata || !stored.exists) return undefined;
  const { before, after, path } = change;
  const uncertain = { path, base: before, mine: after, theirs: stored };
  const stamp = command.commentPlaceAction;
  if (!stamp) {
    if (equalValues(before, after) || !equalValues(before, stored)) return undefined;
    const reviewedRevision = command.commentKindAction?.observedRevision;
    if (reviewedRevision !== undefined && previous && reviewedRevision >= previous.revision && reviewedRevision <= current.metadata.revision) return undefined;
    const past = priorFrames(raw);
    const digest = placeFrame(current.value);
    return past === null || (digest !== undefined && past?.includes(digest)) ? uncertain : undefined;
  }
  if (!validAction) return uncertain;
  if (!stamp.compound && !stamp.reviewed) return undefined;
  const follows = !stamp.reviewed && stamp.predecessorOperationId !== undefined && previous?.operationId === stamp.predecessorOperationId;
  if (equalValues(before, stored) && (follows || (previous?.revision ?? current.metadata.revision) <= stamp.observedRevision)) return undefined;
  return uncertain;
}
