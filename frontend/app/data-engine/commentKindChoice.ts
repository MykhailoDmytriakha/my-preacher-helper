import { matchesCommentKindPlace } from './commentKindAction';
import { equalValues, readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';

import type { CommentKindSeen } from './commentKindAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

const path = ['paragraph'];

function comparedKind(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]) {
  if (basis.resource.collection !== 'studyNotes' || basis.value?.type !== 'comment' || !draft || !stored?.value
    || !basis.metadata || basis.metadata.generation !== stored.metadata?.generation || conflicts.length !== 1) return undefined;
  const reference = readField(basis.value, ['scriptureRefs']);
  if (!matchesCommentKindPlace(draft, reference) || !matchesCommentKindPlace(stored.value, reference)) return undefined;
  const conflict = conflicts[0];
  const mine = readField(draft, path), saved = readField(stored.value, path);
  if (!equalValues(conflict.path, path) || !equalValues(conflict.mine, mine) || !equalValues(conflict.theirs, saved)
    || typeof mine.value !== 'boolean' || (saved.exists && typeof saved.value !== 'boolean') || equalValues(mine, saved)) return undefined;
  return { mine: mine.value, stored: typeof saved.value === 'boolean' ? saved.value : undefined };
}

export function readCommentKindComparison(checkpoint: SessionCheckpoint) {
  const comparison = comparedKind(checkpoint.confirmed, checkpoint.draft, checkpoint.remoteCandidate, checkpoint.conflicts);
  return comparison && { ...comparison, identity: JSON.stringify([checkpoint.editGeneration,
    checkpoint.remoteCandidate?.metadata?.generation, checkpoint.remoteCandidate?.metadata?.revision, comparison]) };
}

/** An explicit local decision may include words or a move. Pin the stored passage actually shown. */
export function commentKindChoiceOpening(checkpoint: SessionCheckpoint): CommentKindSeen | null | undefined {
  const { confirmed: basis, draft, remoteCandidate: stored } = checkpoint;
  if (basis.resource.collection !== 'studyNotes' || basis.value?.type !== 'comment' || draft?.type !== 'comment'
    || typeof draft.paragraph !== 'boolean' || draft.paragraph === basis.value.paragraph) return undefined;
  const reference = readField(basis.value, ['scriptureRefs']);
  if (!stored?.value || !stored.metadata || stored.metadata.generation !== basis.metadata?.generation
    || !matchesCommentKindPlace(stored.value, reference)) return null;
  return { generation: stored.metadata.generation, revision: stored.metadata.revision,
    kind: readField(stored.value, path), reference };
}

export function keepUncontestedCommentFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (!comparedKind(basis, draft, stored, conflicts) || !basis.value || !draft || !stored?.value) return undefined;
  const retained = writeField(draft, path, readField(basis.value, path));
  const merged = mergeDocumentFields(basis.value, retained, stored.value);
  if (merged.conflicts.length || !merged.value.exists) throw Object.assign(new Error('The shown comment kind changed'), { code: 'decision-changed' });
  return merged.value.value as DocumentData;
}
