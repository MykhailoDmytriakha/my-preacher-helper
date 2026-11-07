import { areDifferentTabEditors } from './editorIdentity';
import { markBorrowedManualSources } from './manualReturnSources';
import { equalValues } from './protocol';
import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { snapshotBelongsToOwner } from './snapshotIdentity';
import { submittedWorkCheckpoint } from './submittedWork';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';

/** Eligibility for a live clean editor; reconstruction and ACK projection retain their existing owners. */
export function liveSubmittedWork(owner: string, editorId: string, current: SessionCheckpoint,
  requests: readonly CommitRequest[], manualSources?: ReadonlyMap<string, string>): { checkpoint: SessionCheckpoint; acknowledged: CommitRequest[] } | null {
  if (current.dirty || Object.keys(current.pending).length || current.conflicts.length || current.remoteCandidate
    || !equalValues(current.draft, current.confirmed.value)) return null;
  const resource = current.confirmed.resource;
  const submitted = submittedWorkCheckpoint(owner, resource, requests);
  if (!submitted) return null;
  const ids = new Set(Object.keys(submitted.pending));
  const chain = requests.filter(request => ids.has(request.id));
  if (chain.some(request => request.atomic || request.retentionScope || request.baseline.value === null || request.value === null
    || (request.command && request.command.kind !== 'update') || !['queued', 'prepared', 'acknowledged'].includes(request.state)
    || (request.state !== 'acknowledged' && !areDifferentTabEditors(request.editorId, editorId, resource) && !manualSources?.has(request.id)))) return null;
  const acknowledged = chain.filter(request => request.state === 'acknowledged');
  if (acknowledged.some(request => request.result?.kind !== 'acknowledged'
    || !equalValues(request.result.snapshot.resource, resource) || !snapshotBelongsToOwner(owner, request.result.snapshot))) return null;
  const observedAncestor = chain.some(request => equalValues(current.confirmed, request.baseline)
    || (request.initialized && equalValues(current.confirmed, request.working))
    || (request.result?.kind === 'acknowledged' && equalValues(current.confirmed, request.result.snapshot)));
  if (!observedAncestor) return null;
  const session = DataSession.restore(submitted);
  for (const request of chain) session.applyCommit(request);
  const checkpoint = session.checkpoint();
  if (!canReplaceSnapshot(current.confirmed, checkpoint.confirmed)) return null;
  // A persistent editor identity never starts its local generation over when borrowing a chain.
  checkpoint.editGeneration += current.editGeneration;
  for (const pending of Object.values(checkpoint.pending)) pending.generation += current.editGeneration;
  markBorrowedManualSources(checkpoint, manualSources);
  return { checkpoint, acknowledged };
}
