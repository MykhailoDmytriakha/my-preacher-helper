import { cancellationScope, canCancelSavedIntent } from './atomicCommits';

import type { CommitRequest } from './commits';
import type { JournalEntry } from './types';

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
