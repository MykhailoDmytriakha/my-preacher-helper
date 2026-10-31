import { pendingCommitRetirement } from './commitJournal';
import { equalValues } from './protocol';

import type { CommitRequest } from './commits';
import type { DocumentData, ResourceRef } from './types';

/** Immutable ownership proof for a captured replacement of one refused creation chain. */
export interface CaptureTransferProof {
  source: ResourceRef;
  requestIds: string[];
  value: DocumentData;
}

export interface CaptureTransferResult {
  request: CommitRequest;
  retired: CommitRequest[];
}

const sameResource = (a: ResourceRef, b: ResourceRef): boolean => a.collection === b.collection && a.id === b.id;
function changed(): never { throw Object.assign(new Error('The captured creation changed before transfer'), { code: 'capture-transfer-changed' }); }

/**
 * The domain planner proves the replacement value first. This transaction rule owns
 * only exact source identity, an unambiguous refused chain and its durable retirement.
 * A version choice is deliberately not used as a technical transfer.
 */
export function planCaptureTransfer(target: CommitRequest, expected: readonly CommitRequest[], stored: readonly CommitRequest[]): CommitRequest[] {
  const proof = target.transferredFrom;
  if (!proof) return changed();
  if (!target.retentionScope || !proof.requestIds.length || !target.value
    || sameResource(proof.source, target.baseline.resource)
    || proof.source.collection !== 'studyNotes' || target.baseline.resource.collection !== 'studyNotes'
    || target.value.userId !== target.owner || proof.value.userId !== target.owner
    || expected.length !== proof.requestIds.length || new Set(proof.requestIds).size !== proof.requestIds.length) changed();
  const expectedById = new Map(expected.map(request => [request.id, request]));
  const selected = proof.requestIds.map(id => {
    const prior = expectedById.get(id), current = stored.find(request => request.id === id);
    if (!prior || !current || current.owner !== target.owner || current.atomic
      || !sameResource(current.baseline.resource, proof.source)
      || prior.revision !== current.revision || !equalValues(prior, current)) changed();
    return current;
  });
  const sourceIds = new Set(proof.requestIds);
  if (target.predecessor && sourceIds.has(target.predecessor)) changed();
  // A later unselected capture, an independent branch or unknown delivery is never consumed.
  if (stored.some(request => request.owner === target.owner && sameResource(request.baseline.resource, proof.source)
    && !sourceIds.has(request.id) && !['acknowledged', 'cancelled'].includes(request.state))) changed();
  const root = selected[0];
  if (!root) return changed();
  if (root.predecessor !== null || root.baseline.value !== null || root.baseline.metadata !== null
    || root.state !== 'refused' || root.command?.kind !== 'create'
    || root.result?.kind !== 'refused' || root.result.code !== 'analysis-exists') changed();
  for (let index = 1; index < selected.length; index += 1) {
    const request = selected[index], predecessor = selected[index - 1];
    if (!request || !predecessor) return changed();
    if (request.predecessor !== predecessor.id || request.state !== 'queued' || request.command !== null) changed();
  }
  if (!equalValues(selected.at(-1)!.value, proof.value)) changed();
  return selected.map(request => ({ ...request, state: 'cancelled', cancelledByAction: true,
    transferredTo: { requestId: target.id, resource: { ...target.baseline.resource } },
    unfinalized: pendingCommitRetirement(request), revision: request.revision + 1 }));
}

/** A retained replacement is the idempotent proof after its source rows were collected. */
export function isCapturedTransferReplay(existing: CommitRequest, incoming: CommitRequest): boolean {
  return Boolean(existing.transferredFrom && incoming.transferredFrom
    && existing.owner === incoming.owner && existing.editorId === incoming.editorId
    && existing.editGeneration === incoming.editGeneration && existing.retentionScope === incoming.retentionScope
    && equalValues(existing.transferredFrom, incoming.transferredFrom)
    && equalValues(existing.baseline, incoming.baseline) && equalValues(existing.value, incoming.value));
}
