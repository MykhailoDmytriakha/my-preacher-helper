import { awaitAcceptance, type WriteSubmission } from './recoverableWrite';

/** Engine promises prove durable local submission; delivery is shown by DataSyncStatus. */
export type SettingsWrite = Promise<void> | WriteSubmission;

export async function awaitSettingsWrite(write: SettingsWrite, onLateFailure: (error: unknown) => void): Promise<void> {
  if ('acceptance' in write) await awaitAcceptance(write, onLateFailure);
  else await write;
}
