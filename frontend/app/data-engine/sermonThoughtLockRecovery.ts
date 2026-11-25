import { isActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { existingRowField, existingRowFields, replaceExistingRowField } from './rowFieldAction';
import { sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { THOUGHT_LOCK_POLICY } from './thoughtLockAction';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

const target = THOUGHT_LOCK_POLICY.target('isLocked');
const { birth } = THOUGHT_LOCK_POLICY;
const lockAt = (value: DocumentData, id: string) => existingRowField(value.thoughts, id, target);
const bornAt = (value: DocumentData, id: string) => existingRowField(value.thoughts, id, birth);
function withLock(value: DocumentData, id: string, checked: boolean): DocumentData {
  const thoughts = replaceExistingRowField(value.thoughts, id, checked, target);
  return thoughts === undefined ? value : { ...value, thoughts };
}

type CapturedLock = NonNullable<CommitRequest['thoughtLockActions']>[number];
export type ThoughtLockChange = { rowId: string; birth: string; checked: boolean; evidence?: CapturedLock };

export function capturedThoughtLocks(before: DocumentData, after: DocumentData, actions: readonly CapturedLock[] = []) {
  const old = existingRowFields(before.thoughts, target);
  const changes: ThoughtLockChange[] = [];
  let projected = before;
  for (const [rowId, checked] of existingRowFields(after.thoughts, target)) {
    const previous = old.get(rowId);
    if (previous === checked) continue;
    const created = bornAt(before, rowId);
    if (previous === undefined || checked === undefined || created === undefined || bornAt(after, rowId) !== created) return;
    const proof = actions.find(action => action.rowId === rowId);
    const evidence = proof && proof.rowCreatedAt === created && proof.before === previous && proof.after === checked
      && (proof.time === null || isActionTime(proof.time)) ? proof : undefined;
    changes.push({ rowId, birth: created, checked, evidence });
    projected = withLock(projected, rowId, checked);
  }
  if (!equalValues(sermonThoughtFrame(projected), sermonThoughtFrame(after))
    || new Set(actions.map(({ rowId }) => rowId)).size !== actions.length
    || actions.some(action => !changes.some(change => change.rowId === action.rowId))) return;
  return changes;
}

export function thoughtLockRecoveryCopies(source: SessionCheckpoint, target: ResourceSnapshot, latest: readonly ThoughtLockChange[]) {
  const { confirmed } = source;
  const { value: opening, metadata } = confirmed;
  const saved = target.value;
  if (!metadata || !opening || !saved) return [];

  return latest.flatMap(({ rowId, birth, checked, evidence: action }) => {
    const original = lockAt(opening, rowId), remote = lockAt(saved, rowId);
    if (original === undefined || remote === undefined || bornAt(opening, rowId) !== birth || bornAt(saved, rowId) !== birth) return [];
    const proved = action && action.observedRevision === metadata.revision && action.before === original && !action.predecessorOperationId;
    if (!proved && checked === remote) return [];
    // A reversal may equal the old opening. Preserve the last choice against the newer value.
    const compared = !proved && checked === original;
    const continuation: SessionCheckpoint = {
      confirmed: compared ? target : confirmed, draft: withLock(compared ? saved : opening, rowId, checked),
      dirty: true, editGeneration: source.editGeneration, remoteCandidate: null, conflicts: [], pending: {},
      ...(proved ? { thoughtLockDrafts: { [rowId]: { generation: metadata.generation, action } } }
        : { unreadableRowProofs: [{ field: 'thoughtLockDrafts', rowId, birth, generation: metadata.generation }] }),
    };
    return [{ key: 'thought-lock:' + rowId, recoveryKind: 'sermon-thought-lock' as const, continuation }];
  });
}

export function unresolvedThoughtLock(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.confirmed.resource.collection === 'sermons'
    && checkpoint.unreadableRowProofs?.some(address => address.field === 'thoughtLockDrafts') === true;
}

export function recoveredThoughtLock(checkpoint: SessionCheckpoint, saved: ResourceSnapshot) {
  const [address, other] = checkpoint.unreadableRowProofs ?? [];
  const { confirmed, draft } = checkpoint;
  if (other || address?.field !== 'thoughtLockDrafts' || !unresolvedThoughtLock(checkpoint) || !confirmed.value || !draft || !saved.value
    || checkpoint.unreadableScalarProof?.length || checkpoint.unreadableExegeticalProofs?.length
    || confirmed.metadata?.generation !== address.generation || saved.metadata?.deleted) return;
  const { rowId, birth } = address;
  const checked = lockAt(draft, rowId);
  if (checked === undefined || bornAt(confirmed.value, rowId) !== birth || bornAt(draft, rowId) !== birth
    || !equalValues(withLock(confirmed.value, rowId, checked), draft)) return;
  const before = { rowId, checked };
  if (saved.metadata?.generation !== address.generation) return { ...before, settled: true as const };
  if (!Array.isArray(saved.value.thoughts)) return;
  const rows = saved.value.thoughts.filter(row => object(row) && row.id === rowId);
  const [row, duplicate] = rows;
  if (duplicate) return;
  if (!row) return { ...before, settled: true as const };
  if (!object(row) || typeof row.date !== 'string' || typeof row.text !== 'string') return;
  if (row.date !== birth) return { ...before, settled: true as const };
  const stored = lockAt(saved.value, rowId);
  if (stored === undefined) return;
  if (stored === checked) return { ...before, settled: true as const };
  return { ...before, stored, settled: false as const, text: row.text, proposed: withLock(saved.value, rowId, checked) };
}

export function reviewUnavailableThoughtLock(checkpoint: SessionCheckpoint, saved: ResourceSnapshot): SessionCheckpoint {
  const [lock, other] = Object.values(checkpoint.thoughtLockDrafts ?? {});
  if (!lock || other) return checkpoint;
  const { rowId, rowCreatedAt } = lock.action;
  if (saved.value && saved.metadata?.generation === lock.generation && !saved.metadata.deleted
    && bornAt(saved.value, rowId) === rowCreatedAt && lockAt(saved.value, rowId) !== undefined) return checkpoint;
  return { ...checkpoint, thoughtLockDrafts: undefined, unreadableRowProofs: [{
    field: 'thoughtLockDrafts', rowId, birth: rowCreatedAt, generation: lock.generation,
  }] };
}

export function sermonThoughtLockDraft(checkpoint: SessionCheckpoint) {
  const id = checkpoint.unreadableRowProofs?.find(address => address.field === 'thoughtLockDrafts')?.rowId
    ?? Object.keys(checkpoint.thoughtLockDrafts ?? {})[0];
  if (!id || !checkpoint.draft || !Array.isArray(checkpoint.draft.thoughts)) return;
  const checked = lockAt(checkpoint.draft, id);
  const row = checkpoint.draft.thoughts.find(value => object(value) && value.id === id);
  if (checked !== undefined && object(row) && typeof row.text === 'string') return { text: row.text, checked };
}
