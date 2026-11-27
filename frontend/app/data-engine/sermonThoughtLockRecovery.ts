import { isActionTime } from './actionClock';
import { equalValues, object, readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { existingRowField, existingRowFields, replaceExistingRowField } from './rowFieldAction';
import { sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { THOUGHT_LOCK_POLICY } from './thoughtLockAction';
import { awaitsRowReturnVersion, hasUnreadableDraftProof } from './unreadableDraftProof';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceSnapshot } from './types';

const target = THOUGHT_LOCK_POLICY.target('isLocked');
const { birth } = THOUGHT_LOCK_POLICY;
const lockAt = (value: DocumentData, id: string) => existingRowField(value.thoughts, id, target);
const bornAt = (value: DocumentData, id: string) => existingRowField(value.thoughts, id, birth);
export function projectThoughtLock(value: DocumentData, id: string, checked: boolean): DocumentData {
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
    projected = projectThoughtLock(projected, rowId, checked);
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
      confirmed: compared ? target : confirmed, draft: projectThoughtLock(compared ? saved : opening, rowId, checked),
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

function copyThoughtLockFields(value: DocumentData, source: DocumentData, rowIds: readonly string[]): DocumentData {
  if (!Array.isArray(value.thoughts) || !Array.isArray(source.thoughts)) return value;
  const affected = new Set(rowIds);
  const locks = new Map(source.thoughts.flatMap(row => object(row) && typeof row.id === 'string' && affected.has(row.id)
    ? [[row.id, readField(row, ['isLocked'])] as const] : []));
  const thoughts = value.thoughts.map(row => {
    const lock = object(row) && typeof row.id === 'string' ? locks.get(row.id) : undefined;
    return lock && object(row) ? writeField(row, ['isLocked'], lock) : row;
  });
  return { ...value, thoughts };
}

/** Replaying the declared locks from the draft must account for every local change. */
export function matchesThoughtLockDraft(opening: DocumentData, draft: DocumentData, rowIds: readonly string[]): boolean {
  return equalValues(copyThoughtLockFields(opening, draft, rowIds), draft);
}

export function hasReviewedThoughtLocks(checkpoint: SessionCheckpoint): boolean {
  return Object.values(checkpoint.thoughtLockDrafts ?? {}).some(proof => proof.reviewed);
}

export function canSaveReviewedThoughtLocks(checkpoint: SessionCheckpoint): boolean {
  return !checkpoint.conflicts.length && !hasUnreadableDraftProof(checkpoint) && hasReviewedThoughtLocks(checkpoint);
}

/** The next choice drops only its own conflicting words, without taking a prior lock decision with them. */
export function openingKeepingReviewedThoughtLocks(checkpoint: SessionCheckpoint, shown: DocumentData): DocumentData | undefined {
  const { confirmed, remoteCandidate, conflicts } = checkpoint;
  if (!confirmed.value || !remoteCandidate?.value || !conflicts.length
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation) return;
  const opening = confirmed.value, saved = remoteCandidate.value;
  const keep = Object.values(checkpoint.thoughtLockDrafts ?? {}).flatMap(({ generation, action }) => {
    const { rowId, rowCreatedAt, after } = action;
    const path = ['thoughts', 'id:' + rowId, 'isLocked'];
    if (generation !== confirmed.metadata?.generation || lockAt(shown, rowId) !== after
      || bornAt(opening, rowId) !== rowCreatedAt || bornAt(saved, rowId) !== rowCreatedAt || bornAt(shown, rowId) !== rowCreatedAt
      || conflicts.some(conflict => conflict.path.every((part, index) => part === path[index]))) return [];
    return [rowId];
  });
  return keep.length ? copyThoughtLockFields(shown, opening, keep) : undefined;
}

type RecoveredLockChoice = { rowId: string; checked: boolean; stored: boolean; text: string };

export function recoveredThoughtLock(checkpoint: SessionCheckpoint, saved: ResourceSnapshot) {
  const addresses = checkpoint.unreadableRowProofs ?? [];
  const { confirmed, draft } = checkpoint;
  const generation = confirmed.metadata?.generation;
  if (confirmed.resource.collection !== 'sermons' || !generation || !confirmed.value || !draft || !saved.value
    || !addresses.length || checkpoint.unreadableScalarProof?.length || checkpoint.unreadableExegeticalProofs?.length
    || saved.metadata?.deleted || addresses.some(address => address.field !== 'thoughtLockDrafts' || address.generation !== generation
      || awaitsRowReturnVersion(address, saved))) return;
  const rowIds = addresses.map(address => address.rowId);
  if (new Set(rowIds).size !== rowIds.length) return;
  // Older isolated copies require an exact projection. A restored return can also have later local edits.
  if (!addresses.some(address => address.returnedToOpening) && !matchesThoughtLockDraft(confirmed.value, draft, rowIds)) return;
  const openingBirths = existingRowFields(confirmed.value.thoughts, birth);
  const draftBirths = existingRowFields(draft.thoughts, birth);
  const locks = existingRowFields(draft.thoughts, target);
  if (addresses.some(({ rowId, birth: date }) => openingBirths.get(rowId) !== date || draftBirths.get(rowId) !== date
    || locks.get(rowId) === undefined)) return;
  const paths = rowIds.map(rowId => ['thoughts', 'id:' + rowId, 'isLocked']);
  if (saved.metadata?.generation !== generation) return { settled: true as const, storedDraft: saved.value, paths, conflicts: [] };
  if (!Array.isArray(saved.value.thoughts)) return;
  const rows = new Map<string, DocumentData | null>();
  for (const row of saved.value.thoughts) {
    if (object(row) && typeof row.id === 'string') rows.set(row.id, rows.has(row.id) ? null : row);
  }
  const savedLocks = existingRowFields(saved.value.thoughts, target);
  const choices: RecoveredLockChoice[] = [];
  for (const { rowId, birth: date } of addresses) {
    const row = rows.get(rowId);
    if (row === null || (row && (typeof row.date !== 'string' || typeof row.text !== 'string'))) return;
    if (!row || row.date !== date) continue;
    const checked = locks.get(rowId), stored = savedLocks.get(rowId);
    if (checked === undefined || stored === undefined) return;
    if (checked !== stored) choices.push({ rowId, checked, stored, text: row.text as string });
  }
  // The lock choice owns only its fields. Merge any later edits with the current saved sermon.
  const neutral = copyThoughtLockFields(draft, confirmed.value, rowIds);
  const merged = mergeDocumentFields(confirmed.value, neutral, saved.value);
  if (!merged.value.exists || !object(merged.value.value)) return;
  const storedDraft = merged.value.value;
  const common = { storedDraft, paths, conflicts: merged.conflicts };
  if (!choices.length) return { ...common, settled: true as const };
  const proposed = choices.reduce((value, { rowId, checked }) => projectThoughtLock(value, rowId, checked), storedDraft);
  return { ...common, choices, proposed, settled: false as const };
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
