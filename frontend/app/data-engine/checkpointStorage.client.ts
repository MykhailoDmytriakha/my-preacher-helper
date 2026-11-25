'use client';

import { isPreparationTextField } from '@/utils/preparationFieldValues';

import { protectedSermonRecoveryKind, SERMON_NOTE_CHOICE_RECOVERY_PREFIX } from './editorIdentity';
import { equalValues } from './protocol';
import { isRecoverableCheckpoint, recoveryCheckpointEditorId, validateRecoveryRecord } from './recovery.client';
import { recoveryOrigins } from './recoverySource';
import { retireRecoveryVersions, versionRecoveryRecord } from './recoverySource.client';
import { checkpointCommitReferences, collectCommitRows, commitProjectionKey, commitSnapshotKey } from './retention.client';
import { validateCommitReferences, type StorageRead } from './storage.client';

import type { CommitRequest } from './commits';
import type { EditorRecord, SettledCheckpoint } from './controller';

// A version that cannot restore a reminder's opening must not offer to apply its retained draft.
export const SERMON_NOTE_CHOICE_ROW = 'sermon-note-choice-checkpoint';
export const SERMON_HEADER_CHOICE_ROW = 'sermon-header-choice-checkpoint';
export const SERMON_CHURCH_CHOICE_ROW = 'sermon-church-choice-checkpoint';
export const SERMON_PREPARATION_CHECK_CHOICE_ROW = 'sermon-preparation-check-choice-checkpoint';
export const SERMON_SCRATCH_TEXT_CHOICE_ROW = 'sermon-scratch-text-choice-checkpoint';
export const SERMON_SCRATCH_REMOVAL_CHOICE_ROW = 'sermon-scratch-removal-choice-checkpoint';
export const SERMON_PLACED_SKETCH_CHOICE_ROW = 'sermon-placed-sketch-choice-checkpoint';
export const SERMON_THOUGHT_LOCK_CHOICE_ROW = 'sermon-thought-lock-choice-checkpoint';
export const SERMON_THOUGHT_REMOVAL_CHOICE_ROW = 'sermon-thought-removal-choice-checkpoint';
export const SERMON_THOUGHT_PLACEMENT_CHOICE_ROW = 'sermon-thought-placement-choice-checkpoint';
const protectedSermonRows = { 'sermon-header': SERMON_HEADER_CHOICE_ROW, 'sermon-church': SERMON_CHURCH_CHOICE_ROW,
  'sermon-preparation-check': SERMON_PREPARATION_CHECK_CHOICE_ROW, 'sermon-thought-placement': SERMON_THOUGHT_PLACEMENT_CHOICE_ROW,
  'sermon-placed-sketch': SERMON_PLACED_SKETCH_CHOICE_ROW,
  'sermon-scratch-removal': SERMON_SCRATCH_REMOVAL_CHOICE_ROW,
  'sermon-scratch-text': SERMON_SCRATCH_TEXT_CHOICE_ROW,
  'sermon-thought-removal': SERMON_THOUGHT_REMOVAL_CHOICE_ROW, 'sermon-thought-lock': SERMON_THOUGHT_LOCK_CHOICE_ROW } as const;
export const checkpointKey = (owner: string, editorId: string): IDBValidKey => {
  const protection = protectedSermonRecoveryKind(editorId);
  const kind = protection ? protectedSermonRows[protection]
    : editorId.startsWith(SERMON_NOTE_CHOICE_RECOVERY_PREFIX) ? SERMON_NOTE_CHOICE_ROW : 'checkpoint';
  return [kind, owner, editorId];
};

const placedSketchCheckpointReference = (owner: string, editorId: string): IDBValidKey =>
  ['reference', owner, 'placed-sketch-checkpoint', editorId];

function hasSketchReference(editorId: string): boolean {
  const kind = protectedSermonRecoveryKind(editorId);
  return kind === 'sermon-placed-sketch' || kind === 'sermon-scratch-removal' || kind === 'sermon-scratch-text';
}

export function deleteCheckpointRecord(store: IDBObjectStore, owner: string, editorId: string): void {
  store.delete(checkpointKey(owner, editorId));
  if (hasSketchReference(editorId)) store.delete(placedSketchCheckpointReference(owner, editorId));
}

function deviceCheckpointRecord(record: EditorRecord) {
  const { sermonTextRetry, ...checkpoint } = record.checkpoint;
  // Preserve the field name already understood by older readers of preparation drafts.
  return sermonTextRetry && isPreparationTextField(sermonTextRetry.field)
    ? { ...record, checkpoint: { ...checkpoint, preparationTextRetry: sermonTextRetry } } : record;
}

/** Reuse the same validation and retention rules inside an existing native transaction. */
export function writeCheckpointRecord(store: IDBObjectStore, read: StorageRead, record: EditorRecord,
  creating: boolean, done: () => void, collect = collectCommitRows): void {
  placeCheckpointRecord(store, read, record, creating, versionRecoveryRecord, () => collect(store, read, record.owner, done));
}

/** Store the deciding copy and any later work it leaves for recovery in the same transaction. */
export function writeChoiceCheckpoints(store: IDBObjectStore, read: StorageRead, owner: string, records: EditorRecord[],
  done: () => void, collect = collectCommitRows): void {
  if (!records.length || records.some(record => record.owner !== owner)) throw new Error('Checkpoint projection owner differs from changed commits');
  const next = (index: number): void => {
    if (index === records.length) { collect(store, read, owner, done); return; }
    placeCheckpointRecord(store, read, records[index], index > 0, versionRecoveryRecord, () => next(index + 1));
  };
  next(0);
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
    const references = checkpointCommitReferences(frozen);
    validateCommitReferences(store, read, record.owner, references, () => {
      const keeps = isRecoverableCheckpoint(frozen);
      if (keeps) {
        store.put(deviceCheckpointRecord(version(frozen)), checkpointKey(record.owner, record.editorId));
        // An older tab can deliver a request without being able to read the protected checkpoint.
        if (hasSketchReference(record.editorId)) {
          const reference = placedSketchCheckpointReference(record.owner, record.editorId);
          if (references.length) store.put({ commitReferences: references }, reference);
          else store.delete(reference);
        }
      } else deleteCheckpointRecord(store, record.owner, record.editorId);
      for (const id of frozen.completedCommits ?? []) store.delete(commitProjectionKey(record.owner, id));
      retireRecoveryVersions(store, read, keeps ? [] : recoveryOrigins(frozen.recoveryOrigins), id => {
        const editorId = recoveryCheckpointEditorId(frozen.owner, id);
        if (editorId === null || editorId === frozen.editorId) return null;
        return { key: checkpointKey(frozen.owner, editorId), remove: () => deleteCheckpointRecord(store, frozen.owner, editorId), owns: value => Boolean(validateRecoveryRecord(value,
          frozen.owner, editorId, frozen.checkpoint.confirmed.resource)) };
      }, done);
    });
  });
}
