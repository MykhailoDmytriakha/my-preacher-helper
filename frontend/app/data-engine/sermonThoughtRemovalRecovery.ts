import { deleteSermonThought } from '@/utils/sermonThoughtEdits';

import { equalValues, object } from './fieldValues';
import { copySermonThoughtFrame, sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { UNREADABLE_ROW_PROOF } from './unreadableDraftProof';

import type { CommitRequest } from './commits';
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

const removeThought = (value: DocumentData, id: string) =>
  deleteSermonThought(value as unknown as Sermon, id) as unknown as DocumentData;

function removedThought(before: DocumentData, after: DocumentData) {
  const rows = thoughtRows(before), next = thoughtRows(after);
  if (!rows || !next) return;
  const missing = [...rows.entries()].filter(([id]) => !next.has(id));
  if (missing.length !== 1) return;
  const [[rowId, row]] = missing;
  if (typeof row.date !== 'string' || typeof row.text !== 'string') return;
  return { rowId, row, birth: row.date, text: row.text, proposed: removeThought(before, rowId) };
}

/** An old request may omit action metadata. It still proves the exact shape of a removal. */
export function recoverableThoughtRemovals(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const { value: opening, metadata } = confirmed;
  const first = chain[0]?.value, last = chain.at(-1)?.value, saved = projected.confirmed.value;
  if (!metadata || !opening || !draft || !first || !last || !saved || !equalValues(sermonThoughtFrame(opening), sermonThoughtFrame(first))
    || !equalValues(sermonThoughtFrame(last), sermonThoughtFrame(draft))) return;
  const originals = thoughtRows(opening), current = thoughtRows(saved);
  if (!originals || !current) return;

  const removed = new Map<string, string>();
  for (let index = 1; index < chain.length; index += 1) {
    const before = chain[index - 1].value, after = chain[index].value;
    if (!before || !after) return;
    if (equalValues(sermonThoughtFrame(before), sermonThoughtFrame(after))) continue;
    const removal = removedThought(before, after);
    if (!removal || !equalValues(removal.row, originals.get(removal.rowId))
      || !equalValues(sermonThoughtFrame(removal.proposed), sermonThoughtFrame(after))) return;
    removed.set(removal.rowId, removal.birth);
  }
  if (!removed.size) return;

  const copies = [...removed].flatMap(([rowId, birth]) => current.get(rowId)?.date !== birth ? [] : [{
    key: 'thought-removal:' + rowId, recoveryKind: 'sermon-thought-removal' as const,
    continuation: { confirmed, draft: removeThought(opening, rowId), editGeneration: source.editGeneration,
      dirty: true, pending: {}, conflicts: [], remoteCandidate: null,
      unreadableRowProofs: [{ field: 'thoughtRemoval', rowId, birth, generation: metadata.generation }],
    } satisfies SessionCheckpoint,
  }]);
  return { copies, restoreStored: (value: DocumentData) => copySermonThoughtFrame(value, saved) };
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
  const removal = removedThought(confirmed.value, draft);
  if (!removal || removal.rowId !== address.rowId || removal.birth !== address.birth
    || !equalValues(draft, removal.proposed)) return;
  return removal;
}

function removalAgainstStored(checkpoint: SessionCheckpoint, opening: ReturnType<typeof removedThought>, target: ResourceSnapshot) {
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
    proposed: removeThought(target.value, opening.rowId),
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
  const removal = removedThought(confirmed.value, value);
  if (!removal || !equalValues(removal.proposed, value)) return;
  const comparison = removalAgainstStored(checkpoint, removal, remoteCandidate);
  return comparison && { ...comparison, requestId };
}

export function sermonThoughtRemovalDraft(checkpoint: SessionCheckpoint) {
  return removalOpening(checkpoint)?.text;
}
