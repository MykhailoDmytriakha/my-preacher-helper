import { atomicParticipants, isLiveWholeAction } from './atomicCommits';
import { areDifferentTabEditors } from './editorIdentity';
import { markBorrowedManualSources } from './manualReturnSources';
import { equalValues } from './protocol';
import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { snapshotBelongsToOwner } from './snapshotIdentity';
import { submittedWorkCheckpoint } from './submittedWork';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';

/** A transfer or reshape is one saved intent, including participants that it creates. */
function liveActionParticipants(request: CommitRequest, requests: readonly CommitRequest[]): CommitRequest[] | null {
  const kind = request.atomic?.kind;
  if (kind !== 'council-carry' && kind !== 'analysis-reshape') return null;
  let participants: CommitRequest[];
  try { participants = atomicParticipants(request, requests); } catch { return null; }
  const council = kind === 'council-carry';
  const collection = council ? 'councils' : 'studyNotes';
  const states = request.state === 'acknowledged' ? ['acknowledged'] : ['queued', 'prepared'];
  if (participants.length > (council ? 2 : 3) || participants[0].baseline.value === null
    || new Set(participants.map(participant => participant.baseline.resource.id)).size !== participants.length
    || participants.some(participant => !states.includes(participant.state) || participant.retentionScope
      || participant.baseline.resource.collection !== collection || participant.baseline.metadata?.deleted
      || (participant.baseline.value === null && participant.baseline.metadata !== null)
      || !participant.value || participant.value.userId !== request.owner
      || (!council && (participant.value.type !== 'analysis'
        || (participant.baseline.value && participant.baseline.value.type !== 'analysis')))
      || !snapshotBelongsToOwner(request.owner, participant.baseline)
      || (participant.command && (participant.command.kind !== 'relation' || participant.command.relation !== kind)))) return null;
  return participants;
}

function replaySubmitted(checkpoint: SessionCheckpoint, chain: readonly CommitRequest[]): SessionCheckpoint {
  const session = DataSession.restore(checkpoint);
  for (const request of chain) session.applyCommit(request);
  return session.checkpoint();
}

function matchesShownPrefix(current: SessionCheckpoint, chain: readonly CommitRequest[], lastId: string): boolean {
  const last = chain.findIndex(request => request.id === lastId);
  if (last < 0) return false;
  const prefix = chain.slice(0, last + 1);
  const submitted = submittedWorkCheckpoint(chain[last].owner, current.confirmed.resource, prefix);
  // An earlier ACK can update the displayed fields and bookkeeping while the next capture
  // still stores its original words. Reconstruct that exact displayed ancestry before comparing.
  return Boolean(submitted && equalValues(current.draft, replaySubmitted(submitted, prefix).draft));
}

/** A mounted participant can follow the next whole action if its visible copy is still exactly
 * the previous saved action. A competing chain or newer private words stay in their own editor. */
function canFollowChain(current: SessionCheckpoint, chain: readonly CommitRequest[]): boolean {
  const pending = Object.entries(current.pending);
  if (!pending.length) return !current.dirty && equalValues(current.draft, current.confirmed.value);
  const known = chain.filter(request => current.pending[request.id]);
  const latest = pending.reduce((previous, next) => next[1].generation > previous[1].generation ? next : previous);
  const next = chain.filter(request => request.state !== 'acknowledged' && !current.pending[request.id]);
  return known.length === pending.length
    && known.every(request => equalValues(request.value, current.pending[request.id].value))
    && (equalValues(current.draft, latest[1].value) || matchesShownPrefix(current, chain, latest[0]))
    && next.length > 0 && next.every(isLiveWholeAction);
}

function readLiveChainProof(chain: readonly CommitRequest[], requests: readonly CommitRequest[],
  current: SessionCheckpoint, editorId: string, manualSources?: ReadonlyMap<string, string>): CommitRequest[] | null {
  const resource = current.confirmed.resource;
  const atomicIds = new Set<string>();
  for (const request of chain) {
    if (request.retentionScope || request.baseline.value === null || request.value === null
      || !['queued', 'prepared', 'acknowledged'].includes(request.state)) return null;
    if (request.atomic) {
      const participants = liveActionParticipants(request, requests);
      if (!participants) return null;
      for (const participant of participants) atomicIds.add(participant.id);
    } else if ((request.command && request.command.kind !== 'update')
      || (request.state !== 'acknowledged' && !current.pending[request.id]
        && !areDifferentTabEditors(request.editorId, editorId, resource) && !manualSources?.has(request.id))) return null;
  }
  return requests.filter(request => atomicIds.has(request.id));
}

export function sameLiveAtomicProof(proof: readonly CommitRequest[], requests: readonly CommitRequest[]): boolean {
  return proof.every(participant => equalValues(participant, requests.find(request => request.id === participant.id)));
}

/** Eligibility for a live clean editor; reconstruction and ACK projection retain their existing owners. */
export function liveSubmittedWork(owner: string, editorId: string, current: SessionCheckpoint,
  requests: readonly CommitRequest[], manualSources?: ReadonlyMap<string, string>): { checkpoint: SessionCheckpoint; acknowledged: CommitRequest[]; atomicProof: CommitRequest[] } | null {
  if (current.conflicts.length || current.remoteCandidate) return null;
  const resource = current.confirmed.resource;
  const submitted = submittedWorkCheckpoint(owner, resource, requests);
  if (!submitted) return null;
  const ids = new Set(Object.keys(submitted.pending));
  const chain = requests.filter(request => ids.has(request.id));
  if (!canFollowChain(current, chain)) return null;
  const atomicProof = readLiveChainProof(chain, requests, current, editorId, manualSources);
  if (!atomicProof) return null;
  const acknowledged = chain.filter(request => request.state === 'acknowledged');
  if (acknowledged.some(request => request.result?.kind !== 'acknowledged'
    || !equalValues(request.result.snapshot.resource, resource) || !snapshotBelongsToOwner(owner, request.result.snapshot))) return null;
  const observedAncestor = chain.some(request => equalValues(current.confirmed, request.baseline)
    || (request.initialized && equalValues(current.confirmed, request.working))
    || (request.result?.kind === 'acknowledged' && equalValues(current.confirmed, request.result.snapshot)));
  if (!observedAncestor) return null;
  const checkpoint = replaySubmitted(submitted, chain);
  if (!canReplaceSnapshot(current.confirmed, checkpoint.confirmed)) return null;
  // A persistent editor identity never starts its local generation over when borrowing a chain.
  checkpoint.editGeneration += current.editGeneration;
  for (const [id, pending] of Object.entries(checkpoint.pending)) {
    const previous = current.pending[id];
    pending.generation = previous?.generation ?? pending.generation + current.editGeneration;
    if (previous?.borrowedManualScope) pending.borrowedManualScope = previous.borrowedManualScope;
  }
  markBorrowedManualSources(checkpoint, manualSources);
  return { checkpoint, acknowledged, atomicProof };
}
