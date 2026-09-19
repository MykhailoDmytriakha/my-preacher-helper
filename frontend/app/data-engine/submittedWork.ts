import { equalValues } from './protocol';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { ResourceRef } from './types';

/**
 * A new editor may continue one unambiguous submitted chain. This is local intent,
 * never a confirmed cache entry. Unsubmitted source checkpoints are not consulted.
 * Competing branches remain separate recovery choices instead of a guessed winner.
 */
export function submittedWorkCheckpoint(owner: string, resource: ResourceRef, requests: readonly CommitRequest[]): SessionCheckpoint | null {
  const related = requests.filter(request => request.owner === owner && equalValues(request.baseline.resource, resource));
  const unfinished = related.filter(request => !['acknowledged', 'cancelled'].includes(request.state));
  if (!unfinished.length) return null;
  const predecessors = new Set(unfinished.map(request => request.predecessor));
  const tips = unfinished.filter(request => !predecessors.has(request.id));
  if (tips.length !== 1) return null;
  const byId = new Map(related.map(request => [request.id, request]));
  const chain: CommitRequest[] = [];
  let current: CommitRequest | undefined = tips[0];
  while (current) {
    if (chain.some(request => request.id === current!.id)) throw new Error('Invalid submitted-work dependency cycle');
    if (current.state === 'cancelled') return null;
    chain.unshift(current);
    const predecessor: CommitRequest | undefined = current.predecessor ? byId.get(current.predecessor) : undefined;
    if (current.predecessor && !predecessor && !current.initialized) return null;
    current = predecessor;
  }
  if (unfinished.some(request => !chain.some(member => member.id === request.id))) return null;
  const first = chain[0], last = chain[chain.length - 1];
  // A compacted ancestor is already represented by the initialized working copy.
  const confirmed = first.initialized ? first.working : first.baseline;
  const draft = chain.length === 1 && last.initialized ? last.intended : last.value;
  return JSON.parse(JSON.stringify({ confirmed, draft, dirty: !equalValues(confirmed.value, draft),
    editGeneration: chain.length, remoteCandidate: null, conflicts: [],
    pending: Object.fromEntries(chain.map((request, index) => [request.id, {
      generation: index + 1, value: request.value,
      ...(request.command && request.command.operationId !== request.id ? { operations: [request.command.operationId] } : {}),
    }])),
  }));
}
