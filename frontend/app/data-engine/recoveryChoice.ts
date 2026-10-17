import type { EditorRecord } from './controller';

/** The saved copies shown for a choice; asynchronous discovery cannot add another root. */
export interface RecoveryChoiceScope {
  readonly records: readonly EditorRecord[];
  readonly operationIds: readonly string[];
  readonly fingerprint: string;
}

/** One comparison for the notice and the final legacy-editor choice. */
export function recoveryChoiceFingerprint(records: readonly EditorRecord[]): string {
  return JSON.stringify(records.map(({ owner, editorId, checkpoint, prepared, unfinalized, completedCommits }) => ({
    owner,
    editorId,
    confirmed: { resource: checkpoint.confirmed.resource, value: checkpoint.confirmed.value, metadata: checkpoint.confirmed.metadata },
    draft: checkpoint.draft,
    remoteCandidate: checkpoint.remoteCandidate,
    pending: Object.fromEntries(Object.entries(checkpoint.pending).sort(([a], [b]) => a.localeCompare(b))),
    preparedOperationId: prepared?.operationId ?? null,
    unfinalized: [...unfinalized].sort(),
    completedCommits: [...(completedCommits ?? [])].sort(),
  })).sort((a, b) => a.editorId.localeCompare(b.editorId)));
}

export function captureRecoveryChoice(source: readonly EditorRecord[]): RecoveryChoiceScope {
  const records = JSON.parse(JSON.stringify(source)) as EditorRecord[];
  const operationIds = [...new Set(records.flatMap(({ checkpoint, prepared, unfinalized, completedCommits }) => [
    ...Object.keys(checkpoint.pending), prepared?.operationId, ...unfinalized, ...(completedCommits ?? []),
  ].filter((id): id is string => Boolean(id))))].sort();
  return { records, operationIds, fingerprint: recoveryChoiceFingerprint(records) };
}
