import { deleteSermonThought } from '@/utils/sermonThoughtEdits';

import { equalValues, object } from './fieldValues';
import { UNREADABLE_ROW_PROOF } from './unreadableDraftProof';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';
import type { Sermon } from '@/models/models';

function thoughtRows(value: DocumentData) {
  const rows = value.thoughts;
  if (!Array.isArray(rows) || !rows.every(object)) return;
  const indexed = new Map<string, DocumentData>();
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || indexed.has(row.id)) return;
    indexed.set(row.id, row);
  }
  return indexed;
}

export const projectThoughtRemoval = (value: DocumentData, id: string) =>
  deleteSermonThought(value as unknown as Sermon, id) as unknown as DocumentData;

export function capturedThoughtRemoval(before: DocumentData, after: DocumentData) {
  const rows = thoughtRows(before), next = thoughtRows(after);
  if (!rows || !next) return;
  const missing = [...rows.entries()].filter(([id]) => !next.has(id));
  if (missing.length !== 1) return;
  const [[rowId, row]] = missing;
  if (typeof row.date !== 'string' || typeof row.text !== 'string') return;
  return { rowId, row, birth: row.date, text: row.text, proposed: projectThoughtRemoval(before, rowId) };
}

export function thoughtRemovalRecoveryCopies(source: SessionCheckpoint, target: ResourceSnapshot, removed: ReadonlyMap<string, string>) {
  const { confirmed } = source;
  const { value: opening, metadata } = confirmed;
  const current = target.value && thoughtRows(target.value);
  if (!metadata || !opening || !current) return;
  return [...removed].flatMap(([rowId, birth]) => current.get(rowId)?.date !== birth ? [] : [{
    key: 'thought-removal:' + rowId, recoveryKind: 'sermon-thought-removal' as const,
    continuation: { confirmed, draft: projectThoughtRemoval(opening, rowId), editGeneration: source.editGeneration,
      dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
      unreadableRowProofs: [{ field: 'thoughtRemoval', rowId, birth, generation: metadata.generation }],
    } satisfies SessionCheckpoint,
  }]);
}

export function unresolvedThoughtRemoval(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.confirmed.resource.collection === 'sermons'
    && checkpoint.unreadableRowProofs?.some(address => address.field === 'thoughtRemoval') === true;
}

function removalOpening(checkpoint: SessionCheckpoint) {
  const [address, other] = checkpoint.unreadableRowProofs ?? [];
  const { confirmed, draft } = checkpoint;
  if (other || address?.field !== 'thoughtRemoval' || !unresolvedThoughtRemoval(checkpoint)
    || checkpoint.unreadableScalarProof?.length || checkpoint.unreadableExegeticalProofs?.length
    || !confirmed.value || !draft || confirmed.metadata?.deleted || confirmed.metadata?.generation !== address.generation) return;
  const removal = capturedThoughtRemoval(confirmed.value, draft);
  if (!removal || removal.rowId !== address.rowId || removal.birth !== address.birth
    || !equalValues(draft, removal.proposed)) return;
  return removal;
}

function removalAgainstStored(checkpoint: SessionCheckpoint, opening: ReturnType<typeof capturedThoughtRemoval>, target: ResourceSnapshot) {
  if (!opening || !target.metadata || target.metadata.deleted || !target.value
    || target.resource.collection !== checkpoint.confirmed.resource.collection || target.resource.id !== checkpoint.confirmed.resource.id) return;
  const identity = JSON.stringify([opening.rowId, opening.birth, target.metadata.generation, target.metadata.revision, checkpoint.editGeneration]);
  if (target.metadata.generation !== checkpoint.confirmed.metadata?.generation) {
    return { opening: opening.text, settled: true as const, stored: undefined, identity };
  }
  const rows = thoughtRows(target.value);
  if (!rows) return;
  const row = rows.get(opening.rowId);
  if (!row || row.date !== opening.birth) {
    return { opening: opening.text, settled: true as const, stored: typeof row?.text === 'string' ? row.text : undefined, identity };
  }
  if (typeof row.text !== 'string') return;
  const conflict: ConflictDetail = {
    path: ['thoughts', 'id:' + opening.rowId],
    base: { exists: true, value: opening.row }, mine: { exists: false },
    theirs: { exists: true, value: row }, code: UNREADABLE_ROW_PROOF,
  };
  return { opening: opening.text, stored: row.text, settled: false as const, conflict,
    proposed: projectThoughtRemoval(target.value, opening.rowId),
    identity,
  };
}

export function recoveredThoughtRemoval(checkpoint: SessionCheckpoint, target: ResourceSnapshot) {
  return removalAgainstStored(checkpoint, removalOpening(checkpoint), target);
}

/** A delivered conflict is a new comparison against the exact, already captured removal. */
export function pendingThoughtRemoval(checkpoint: SessionCheckpoint) {
  const [request] = Object.entries(checkpoint.pending).sort(([, left], [, right]) => left.generation - right.generation);
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  if (!request?.[1].value || !confirmed.value || !remoteCandidate || confirmed.resource.collection !== 'sermons'
    || !conflicts.some(({ path }) => ['thoughts', 'structure', 'thoughtsBySection'].includes(path[0]))) return;
  const [requestId, captured] = request;
  const value = captured.value!;
  const removal = capturedThoughtRemoval(confirmed.value, value);
  if (!removal || !equalValues(removal.proposed, value)) return;
  const comparison = removalAgainstStored(checkpoint, removal, remoteCandidate);
  return comparison && { ...comparison, requestId };
}

export function sermonThoughtRemovalDraft(checkpoint: SessionCheckpoint) {
  return removalOpening(checkpoint)?.text;
}
