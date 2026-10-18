import { awaitWriteOperation, type WriteOperation } from './recoverableWrite';

/** Engine promises prove durable local submission; delivery is shown by DataSyncStatus. */
export type SettingsWrite = WriteOperation;

export async function awaitSettingsWrite(write: SettingsWrite, onLateFailure: (error: unknown) => void): Promise<void> {
  await awaitWriteOperation(write, onLateFailure);
}
