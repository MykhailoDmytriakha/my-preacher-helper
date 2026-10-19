'use client';

import { isRecoverableCheckpoint, validateRecoveryRecord } from './recovery.client';
import { checkpointCommitReferences, collectCommitRows, commitProjectionKey } from './retention.client';
import { validateCommitReferences, type StorageRead } from './storage.client';

import type { EditorRecord } from './controller';

export const checkpointKey = (owner: string, editorId: string): IDBValidKey => ['checkpoint', owner, editorId];

/** Reuse the same validation and retention rules inside an existing native transaction. */
export function writeCheckpointRecord(store: IDBObjectStore, read: StorageRead, record: EditorRecord,
  creating: boolean, done: () => void): void {
  const frozen = validateRecoveryRecord(record, record.owner, record.editorId);
  read(store.get(checkpointKey(record.owner, record.editorId)), current => {
    if (creating && current !== undefined) throw new Error('Recovery target already exists');
    validateCommitReferences(store, read, record.owner, checkpointCommitReferences(frozen), () => {
      if (isRecoverableCheckpoint(frozen)) store.put(frozen, checkpointKey(record.owner, record.editorId));
      else store.delete(checkpointKey(record.owner, record.editorId));
      for (const id of frozen.completedCommits ?? []) store.delete(commitProjectionKey(record.owner, id));
      collectCommitRows(store, read, record.owner, done);
    });
  });
}
