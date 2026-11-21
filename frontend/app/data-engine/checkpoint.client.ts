'use client';

import { settleCheckpointRecords, writeCheckpointRecord, checkpointKey, SERMON_NOTE_CHOICE_ROW } from './checkpointStorage.client';
import { MANUAL_CHOICE_RECOVERY_PREFIX } from './editorIdentity';
import { equalValues } from './fieldValues';
import { examineRecoveryCheckpoints, recoveryCheckpointId, recoveryCheckpointEditorId, unreadableCheckpointDraft, validateRecoveryRecord } from './recovery.client';
import { discardRecoveryRecord } from './recoveryDiscard.client';
import { pinRecoveryVersion } from './recoverySource.client';
import { checkpointCommitReferences, collectCommitRows, commitProjectionKey, deferCollection } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange } from './storage.client';

import type { CheckpointRecoveryStore, EditorRecord, UnreadableCheckpoint } from './controller';
import type { RecoveryOrigin } from './recoverySource';
import type { ResourceRef } from './types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Checkpoint projection and request reference release are one durable transaction. */
export function createIndexedDbCheckpoints(collect = collectCommitRows): CheckpointRecoveryStore {
  const transaction = createEngineStorageTransaction();
  const write = (record: EditorRecord, creating: boolean, origin?: RecoveryOrigin) => {
    const frozen = validateRecoveryRecord(record, record.owner, record.editorId);
    return transaction<void>('readwrite', (store, read, done) => {
      const persist = () => writeCheckpointRecord(store, read, frozen, creating, () => done(undefined), creating ? collect : deferCollection);
      if (!origin) { persist(); return; }
      const source = recoveryCheckpointEditorId(frozen.owner, origin.id);
      if (!source || source === frozen.editorId) throw new Error('Invalid checkpoint recovery identity');
      read(store.get(checkpointKey(frozen.owner, source)), current => {
        if (current?.recoveryVersion !== origin.version) {
          throw Object.assign(new Error('Recovery source changed before capture'), { code: 'decision-changed' });
        }
        validateRecoveryRecord(current, frozen.owner, source, frozen.checkpoint.confirmed.resource);
        persist();
      });
    });
  };
  const list = (owner: string, range: IDBKeyRange) => transaction<Array<[string, unknown]>>('readonly', (store, read, done) => {
    const records: Array<[string, unknown]> = [];
    const ranges = [range, engineOwnerRange(SERMON_NOTE_CHOICE_ROW, owner)];
    let remaining = ranges.length;
    for (const range of ranges) {
      let physical: IDBValidKey[] | undefined, values: unknown[] | undefined;
      const collectRange = () => {
        if (!physical || !values) return;
        if (physical.length !== values.length) throw new Error('Checkpoint storage keys and values differ');
        physical.forEach((key, index) => {
          if (Array.isArray(key) && key[1] === owner && typeof key[2] === 'string' && equalValues(checkpointKey(owner, key[2]), key)) {
            records.push([recoveryCheckpointId(owner, key[2]), values![index]]);
          }
        });
        if (--remaining === 0) done(records);
      };
      read(store.getAllKeys(range), keys => { physical = keys; collectRange(); });
      read(store.getAll(range), rows => { values = rows; collectRange(); });
    }
  });
  const all = (owner: string) => list(owner, engineOwnerRange('checkpoint', owner));
  const select = (records: Array<[string, unknown]>, owner: string, resource?: ResourceRef) =>
    examineRecoveryCheckpoints(records, owner, resource).selected;
  return {
    listRecoverable: async (owner, resource) => select(await all(owner), owner, resource),
    listManualChoiceCopies: async (owner, resource) => select(await list(owner, IDBKeyRange.bound(
      ['checkpoint', owner, MANUAL_CHOICE_RECOVERY_PREFIX], ['checkpoint', owner, MANUAL_CHOICE_RECOVERY_PREFIX + '\uffff'])), owner, resource),
    listUnreadable: async owner => {
      const records = await all(owner);
      const values = new Map(records);
      return examineRecoveryCheckpoints(records, owner).unreadable.map((id): UnreadableCheckpoint => {
        const editorId = recoveryCheckpointEditorId(owner, id);
        const draft = editorId && unreadableCheckpointDraft(values.get(id), owner, editorId);
        if (!draft) return { id };
        const title = typeof draft.title === 'string' ? draft.title.slice(0, 120) : undefined;
        return { id, title, text: JSON.stringify(draft, null, 2) };
      });
    },

    discardRecovery: (record, isCurrent) => discardRecoveryRecord<EditorRecord>(transaction, {
      owner: record.owner, key: checkpointKey(record.owner, record.editorId), expected: record,
      validate: value => validateRecoveryRecord(value, record.owner, record.editorId, record.checkpoint.confirmed.resource),
      version: value => value.recoveryVersion, references: checkpointCommitReferences, scopeId: record.editorId,
      canRemove: value => value.prepared === null && value.unfinalized.length === 0, isCurrent,
      remove: (store, current) => {
        store.delete(checkpointKey(current.owner, current.editorId));
        for (const id of current.completedCommits ?? []) store.delete(commitProjectionKey(current.owner, id));
      },
    }),
    create: (record, origin) => write(record, true, origin),
    pinRecovery: record => pinRecoveryVersion(transaction, checkpointKey(record.owner, record.editorId), record,
      value => validateRecoveryRecord(value, record.owner, record.editorId, record.checkpoint.confirmed.resource)),
    read: (owner, editorId) => transaction('readonly', (store, read, done) => {
      read(store.get(checkpointKey(owner, editorId)), (record: unknown) => done(record === undefined ? undefined : validateRecoveryRecord(record, owner, editorId)));
    }),
    // Typing persists immediately; existing delivery/maintenance passes collect released payloads.
    put: record => write(record, false),
    settleClosed: (owner, entries) => {
      const frozen = clone(entries);
      return transaction<void>('readwrite', (store, read, done) => {
        settleCheckpointRecords(store, read, owner, frozen, () => done(undefined), collect);
      });
    },
  };
}
