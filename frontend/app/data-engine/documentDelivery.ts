import { cancellationScope, canCancelSavedIntent } from './atomicCommits';

import type { CommitRequest } from './commits';
import type { JournalEntry, ResourceRef } from './types';

/** Only an explicitly prepared, solely held command has the older direct-command ownership. */
export function isDirectLegacyDocumentIntent(pendingIds: readonly string[], preparedOperationId: string | undefined): boolean {
  return pendingIds.length === 1 && pendingIds[0] === preparedOperationId;
}

/** A field choice must satisfy the same complete-scope proof as the deciding queue. */
export function canReplaceDocumentIntent(owner: string, editorId: string, pendingIds: readonly string[],
  requests: readonly CommitRequest[], journal: readonly JournalEntry[]): boolean {
  const owned = requests.filter(request => request.owner === owner);
  if (!pendingIds.length || pendingIds.some(id => !owned.some(request => request.id === id))) return false;
  // Incomplete atomic ownership cannot prove that a document may decide the whole action.
  let scope: CommitRequest[];
  try { scope = cancellationScope(owned, editorId, pendingIds); } catch { return false; }
  return !scope.some(request => request.atomic) && canCancelSavedIntent(scope, journal.filter(entry => entry.command.owner === owner));
}

/** A checkpoint may not offer a document choice when its proved cancellation scope is a whole action. */
export function requiresWholeActionResolution(owner: string, editorId: string, pendingIds: readonly string[],
  requests: readonly CommitRequest[]): boolean {
  const owned = requests.filter(request => request.owner === owner);
  try { return cancellationScope(owned, editorId, pendingIds).some(request => Boolean(request.atomic)); }
  catch { return true; }
}

export type DocumentAnswer = 'conflict' | 'refused';

/** A request may be answered even when its last relation command was acknowledged. */
export function savedDocumentAnswer(owner: string, resource: ResourceRef, pendingIds: readonly string[],
  requests: readonly CommitRequest[], journal: readonly JournalEntry[]): DocumentAnswer | null {
  const sameResource = (candidate: ResourceRef) => candidate.collection === resource.collection && candidate.id === resource.id;
  let conflict = false;
  for (const id of pendingIds) {
    const request = requests.find(candidate => candidate.owner === owner && candidate.id === id);
    // A known modern request owns its answer; a leftover command cannot replace it.
    if (request) {
      if (!sameResource(request.baseline.resource)) continue;
      if (request.state === 'refused') return 'refused';
      conflict ||= request.state === 'conflict';
      continue;
    }
    // Checkpoints from the direct-command era have no CommitRequest.
    const entry = journal.find(candidate => candidate.command.owner === owner && candidate.command.operationId === id
      && sameResource(candidate.command.resource));
    if (entry?.state === 'refused') return 'refused';
    conflict ||= entry?.state === 'conflict';
  }
  return conflict ? 'conflict' : null;
}
