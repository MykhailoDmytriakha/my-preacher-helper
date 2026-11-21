import { commentPlaceValue, matchesCommentPlaceScope, placeOfCommentChange, replaceCommentReference } from './commentPlaceAction';
import { equalValues, object, readField, writeField } from './fieldValues';
import { diffFields, mergeDocumentFields } from './protocol';
import { COMMENT_TEXT_REVIEW } from './studyNoteContentCapture';

import type { CommentKindObservation } from './commentKindAction';
import type { CommentPlaceObservation, CommentPlaceSeen } from './commentPlaceAction';
import type { CommitRequest } from './commits';
import type { OrdinaryAnswerChoice } from './ordinaryAnswerChoice';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

function comparedPlace(basis: ResourceSnapshot, draft: DocumentData | null, saved: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (basis.resource.collection !== 'studyNotes' || !basis.value || !draft || !saved?.value
    || !basis.metadata || !saved.metadata || basis.metadata.generation !== saved.metadata.generation
    || conflicts.length !== 1) return undefined;
  const opening = commentPlaceValue(basis.value);
  const paragraph = readField(basis.value, ['paragraph']);
  if (!matchesCommentPlaceScope(draft, opening, paragraph) || !matchesCommentPlaceScope(saved.value, opening, paragraph)) return undefined;
  const mine = commentPlaceValue(draft), stored = commentPlaceValue(saved.value), conflict = conflicts[0];
  if (!object(mine.value) || !object(stored.value) || !equalValues(conflict.path, ['scriptureRefs', 'id:' + mine.value.id])
    || !equalValues(conflict.mine, mine) || !equalValues(conflict.theirs, stored) || equalValues(mine, stored)) return undefined;
  return { opening, paragraph, mine: mine.value, stored: stored.value, metadata: saved.metadata };
}

export function readCommentPlaceComparison(checkpoint: SessionCheckpoint) {
  const comparison = comparedPlace(checkpoint.confirmed, checkpoint.draft, checkpoint.remoteCandidate, checkpoint.conflicts);
  if (!comparison) return undefined;
  const { mine, stored, metadata } = comparison;
  return { mine, stored, identity: JSON.stringify([checkpoint.editGeneration, metadata.generation, metadata.revision, mine, stored]) };
}

export function readCommentTextComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  const saved = remoteCandidate?.value;
  const conflict = conflicts[0];
  if (confirmed.resource.collection !== 'studyNotes' || draft?.type !== 'comment' || saved?.type !== 'comment'
    || confirmed.metadata?.generation !== remoteCandidate?.metadata?.generation || conflicts.length !== 1
    || !equalValues(conflict.path, ['content']) || typeof draft.content !== 'string' || typeof saved.content !== 'string'
    || conflict.mine.value !== draft.content || (conflict.code !== COMMENT_TEXT_REVIEW && conflict.theirs.value !== saved.content)) return undefined;
  return { mine: draft.content, stored: saved.content };
}

export function readReturnedCommentText(checkpoint: SessionCheckpoint) {
  if (checkpoint.conflicts[0]?.code === COMMENT_TEXT_REVIEW) return readCommentTextComparison(checkpoint);
}

export type CommentCompanionProofs = { commentKindAction?: CommentKindObservation; commentPlaceAction?: CommentPlaceObservation };

/** Choosing words may retry separately authored fields with their own original proofs. */
export function commentCompanionProofs(checkpoint: SessionCheckpoint, request: CommitRequest | undefined): CommentCompanionProofs {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (!request || !draft || !remoteCandidate?.metadata || remoteCandidate.metadata.generation !== request.baseline.metadata?.generation
    || request.baseline.resource.id !== confirmed.resource.id || request.baseline.resource.collection !== confirmed.resource.collection) return {};
  const command = request.command?.kind === 'update' ? request.command : undefined;
  const change = command?.changes.find(({ path }) => equalValues(path, ['paragraph']));
  const moved = command && placeOfCommentChange(command.changes);
  const kind = request.commentKindAction ?? (command?.commentKindAction && change ? { ...command.commentKindAction, before: change.before, after: change.after } : undefined);
  const place = request.commentPlaceAction ?? (command?.commentPlaceAction && moved ? { ...command.commentPlaceAction, before: moved.before, after: moved.after } : undefined);
  return {
    ...(kind && equalValues(readField(draft, ['paragraph']), kind.after)
      && { commentKindAction: kind }),
    ...(place && equalValues(commentPlaceValue(draft), place.after)
      && { commentPlaceAction: place }),
  };
}

/** Rebase the merge display for independently ordered siblings; the write still uses their original openings. */
export function commentTextChoiceBasis(checkpoint: SessionCheckpoint, proofs: CommentCompanionProofs): SessionCheckpoint {
  const { confirmed, remoteCandidate } = checkpoint;
  if (!confirmed.value || !remoteCandidate?.value || (!proofs.commentKindAction && !proofs.commentPlaceAction)) return checkpoint;
  let value = confirmed.value;
  if (proofs.commentKindAction) value = writeField(value, ['paragraph'], readField(remoteCandidate.value, ['paragraph']));
  if (proofs.commentPlaceAction) {
    const rows = replaceCommentReference(value.scriptureRefs, commentPlaceValue(remoteCandidate.value));
    if (rows !== undefined) value = { ...value, scriptureRefs: rows };
  }
  return { ...checkpoint, confirmed: { ...confirmed, value } };
}

/** The displayed choice decides only words and their transcript receipt. */
export function keepUncontestedCommentText(checkpoint: SessionCheckpoint): DocumentData | undefined {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (!readReturnedCommentText(checkpoint) || !confirmed.value || !draft || !remoteCandidate?.value) return undefined;
  let retained = writeField(draft, ['content'], readField(confirmed.value, ['content']));
  retained = writeField(retained, ['dictationSourceIds'], readField(confirmed.value, ['dictationSourceIds']));
  const merged = mergeDocumentFields(confirmed.value, retained, remoteCandidate.value);
  if (merged.conflicts.length || !merged.value.exists) {
    throw Object.assign(new Error('Other comment changes need review'), { code: 'decision-changed' });
  }
  return merged.value.value as DocumentData;
}

export function commentPlaceChoiceOpening(checkpoint: SessionCheckpoint): CommentPlaceSeen | undefined {
  const comparison = comparedPlace(checkpoint.confirmed, checkpoint.draft, checkpoint.remoteCandidate, checkpoint.conflicts);
  return comparison && { generation: comparison.metadata.generation, revision: comparison.metadata.revision,
    paragraph: comparison.paragraph, reference: { exists: true, value: comparison.stored } };
}

export function keepUncontestedCommentPlace(basis: ResourceSnapshot, draft: DocumentData | null, saved: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  const comparison = comparedPlace(basis, draft, saved, conflicts);
  if (!comparison || !draft || !saved?.value) return undefined;
  const references = replaceCommentReference(draft.scriptureRefs, comparison.opening);
  if (!references) return undefined;
  const merged = mergeDocumentFields(basis.value, { ...draft, scriptureRefs: references }, saved.value);
  if (merged.conflicts.length || !merged.value.exists) throw Object.assign(new Error('Other changes need review'), { code: 'decision-changed' });
  return merged.value.value as DocumentData;
}

/** A later text-only Save owns its final words regardless of which place is chosen. */
export function commentPlaceTextTail(choice: OrdinaryAnswerChoice): { content?: FieldChange } | undefined {
  if (choice.branched || !choice.first.commentPlaceAction || choice.first.commentPlaceAction.compound) return undefined;
  const changes: FieldChange[] = [];
  const byId = new Map(choice.scope.map(request => [request.id, request]));
  for (const request of choice.scope.slice(1)) {
    const predecessor = request.predecessor && byId.get(request.predecessor);
    if (request.commentPlaceAction || !predecessor || !predecessor.value || !request.value) return undefined;
    const changed = diffFields(predecessor.value, request.value).filter(({ path }) => path[0] !== 'updatedAt');
    if (changed.some(({ path }) => path.length !== 1 || path[0] !== 'content')) return undefined;
    changes.push(...changed.map(change => ({ ...change, before: request.commentTextOpening ?? change.before })));
  }
  const first = changes[0], last = changes.at(-1);
  if (!first || !last) return {};
  return { content: equalValues(first.before, last.after) ? last : { ...first, after: last.after } };
}

/** The place decision does not decide words, even when one Save captured both. */
export function commentPlaceTextChange(checkpoint: SessionCheckpoint, tail?: FieldChange): FieldChange | undefined {
  if (!checkpoint.confirmed.value || !checkpoint.draft) return undefined;
  const path = ['content'];
  const before = readField(checkpoint.confirmed.value, path);
  const after = readField(checkpoint.draft, path);
  const proposed = tail?.after ?? after;
  const opening = tail && (equalValues(before, after) || equalValues(before, proposed)) ? tail.before : before;
  return equalValues(opening, proposed) ? undefined : { path, before: opening, after: proposed };
}
