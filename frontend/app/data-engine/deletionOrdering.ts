import { deletionConflicts } from './deletionContent';
import { commandReferenceResources, documentReferenceResources } from './documentReferences';
import { requiredDomainTargets } from './domainPolicy';
import { equalValues } from './fieldValues';
import { coversCommittedEffect } from './snapshotFreshness';

import type { CommitRequest } from './commits';
import type { EditorState } from './controller';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

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

export interface PendingRemovalOpening {
  ids: string[];
  shown: DocumentData;
}

/** Only a saved value on screen can supply the opening for a queued Delete. */
export function pendingRemovalOpening(state: EditorState): PendingRemovalOpening | null {
  const { checkpoint, result, actionResolutionRequired, pendingMembershipCreation, preparedOperationId } = state;
  const { confirmed, draft, pending } = checkpoint;
  if (!draft || !standaloneCreationCollections.has(confirmed.resource.collection) || confirmed.metadata?.deleted
    || (actionResolutionRequired && !pendingMembershipCreation) || preparedOperationId || result?.kind === 'refused' || result?.kind === 'conflict'
    || checkpoint.conflicts.length || hasForeignPendingSnapshot(checkpoint)) return null;
  const entries = Object.entries(pending);
  if (!entries.length || entries.some(([, item]) => !item.value || item.borrowedManualScope)) return null;
  const latest = Math.max(...entries.map(([, item]) => item.generation));
  return latest === checkpoint.editGeneration && entries.some(([, item]) => item.generation === latest && equalValues(item.value, draft))
    ? { ids: entries.map(([id]) => id), shown: draft } : null;
}

function isMembershipCreation(request: CommitRequest): boolean {
  const { atomic, baseline } = request;
  return atomic?.kind === 'create-member' && atomic.id === request.id && atomic.participants.length === 2
    && atomic.participants[0] === request.id && atomic.participants[1] !== request.id
    && ['groups', 'sermons'].includes(baseline.resource.collection) && !request.predecessor
    && baseline.value === null && baseline.metadata === null;
}

function membershipCreationPeer(request: CommitRequest, byId: ReadonlyMap<string, CommitRequest>): CommitRequest | undefined {
  if (!isMembershipCreation(request)) return undefined;
  const peer = byId.get(request.atomic!.participants[1]);
  return peer && peer.owner === request.owner && peer.baseline.resource.collection === 'series'
    && peer.baseline.value !== null && peer.value !== null && equalValues(peer.atomic, request.atomic) ? peer : undefined;
}

function exactMembershipAnswer(primary: CommitRequest, peer: CommitRequest): boolean {
  const answer = peer.result;
  if (answer?.kind !== 'acknowledged' || !answer.committed) return false;
  const proof = answer.committed;
  // The atomic ACK owns the rebased peer. An earlier Save can have versioned a
  // legacy series between capture and the atomic creation.
  const generation = peer.baseline.metadata?.generation
    ?? (peer.predecessor ? peer.working.metadata?.generation : primary.id);
  return proof.operationId === primary.id && proof.generation === generation
    && !proof.deleted && coversCommittedEffect(answer.snapshot, peer.baseline.resource, proof);
}

const changedRemoval = () => Object.assign(new Error('The saved work shown before Delete changed'), { code: 'decision-changed' });

/** Freeze the observed chain and, for an absent baseline, its exact creation. */
export function captureRemovalLineage(opening: PendingRemovalOpening, baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, records: readonly CommitRequest[]): string[] {
  if (!predecessor || !equalValues(opening.shown, predecessor.value)) throw changedRemoval();
  const remaining = new Set(opening.ids);
  const byId = new Map(records.map(request => [request.id, request]));
  const lineage = new Set<string>();
  let cursor: CommitRequest | undefined = predecessor;
  while (cursor) {
    if (lineage.has(cursor.id) || cursor.owner !== predecessor.owner || !sameResource(cursor.baseline.resource, baseline.resource)
      || (cursor.atomic && !membershipCreationPeer(cursor, byId)) || cursor.value === null || ['conflict', 'refused', 'cancelled'].includes(cursor.state)) throw changedRemoval();
    lineage.add(cursor.id);
    remaining.delete(cursor.id);
    if (!remaining.size && (baseline.value !== null || !cursor.predecessor)) break;
    cursor = cursor.predecessor ? byId.get(cursor.predecessor) : undefined;
  }
  if (remaining.size || !cursor || (baseline.value === null && (cursor.baseline.value !== null || cursor.baseline.metadata !== null))) {
    throw changedRemoval();
  }
  return [...lineage].reverse();
}

function exactRemovalAnswer(request: CommitRequest): boolean {
  const answer = request.result;
  if (answer?.kind !== 'acknowledged' || !sameResource(answer.snapshot.resource, request.baseline.resource)) return false;
  if (!request.sequence) return !answer.committed && equalValues(answer.snapshot, request.working)
    && equalValues(request.working.value, request.intended);
  const operationId = request.sequence === 1 ? request.id : `${request.id}-${request.sequence - 1}`;
  const proof = answer.committed ?? answer.snapshot.metadata;
  return Boolean(proof && proof.operationId === operationId && coversCommittedEffect(answer.snapshot, request.baseline.resource, proof));
}

function readRemovalLineage(request: CommitRequest, byId: ReadonlyMap<string, CommitRequest>): CommitRequest[] | null {
  const ids = request.removalLineage;
  if (!ids?.length || ids.at(-1) !== request.predecessor || new Set(ids).size !== ids.length) return null;
  const chain: CommitRequest[] = [];
  for (const [index, id] of ids.entries()) {
    const record = byId.get(id);
    if (!record || record.owner !== request.owner || !sameResource(record.baseline.resource, request.baseline.resource)
      || (record.atomic && (index !== 0 || !membershipCreationPeer(record, byId))) || record.value === null || (index > 0 && record.predecessor !== ids[index - 1])) return null;
    chain.push(record);
  }
  return chain;
}

/** Continue only after the exact writes shown at Delete have succeeded. */
export function initializePendingRemoval(request: CommitRequest, records: readonly CommitRequest[]): CommitRequest | null {
  const rejected: CommitRequest = { ...request, initialized: true, state: 'refused',
    result: { kind: 'refused', operationId: request.id, code: 'decision-changed' } };
  const byId = new Map(records.map(record => [record.id, record]));
  const chain = readRemovalLineage(request, byId);
  if (!chain) return rejected;
  const first = chain[0], last = chain.at(-1)!;
  const peer = membershipCreationPeer(first, byId);
  const prerequisites = peer ? [...chain, peer] : chain;
  if (prerequisites.some(record => ['conflict', 'refused', 'cancelled'].includes(record.state))) return rejected;
  if (prerequisites.some(record => !terminal(record))) return null;
  if (chain.some(record => !exactRemovalAnswer(record)) || (peer && !exactMembershipAnswer(first, peer))) return rejected;
  if (request.baseline.value === null && !provesStandaloneCreation(first)) return rejected;
  const accepted = chain.flatMap(record => record.result?.kind === 'acknowledged' ? [record.result] : []);
  const snapshot = accepted.at(-1)!.snapshot;
  // A write to a legacy record can be its first version. Its own receipt must
  // prove that the operation established the generation, even on replay.
  const firstProof = accepted.map(answer => answer.committed ?? answer.snapshot.metadata).find(Boolean);
  if (request.baseline.value !== null && !request.baseline.metadata && firstProof
    && (firstProof.revision !== 1 || firstProof.operationId !== firstProof.generation)) return rejected;
  const generation = request.baseline.metadata?.generation ?? (request.baseline.value === null ? first.id : firstProof?.generation ?? null);
  if (accepted.some(({ snapshot: copy }) => copy.metadata && copy.metadata.generation !== generation)
    || (snapshot.metadata?.generation ?? null) !== generation) return rejected;
  const conflicts = snapshot.value && deletionConflicts(request.baseline.resource.collection, last.value!, snapshot.value);
  if (conflicts?.length) return { ...request, initialized: true, state: 'conflict',
    result: { kind: 'conflict', operationId: request.id, snapshot, conflicts } };
  return { ...request, initialized: true, working: snapshot, intended: null };
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

/** The generation the list may hide while Delete still awaits its result. */
export function pendingRemovalGeneration(request: CommitRequest): string | null {
  return request.baseline.metadata?.generation ?? (request.baseline.value === null
    ? request.removalLineage?.[0] ?? request.predecessor : request.working.metadata?.generation ?? null);
}

/** First saves that are already followed by a durable, unresolved Delete. */
export function creationsAwaitingRemoval(requests: readonly CommitRequest[]): ReadonlySet<string> {
  const byId = new Map(requests.map(request => [request.id, request]));
  const creations = new Set<string>();
  for (const request of requests) {
    if (request.state !== 'queued' && request.state !== 'prepared') continue;
    if (request.removalLineage) {
      const chain = request.baseline.value === null && readRemovalLineage(request, byId);
      const peer = chain && membershipCreationPeer(chain[0], byId);
      const holds = (record: CommitRequest, exact: () => boolean) => record.state === 'queued' || record.state === 'prepared'
        || (record.state === 'acknowledged' && exact());
      if (chain && chain.every(record => holds(record, () => exactRemovalAnswer(record)))
        && (!peer || holds(peer, () => exactMembershipAnswer(chain[0], peer)))) {
        chain.forEach(record => creations.add(record.id));
      }
      continue;
    }
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
  const first = request.removalLineage && records.find(prior => prior.id === request.removalLineage?.[0]);
  const participants = first && isMembershipCreation(first) ? first.atomic!.participants : [];
  return { ...request, deleteAfter: [...new Set([...(request.removalLineage ?? []), ...participants, ...deleteAfter])] };
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
