import { atomicParticipants, isLiveWholeAction } from './atomicCommits';
import { isDocumentDeletion } from './deletionOrdering';
import { areDifferentTabEditors, areDifferentTabManualParents } from './editorIdentity';
import { markBorrowedManualSources } from './manualReturnSources';
import { ordinaryConflictChoice } from './ordinaryConflictChoice';
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
    && next.length > 0 && next.every(request => isLiveWholeAction(request) || isDocumentDeletion(request));
}

function documentAnswer(request: CommitRequest | undefined, editorId: string): CommitRequest['result'] {
  if (!request || request.atomic || request.retentionScope || request.baseline.value === null) return null;
  if (!isDocumentDeletion(request) && (request.value === null || (request.command && request.command.kind !== 'update')
    || !areDifferentTabEditors(request.editorId, editorId, request.baseline.resource))) return null;
  const result = request.result;
  if (result?.operationId !== request.id || result.kind !== request.state) return null;
  if (result.kind === 'refused') return result;
  return result.kind === 'conflict' && equalValues(result.snapshot.resource, request.baseline.resource)
    && snapshotBelongsToOwner(request.owner, result.snapshot) ? result : null;
}

function readLiveChainProof(chain: readonly CommitRequest[], requests: readonly CommitRequest[],
  current: SessionCheckpoint, editorId: string, manualSources?: ReadonlyMap<string, string>): CommitRequest[] | null {
  const resource = current.confirmed.resource;
  const atomicIds = new Set<string>();
  const tip = chain.at(-1);
  for (const request of chain) {
    if (request.retentionScope || request.baseline.value === null
      || (!['queued', 'prepared', 'acknowledged'].includes(request.state)
        && (request !== tip || !documentAnswer(request, editorId)))) return null;
    if (isDocumentDeletion(request)) {
      if (!areDifferentTabManualParents(request.editorId, editorId, resource)) return null;
    } else if (request.value === null) return null;
    else if (request.atomic) {
      const participants = liveActionParticipants(request, requests);
      if (!participants) return null;
      for (const participant of participants) atomicIds.add(participant.id);
    } else if ((request.command && request.command.kind !== 'update')
      || (request.state !== 'acknowledged' && !current.pending[request.id]
        && !areDifferentTabEditors(request.editorId, editorId, resource) && !manualSources?.has(request.id))) return null;
  }
  return requests.filter(request => atomicIds.has(request.id));
}

/** Show the answered save alone. Its unsent suffix remains durable until the exact choice. */
function answeredOrdinaryPrefix(chain: CommitRequest[], requests: readonly CommitRequest[]): CommitRequest[] {
  const index = chain.findIndex(request => request.state === 'conflict');
  if (index < 0 || index === chain.length - 1 || !ordinaryConflictChoice(chain[index], requests)) return chain;
  return chain.slice(0, index + 1);
}

export function sameLiveAtomicProof(proof: readonly CommitRequest[], requests: readonly CommitRequest[]): boolean {
  return proof.every(participant => equalValues(participant, requests.find(request => request.id === participant.id)));
}

/** Eligibility for a live clean editor; reconstruction and ACK projection retain their existing owners. */
export function liveSubmittedWork(owner: string, editorId: string, current: SessionCheckpoint,
  requests: readonly CommitRequest[], manualSources?: ReadonlyMap<string, string>): { checkpoint: SessionCheckpoint; acknowledged: CommitRequest[]; atomicProof: CommitRequest[]; answer: CommitRequest['result'] } | null {
  if (current.conflicts.length || current.remoteCandidate) return null;
  const resource = current.confirmed.resource;
  const complete = submittedWorkCheckpoint(owner, resource, requests);
  if (!complete) return null;
  const all = requests.filter(request => complete.pending[request.id]);
  const chain = answeredOrdinaryPrefix(all, requests);
  const submitted = chain === all ? complete : submittedWorkCheckpoint(owner, resource, chain);
  if (!submitted) return null;
  if (!canFollowChain(current, chain)) return null;
  const atomicProof = readLiveChainProof(chain, requests, current, editorId, manualSources);
  if (!atomicProof) return null;
  const acknowledged = chain.filter(request => request.state === 'acknowledged');
  if (acknowledged.some(request => request.result?.kind !== 'acknowledged'
    || !equalValues(request.result.snapshot.resource, resource) || !snapshotBelongsToOwner(owner, request.result.snapshot))) return null;
  const answer = documentAnswer(chain.at(-1), editorId);
  // The returning editor may already have seen the newer record from this exact conflict.
  const sawConflict = answer?.kind === 'conflict' && equalValues(current.confirmed, answer.snapshot);
  const observedAncestor = sawConflict || chain.some(request => equalValues(current.confirmed, request.baseline)
    || (request.initialized && equalValues(current.confirmed, request.working))
    || (request.result?.kind === 'acknowledged' && equalValues(current.confirmed, request.result.snapshot)));
  if (!observedAncestor) return null;
  const checkpoint = replaySubmitted(submitted, chain);
  if (sawConflict) {
    // A delete has no authored fields to rebase. An update still needs its original
    // confirmed ancestor so Keep mine can distinguish edits from untouched server fields.
    if (checkpoint.draft === null) checkpoint.confirmed = current.confirmed;
  } else if (!canReplaceSnapshot(current.confirmed, checkpoint.confirmed)) return null;
  // A persistent editor identity never starts its local generation over when borrowing a chain.
  checkpoint.editGeneration += current.editGeneration;
  for (const [id, pending] of Object.entries(checkpoint.pending)) {
    const previous = current.pending[id];
    pending.generation = previous?.generation ?? pending.generation + current.editGeneration;
    if (previous?.borrowedManualScope) pending.borrowedManualScope = previous.borrowedManualScope;
  }
  markBorrowedManualSources(checkpoint, manualSources);
  return { checkpoint, acknowledged, atomicProof, answer };
}
