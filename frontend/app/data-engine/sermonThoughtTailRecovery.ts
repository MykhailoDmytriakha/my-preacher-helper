import { equalValues } from './fieldValues';
import { capturedThoughtLocks, thoughtLockRecoveryCopies, type ThoughtLockChange } from './sermonThoughtLockRecovery';
import { copySermonThoughtFrame, sermonThoughtFrame } from './sermonThoughtRecoveryFrame';
import { capturedThoughtRemoval, thoughtRemovalRecoveryCopies } from './sermonThoughtRemovalRecovery';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

/** Split only transitions explained in full by a removal and exact locks of surviving thoughts. */
export function recoverableThoughtLockAndRemovalTail(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const { confirmed, draft } = source;
  const { value: opening, metadata } = confirmed;
  const target = projected.confirmed;
  const first = chain[0]?.value, last = chain.at(-1)?.value, saved = target.value;
  if (!metadata || !opening || !draft || !first || !last || !saved || !equalValues(sermonThoughtFrame(opening), sermonThoughtFrame(first))
    || !equalValues(sermonThoughtFrame(last), sermonThoughtFrame(draft))) return;

  const removed = new Map<string, string>();
  const locks = new Map<string, ThoughtLockChange>();
  for (let index = 1; index < chain.length; index += 1) {
    const request = chain[index], before = chain[index - 1].value, after = request.value;
    if (!before || !after || request.baseline.metadata?.generation !== metadata.generation) return;
    const removal = capturedThoughtRemoval(opening, before, after);
    if (removal) {
      if (locks.has(removal.rowId)) return;
      removed.set(removal.rowId, removal.birth);
    }
    const changes = capturedThoughtLocks(removal?.proposed ?? before, after, request.thoughtLockActions);
    if (!changes || changes.some(change => removed.has(change.rowId))) return;
    for (const change of changes) locks.set(change.rowId, change);
  }
  if (!removed.size && !locks.size) return;

  const removals = removed.size ? thoughtRemovalRecoveryCopies(source, target, removed) : [];
  if (!removals) return;
  return { copies: [...removals, ...thoughtLockRecoveryCopies(source, target, [...locks.values()])],
    restoreStored: (value: DocumentData) => copySermonThoughtFrame(value, saved) };
}
