import { commandReferenceResources, documentReferenceResources } from './documentReferences';
import { requiredDomainTargets } from './domainPolicy';

import type { CommitRequest } from './commits';
import type { ResourceRef } from './types';

const terminal = (request: CommitRequest) => ['acknowledged', 'conflict', 'refused', 'cancelled'].includes(request.state);
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

export function isDocumentDeletion(request: CommitRequest): boolean {
  return !request.atomic && request.baseline.value !== null && request.value === null
    && (!request.command || request.command.kind === 'delete');
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
