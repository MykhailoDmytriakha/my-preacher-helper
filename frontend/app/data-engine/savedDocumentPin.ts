import { equalValues } from './protocol';
import { DataSession } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { submittedWorkCheckpoint } from './submittedWork';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { ResourceSnapshot } from './types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const refuse = (): never => { throw Object.assign(new Error('resolve-version-first'), { code: 'resolve-version-first' }); };

/** A destination is based on confirmed content and one proven saved chain, never unsent typing. */
export function pinSavedDocument(owner: string, snapshot: ResourceSnapshot, requests: readonly CommitRequest[]): SessionCheckpoint {
  let baseline = copy(snapshot);
  const related = requests.filter(request => request.owner === owner && equalValues(request.baseline.resource, snapshot.resource));
  for (const request of related) if (request.result?.kind === 'acknowledged' && canReplaceSnapshot(baseline, request.result.snapshot)) baseline = copy(request.result.snapshot);
  const unfinished = related.filter(request => !['acknowledged', 'cancelled'].includes(request.state));
  if (unfinished.some(request => ['conflict', 'refused'].includes(request.state))) return refuse();
  const submitted = submittedWorkCheckpoint(owner, snapshot.resource, related);
  if (!submitted) {
    if (unfinished.length) return refuse();
    return new DataSession(baseline).checkpoint();
  }
  const session = DataSession.restore(submitted);
  for (const id of Object.keys(submitted.pending)) session.applyCommit(related.find(request => request.id === id)!);
  return session.checkpoint();
}

