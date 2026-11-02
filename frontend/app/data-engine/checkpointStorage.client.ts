'use client';

import { isRecoverableCheckpoint, recoveryCheckpointEditorId, validateRecoveryRecord } from './recovery.client';
import { recoveryOrigins } from './recoverySource';
import { retireRecoveryVersions, versionRecoveryRecord } from './recoverySource.client';
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
      const keeps = isRecoverableCheckpoint(frozen);
      if (keeps) store.put(versionRecoveryRecord(frozen), checkpointKey(record.owner, record.editorId));
      else store.delete(checkpointKey(record.owner, record.editorId));
      for (const id of frozen.completedCommits ?? []) store.delete(commitProjectionKey(record.owner, id));
      retireRecoveryVersions(store, read, keeps ? [] : recoveryOrigins(frozen.recoveryOrigins), id => {
        const editorId = recoveryCheckpointEditorId(frozen.owner, id);
        if (editorId === null || editorId === frozen.editorId) return null;
        return { key: checkpointKey(frozen.owner, editorId), owns: value => Boolean(validateRecoveryRecord(value,
          frozen.owner, editorId, frozen.checkpoint.confirmed.resource)) };
      }, () => collectCommitRows(store, read, record.owner, done));
    });
  });
}
