import { commentPlaceValue, matchesCommentPlaceScope, replaceCommentReference } from './commentPlaceAction';
import { equalValues, object, readField } from './fieldValues';
import { diffFields, mergeDocumentFields } from './protocol';

import type { CommentPlaceSeen } from './commentPlaceAction';
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
    || conflict.mine.value !== draft.content || conflict.theirs.value !== saved.content) return undefined;
  return { mine: draft.content, stored: saved.content };
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
