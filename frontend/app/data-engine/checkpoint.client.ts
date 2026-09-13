'use client';

import { isRecoverableCheckpoint, recoveryCheckpointId, selectRecoverableCheckpoints, validateRecoveryRecord } from './recovery.client';
import { checkpointCommitReferences, collectCommitRows, commitProjectionKey } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from './storage.client';

import type { CheckpointRecoveryStore, EditorRecord } from './controller';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (owner: string, editorId: string): IDBValidKey => ['checkpoint', owner, editorId];

/** Checkpoint projection and request reference release are one durable transaction. */
export function createIndexedDbCheckpoints(): CheckpointRecoveryStore {
  const transaction = createEngineStorageTransaction();
  const write = (record: EditorRecord, creating: boolean) => {
    const frozen = validateRecoveryRecord(record, record.owner, record.editorId);
    return transaction<void>('readwrite', (store, read, done) => {
      read(store.get(key(record.owner, record.editorId)), current => {
        if (creating && current !== undefined) throw new Error('Recovery target already exists');
        validateCommitReferences(store, read, record.owner, checkpointCommitReferences(frozen), () => {
          if (isRecoverableCheckpoint(frozen)) store.put(frozen, key(record.owner, record.editorId));
          else store.delete(key(record.owner, record.editorId));
          for (const id of frozen.completedCommits ?? []) store.delete(commitProjectionKey(record.owner, id));
          collectCommitRows(store, read, record.owner, () => done(undefined));
        });
      });
    });
  };
  return {
    listRecoverable: (owner, resource) => transaction('readonly', (store, read, done) => {
      read(store.getAll(engineOwnerRange('checkpoint', owner)), values => {
        const records = (values as EditorRecord[]).map(record => [recoveryCheckpointId(owner, record.editorId), record] as const);
        done(selectRecoverableCheckpoints(records, owner, resource));
      });
    }),
    create: record => write(record, true),
    read: (owner, editorId) => transaction('readonly', (store, read, done) => {
      read(store.get(key(owner, editorId)), (record: EditorRecord | undefined) => done(record === undefined ? undefined : clone(record)));
    }),
    put: record => write(record, false),
  };
}
