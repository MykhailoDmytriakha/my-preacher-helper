import { equalValues } from './fieldValues';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

type CommentOpening = { generation: string; revision: number; requestId?: string };
type MatchesOpening = (value: DocumentData | null) => boolean;

function belongsToOpening(request: CommitRequest, owner: string, resource: ResourceRef, generation: string): boolean {
  return request.owner === owner && equalValues(request.baseline.resource, resource)
    && request.baseline.metadata?.generation === generation && !['conflict', 'refused', 'cancelled'].includes(request.state);
}

function openingRevision(request: CommitRequest): number | undefined {
  return (request.commentKindAction ?? request.commentPlaceAction)?.observedRevision;
}

/** Follow the displayed comment through either kind of Save, without crossing a different opening. */
export function submittedCommentOpening(owner: string, checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[],
  matches: MatchesOpening): CommentOpening | undefined {
  const generation = checkpoint?.confirmed.metadata?.generation;
  if (!checkpoint || !generation) return undefined;
  const byId = new Map(requests.map(request => [request.id, request]));
  const visited = new Set<string>();
  let id = Object.keys(checkpoint.pending).at(-1);
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = byId.get(id);
    if (!request || !belongsToOpening(request, owner, checkpoint.confirmed.resource, generation) || !matches(request.value)) return undefined;
    const revision = openingRevision(request);
    if (revision !== undefined) {
      return { generation, revision, requestId: id };
    }
    id = request.predecessor ?? undefined;
  }
  return undefined;
}

export function matchesCommentOpeningRequest(request: CommitRequest | undefined, owner: string, resource: ResourceRef,
  seen: CommentOpening, matches: MatchesOpening): boolean {
  return Boolean(request && request.id === seen.requestId && belongsToOpening(request, owner, resource, seen.generation)
    && openingRevision(request) === seen.revision && matches(request.value));
}

/** The exact confirmed receipt can outlive its local request while the editor is open. */
export function confirmedCommentOpening(snapshot: ResourceSnapshot, seen: CommentOpening, matches: MatchesOpening): boolean {
  return Boolean(seen.requestId && snapshot.metadata?.operationId === seen.requestId && matches(snapshot.value));
}

/** A projected opening is usable only along the chain this Save actually follows. */
export function commentOpeningPredecessor(records: readonly CommitRequest[], predecessor: CommitRequest | undefined,
  requestId: string | undefined): CommitRequest | undefined {
  if (!predecessor || !requestId) return undefined;
  if (predecessor.id === requestId) return predecessor;
  const generation = predecessor.baseline.metadata?.generation;
  if (!generation) return undefined;
  const byId = new Map(records.map(request => [request.id, request]));
  let id = predecessor.predecessor;
  while (id) {
    const request = byId.get(id);
    if (!request || !belongsToOpening(request, predecessor.owner, predecessor.baseline.resource, generation)) return undefined;
    if (request.id === requestId) return request;
    byId.delete(id);
    id = request.predecessor;
  }
}
