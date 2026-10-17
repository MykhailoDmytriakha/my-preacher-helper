import type { CommitRequest } from './commits';
import type { DataEngineRuntime } from './runtime';

/** Persist the retirement owner before deleting its terminal delivery proof. */
export function pendingCommitRetirement(request: CommitRequest): string[] {
  return [...new Set([...request.unfinalized, ...(request.command ? [request.command.operationId] : [])])];
}

/** Retry only journal cleanup, never delivery of already decided work. */
export async function retireCommitJournal(requests: readonly CommitRequest[], runtime: DataEngineRuntime, assertCurrent: () => void): Promise<void> {
  const discarded = new Set(requests.flatMap(request => request.state === 'cancelled' && request.command ? [request.command.operationId] : []));
  const journal = await runtime.list();
  assertCurrent();
  // One relation may be acknowledged while rebasing its remaining fields still conflicts.
  const acknowledged = new Set(journal.filter(entry => entry.state === 'acknowledged').map(entry => entry.command.operationId));
  for (const id of new Set(requests.flatMap(request => request.unfinalized))) {
    if (discarded.has(id) && !acknowledged.has(id)) await runtime.discard(id);
    else await runtime.finalize(id);
    assertCurrent();
  }
}
