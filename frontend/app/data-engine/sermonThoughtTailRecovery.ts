import { equalValues } from './fieldValues';
import { capturedThoughtLocks, projectThoughtLock, thoughtLockRecoveryCopies, type ThoughtLockChange } from './sermonThoughtLockRecovery';
import { capturedThoughtMove, thoughtPlacementRecoveryCopy, type CapturedThoughtMove } from './sermonThoughtPlacementRecovery';
import { copySermonThoughtFrame, sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { capturedThoughtRemoval, projectThoughtRemoval, thoughtRemovalRecoveryCopies } from './sermonThoughtRemovalRecovery';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

function readCapturedThoughtActions(chain: readonly CommitRequest[], generation: string) {
  const moves: CapturedThoughtMove[] = [];
  const removed = new Map<string, string>();
  const locks = new Map<string, ThoughtLockChange>();
  for (let index = 1; index < chain.length; index += 1) {
    const request = chain[index], before = chain[index - 1].value, after = request.value;
    if (!before || !after || request.baseline.metadata?.generation !== generation) return;
    const removal = capturedThoughtRemoval(before, after);
    const afterRemoval = removal?.proposed ?? before;
    const placement = capturedThoughtMove(afterRemoval, after, request);
    if (request.thoughtPlacementActions?.length && !placement) return;
    const changes = capturedThoughtLocks(placement?.proposed ?? afterRemoval, after, request.thoughtLockActions);
    if (!changes) return;
    if (placement) moves.push(placement.move);
    if (removal) {
      // Earlier transitions proved every change to this thought and its identity.
      // The later explicit removal is the only remaining intent for this row.
      locks.delete(removal.rowId);
      removed.set(removal.rowId, removal.birth);
    }
    for (const change of changes) locks.set(change.rowId, change);
  }
  if (!moves.length && !removed.size && !locks.size) return;
  return { moves, removed, locks };
}

/** Recover only the exact canonical thought changes whose captured order we can reconstruct. */
export function recoverableThoughtTail(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const { value: opening, metadata } = confirmed;
  const target = projected.confirmed;
  const first = chain[0]?.value, last = chain.at(-1)?.value, saved = target.value;
  if (!metadata || !opening || !draft || !first || !last || !saved || !equalValues(sermonThoughtFrame(opening), sermonThoughtFrame(first))
    || !equalValues(sermonThoughtFrame(last), sermonThoughtFrame(draft))) return;

  const captured = readCapturedThoughtActions(chain, metadata.generation);
  if (!captured) return;
  const { moves, removed, locks } = captured;
  const survivingMoves = moves.filter(move => !removed.has(move.id));
  const placement = thoughtPlacementRecoveryCopy(source, survivingMoves);
  if (survivingMoves.length && !placement) return;
  if (moves.length) {
    // A deletion can change the neighbors used to place a different thought. Split only
    // when the remaining moves, removals and locks reproduce the captured final frame.
    const afterMoves = placement?.continuation.draft ?? opening;
    const afterRemovals = [...removed.keys()].reduce(projectThoughtRemoval, afterMoves);
    const lastLocks = [...locks.values()].reduce((value, { rowId, checked }) => projectThoughtLock(value, rowId, checked), afterRemovals);
    if (!equalValues(sermonThoughtFrame(lastLocks), sermonThoughtFrame(last))) return;
  }
  const removals = removed.size ? thoughtRemovalRecoveryCopies(source, target, removed) : [];
  if (!removals) return;
  return { copies: [...(placement ? [placement] : []), ...removals, ...thoughtLockRecoveryCopies(source, target, [...locks.values()])],
    restoreStored: (value: DocumentData) => copySermonThoughtFrame(value, saved) };
}
