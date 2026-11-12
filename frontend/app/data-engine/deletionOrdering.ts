import { commandReferenceResources, documentReferenceResources } from './documentReferences';
import { requiredDomainTargets } from './domainPolicy';
import { equalValues } from './fieldValues';
import { coversCommittedEffect } from './snapshotFreshness';

import type { CommitRequest } from './commits';
import type { EditorState } from './controller';
import type { SessionCheckpoint } from './session';
import type { ResourceRef } from './types';

const terminal = (request: CommitRequest) => ['acknowledged', 'conflict', 'refused', 'cancelled'].includes(request.state);
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

// These screens expose a first local creation and allow the user to delete it.
const standaloneCreationCollections = new Set([
  'occasionPlaces', 'prayerRequests', 'tags', 'planTemplates', 'groups', 'councils', 'series', 'sermons', 'studyNotes',
]);

export function isDocumentDeletion(request: CommitRequest): boolean {
  return !request.atomic && request.value === null
    && (request.baseline.value !== null || isRemovalAfterStandaloneCreation(request))
    && (!request.command || request.command.kind === 'delete');
}

/** The opening checkpoint of a first creation, with its exact saved request. */
export function pendingStandaloneCreation(checkpoint: SessionCheckpoint) {
  const { confirmed, pending } = checkpoint;
  if (!standaloneCreationCollections.has(confirmed.resource.collection) || confirmed.value !== null || confirmed.metadata !== null) return null;
  const entries = Object.entries(pending);
  if (entries.length !== 1) return null;
  const creation = entries[0];
  const [, pendingCreation] = creation;
  return pendingCreation.value !== null && !pendingCreation.borrowedManualScope ? creation : null;
}

export function hasForeignPendingSnapshot({ remoteCandidate, pending }: SessionCheckpoint): boolean {
  if (!remoteCandidate) return false;
  const operationId = remoteCandidate.metadata?.operationId;
  return !operationId || !(Object.hasOwn(pending, operationId)
    || Object.values(pending).some(intent => intent.operations?.includes(operationId)));
}

export function canRemovePendingCreation({ checkpoint, result, actionResolutionRequired, preparedOperationId }: EditorState): boolean {
  if (actionResolutionRequired || preparedOperationId || result?.kind === 'refused' || result?.kind === 'conflict'
    || checkpoint.conflicts.length || hasForeignPendingSnapshot(checkpoint)) return false;
  const creation = pendingStandaloneCreation(checkpoint);
  return Boolean(creation && equalValues(creation[1].value, checkpoint.draft));
}

/** Durable shape of a removal captured before the first creation was confirmed. */
export function isRemovalAfterStandaloneCreation(request: CommitRequest): boolean {
  const { baseline } = request;
  return standaloneCreationCollections.has(baseline.resource.collection) && request.predecessor !== null
    && request.value === null && !request.atomic && baseline.value === null && baseline.metadata === null;
}

/** Before initialization, require the original creation to prove the removal's lineage. */
export function followsStandaloneCreation(request: CommitRequest, predecessor: CommitRequest): boolean {
  return isRemovalAfterStandaloneCreation(request) && request.predecessor === predecessor.id && request.owner === predecessor.owner
    && sameResource(request.baseline.resource, predecessor.baseline.resource) && predecessor.predecessor === null && !predecessor.atomic
    && predecessor.baseline.value === null && predecessor.baseline.metadata === null && predecessor.value !== null
    && (!predecessor.command || predecessor.command.kind === 'create');
}

/** First saves that are already followed by a durable, unresolved Delete. */
export function creationsAwaitingRemoval(requests: readonly CommitRequest[]): ReadonlySet<string> {
  const byId = new Map(requests.map(request => [request.id, request]));
  const creations = new Set<string>();
  for (const request of requests) {
    if (request.state !== 'queued' && request.state !== 'prepared') continue;
    const creation = request.predecessor && byId.get(request.predecessor);
    if (!creation || !followsStandaloneCreation(request, creation)) continue;
    if (creation.state === 'queued' || creation.state === 'prepared'
      || (creation.state === 'acknowledged' && provesStandaloneCreation(creation))) creations.add(creation.id);
  }
  return creations;
}

/** A replay can carry a newer snapshot of the same document, with the exact create in its receipt. */
export function provesStandaloneCreation(request: CommitRequest): boolean {
  const answer = request.result;
  if (answer?.kind !== 'acknowledged') return false;
  const proof = answer.committed ?? answer.snapshot.metadata;
  return Boolean(proof && proof.generation === request.id && proof.operationId === request.id
    && proof.revision === 1 && !proof.deleted && coversCommittedEffect(answer.snapshot, request.baseline.resource, proof));
}

/** Called inside capture storage: every observed request was saved before this deletion. */
export function captureDeleteOrder(request: CommitRequest, records: readonly CommitRequest[]): CommitRequest {
  if (request.value !== null || request.deleteAfter !== undefined) return request;
  const target = request.baseline.resource;
  const deleteAfter = records.filter(prior => {
    if (prior.owner !== request.owner || prior.id === request.id || terminal(prior)) return false;
    if (sameResource(prior.baseline.resource, target)) return true;
    const references = [
      ...documentReferenceResources(prior.baseline.resource, prior.baseline.value, prior.value),
      ...capturedDomainTargets(prior),
      ...(prior.command ? commandReferenceResources(prior.command) : []),
    ];
    return references.some(resource => sameResource(resource, target));
  }).map(prior => prior.id);
  return { ...request, deleteAfter };
}

/** A missing prerequisite is not proof of completion; capture retention keeps its payload. */
export function deleteOrderReady(request: CommitRequest, records: readonly CommitRequest[]): boolean {
  return (request.deleteAfter ?? []).every(id => {
    const prior = records.find(candidate => candidate.owner === request.owner && candidate.id === id);
    return prior !== undefined && terminal(prior);
  });
}

/** Keep the same immutable frontier when the caller repeats its original capture input. */
export function replayDeleteOrder(request: CommitRequest, existing: CommitRequest): CommitRequest {
  return request.deleteAfter === undefined && existing.deleteAfter !== undefined
    ? { ...request, deleteAfter: [...existing.deleteAfter] } : request;
}

/** An inadmissible saved draft cannot establish an external command prerequisite. */
function capturedDomainTargets(request: CommitRequest): ResourceRef[] {
  try { return requiredDomainTargets(request.baseline, request.value); }
  catch (error) {
    if ((error as { code?: unknown }).code === 'invalid-argument') return [];
    throw error;
  }
}
