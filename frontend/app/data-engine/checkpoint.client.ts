'use client';

import { writeCheckpointRecord, checkpointKey } from './checkpointStorage.client';
import { recoveryCheckpointId, selectRecoverableCheckpoints, validateRecoveryRecord } from './recovery.client';
import { discardRecoveryRecord } from './recoveryDiscard.client';
import { pinRecoveryVersion } from './recoverySource.client';
import { checkpointCommitReferences, commitProjectionKey } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange } from './storage.client';

import type { CheckpointRecoveryStore, EditorRecord } from './controller';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Checkpoint projection and request reference release are one durable transaction. */
export function createIndexedDbCheckpoints(): CheckpointRecoveryStore {
  const transaction = createEngineStorageTransaction();
  const write = (record: EditorRecord, creating: boolean) => {
    const frozen = validateRecoveryRecord(record, record.owner, record.editorId);
    return transaction<void>('readwrite', (store, read, done) => {
      writeCheckpointRecord(store, read, frozen, creating, () => done(undefined));
    });
  };
  return {
    listRecoverable: (owner, resource) => transaction('readonly', (store, read, done) => {
      read(store.getAll(engineOwnerRange('checkpoint', owner)), values => {
        const records = (values as EditorRecord[]).map(record => [recoveryCheckpointId(owner, record.editorId), record] as const);
        done(selectRecoverableCheckpoints(records, owner, resource));
      });
    }),
    discardRecovery: (record, isCurrent) => discardRecoveryRecord(transaction, {
      owner: record.owner, key: checkpointKey(record.owner, record.editorId), expected: record,
      validate: value => validateRecoveryRecord(value, record.owner, record.editorId, record.checkpoint.confirmed.resource),
      version: value => value.recoveryVersion, references: checkpointCommitReferences, scopeId: record.editorId,
      canRemove: value => value.prepared === null && value.unfinalized.length === 0, isCurrent,
      remove: (store, current) => {
        store.delete(checkpointKey(current.owner, current.editorId));
        for (const id of current.completedCommits ?? []) store.delete(commitProjectionKey(current.owner, id));
      },
    }),
    create: record => write(record, true),
    pinRecovery: record => pinRecoveryVersion(transaction, checkpointKey(record.owner, record.editorId), record,
      value => validateRecoveryRecord(value, record.owner, record.editorId, record.checkpoint.confirmed.resource)),
    read: (owner, editorId) => transaction('readonly', (store, read, done) => {
      read(store.get(checkpointKey(owner, editorId)), (record: EditorRecord | undefined) => done(record === undefined ? undefined : clone(record)));
    }),
    put: record => write(record, false),
  };
}
