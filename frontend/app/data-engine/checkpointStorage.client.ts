'use client';

import { equalValues } from './protocol';
import { isRecoverableCheckpoint, recoveryCheckpointEditorId, validateRecoveryRecord } from './recovery.client';
import { recoveryOrigins } from './recoverySource';
import { retireRecoveryVersions, versionRecoveryRecord } from './recoverySource.client';
import { checkpointCommitReferences, collectCommitRows, commitProjectionKey, commitSnapshotKey } from './retention.client';
import { validateCommitReferences, type StorageRead } from './storage.client';

import type { CommitRequest } from './commits';
import type { EditorRecord, SettledCheckpoint } from './controller';

export const checkpointKey = (owner: string, editorId: string): IDBValidKey => ['checkpoint', owner, editorId];

/** Reuse the same validation and retention rules inside an existing native transaction. */
export function writeCheckpointRecord(store: IDBObjectStore, read: StorageRead, record: EditorRecord,
  creating: boolean, done: () => void, collect = collectCommitRows): void {
  placeCheckpointRecord(store, read, record, creating, versionRecoveryRecord, () => collect(store, read, record.owner, done));
}

/**
 * What a closed editor's copy may become once its Saves were answered — what the editor itself would have written on
 * those answers while open, and nothing more: removed when nothing of the person's is left; or, when every Save in it
 * was answered and words remain, the answered Saves dropped, its words and the version a recovery may name kept.
 * A copy with a Save still on its way stays as it is.
 */
export function closedCopySettlement(stored: EditorRecord, settled: EditorRecord): 'remove' | 'clear-answered' | null {
  if (!isRecoverableCheckpoint(settled)) return 'remove';
  const answered = Object.keys(stored.checkpoint.pending).length > 0 && !Object.keys(settled.checkpoint.pending).length;
  return answered && settled.prepared === null && !settled.unfinalized.length && Boolean(stored.recoveryVersion)
    && settled.recoveryVersion === stored.recoveryVersion ? 'clear-answered' : null;
}

/**
 * Settle closed editors' copies in one native transaction with one row collection. Only the exact copy each decision
 * was read from — a copy changed since belongs to whoever changed it — and only after the accepted copies its answered
 * Saves carry were cached and released: until then an answered row is the device's only accepted copy, and an older
 * row has no separate cache hold of its own.
 */
export function settleCheckpointRecords(store: IDBObjectStore, read: StorageRead, owner: string,
  entries: readonly SettledCheckpoint[], done: () => void, collect = collectCommitRows): void {
  const next = (index: number): void => {
    if (index === entries.length) { collect(store, read, owner, done); return; }
    const skip = () => next(index + 1);
    let expected: EditorRecord, frozen: EditorRecord;
    try {
      expected = validateRecoveryRecord(entries[index].stored, owner, entries[index].stored.editorId);
      frozen = validateRecoveryRecord(entries[index].settled, owner, expected.editorId, expected.checkpoint.confirmed.resource);
    } catch { skip(); return; }
    const settlement = closedCopySettlement(expected, frozen);
    if (!settlement) { skip(); return; }
    read(store.get(checkpointKey(owner, expected.editorId)), current => {
      let unchanged = false;
      try { unchanged = current !== undefined && equalValues(validateRecoveryRecord(current, owner, expected.editorId), expected); }
      catch { /* An unreadable copy stays for its owner to see. */ }
      if (!unchanged) { skip(); return; }
      whenAcceptedCopiesReleased(store, read, owner, frozen.completedCommits ?? [], released => {
        if (!released) { skip(); return; }
        placeCheckpointRecord(store, read, frozen, false, settlement === 'remove' ? versionRecoveryRecord : record => record, skip);
      });
    });
  };
  next(0);
}

/** A row carrying an accepted copy, or one side of a transfer or a whole action, waits for its holds to be released;
 * a plain cancelled Save carries nothing to cache, and its hold is the editor's to drop. */
function whenAcceptedCopiesReleased(store: IDBObjectStore, read: StorageRead, owner: string, ids: readonly string[],
  done: (released: boolean) => void): void {
  const unique = [...new Set(ids)];
  if (!unique.length) { done(true); return; }
  let remaining = unique.length, released = true;
  const settle = () => { if (!--remaining) done(released); };
  for (const id of unique) read(store.get(['identity', owner, id]), (rowKey: IDBValidKey | undefined) => {
    if (!rowKey) { settle(); return; }
    read(store.get(rowKey), (row: CommitRequest | undefined) => {
      if (!row || (row.result?.kind !== 'acknowledged' && !row.transferredTo && !row.transferredFrom && !row.atomic)) { settle(); return; }
      let holds = 2;
      for (const key of [commitProjectionKey(owner, id), commitSnapshotKey(owner, id)]) read(store.get(key), value => {
        if (value !== undefined) released = false;
        if (!--holds) settle();
      });
    });
  });
}

/** The editor's rule for its own copy — kept while it holds the person's work, otherwise removed — without collecting rows. */
function placeCheckpointRecord(store: IDBObjectStore, read: StorageRead, record: EditorRecord,
  creating: boolean, version: (record: EditorRecord) => EditorRecord, done: () => void): void {
  const frozen = validateRecoveryRecord(record, record.owner, record.editorId);
  read(store.get(checkpointKey(record.owner, record.editorId)), current => {
    if (creating && current !== undefined) throw new Error('Recovery target already exists');
    validateCommitReferences(store, read, record.owner, checkpointCommitReferences(frozen), () => {
      const keeps = isRecoverableCheckpoint(frozen);
      if (keeps) store.put(version(frozen), checkpointKey(record.owner, record.editorId));
      else store.delete(checkpointKey(record.owner, record.editorId));
      for (const id of frozen.completedCommits ?? []) store.delete(commitProjectionKey(record.owner, id));
      retireRecoveryVersions(store, read, keeps ? [] : recoveryOrigins(frozen.recoveryOrigins), id => {
        const editorId = recoveryCheckpointEditorId(frozen.owner, id);
        if (editorId === null || editorId === frozen.editorId) return null;
        return { key: checkpointKey(frozen.owner, editorId), owns: value => Boolean(validateRecoveryRecord(value,
          frozen.owner, editorId, frozen.checkpoint.confirmed.resource)) };
      }, done);
    });
  });
}
