'use client';

import { isCapturedTransferReplay, planCaptureTransfer } from './captureTransfer';
import { checkpointKey, writeCheckpointRecord } from './checkpointStorage.client';
import { assertCommitBatch, assertCommitCapture, assertCommitIdentities, orderCommitRequests, type CommitRequest, type CommitStore } from './commits';
import { captureDeleteOrder, replayDeleteOrder } from './deletionOrdering';
import { reconcileRecoveryRecord, validateRecoveryRecord } from './recovery.client';
import { COMMIT_ROW_KINDS, collectCommitRows, commitCaptureKey, commitDependencyKey, commitGenerationKey, commitProjectionKey, commitRowKey, commitSnapshotKey, readCommitIdentities, readCommitRows } from './retention.client';
import { createEngineStorageTransaction, validateCommitReferences, type StorageRead } from './storage.client';

import type { EditorRecord } from './controller';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const changed = () => Object.assign(new Error('Commit changed'), { code: 'commit-changed' });

/** Older collectors honor reference rows even when they cannot read a new request format. */
function retainPredecessor(store: IDBObjectStore, request: CommitRequest): void {
  const key = commitDependencyKey(request.owner, request.id);
  const references = new Set<string>();
  if (!['cancelled', 'acknowledged'].includes(request.state)) {
    if (request.predecessor && !request.initialized) references.add(request.predecessor);
    for (const id of request.deleteAfter ?? []) references.add(id);
  }
  if (references.size) store.put({ commitReferences: [...references] }, key);
  else store.delete(key);
}

function checkOwnershipFormat(store: IDBObjectStore, read: StorageRead, request: CommitRequest, done: () => void): void {
  const selected = (commitRowKey(request) as IDBValidKey[])[0];
  const others = COMMIT_ROW_KINDS.filter(kind => kind !== selected);
  let remaining = others.length;
  for (const kind of others) read(store.get(commitRowKey(request, kind)), other => {
    if (other) throw new Error('Saved generation cannot change its ownership format');
    if (!--remaining) done();
  });
}

function writeRecord(store: IDBObjectStore, read: StorageRead, frozen: CommitRequest, done: (record: CommitRequest) => void, transferring = false): void {
  if (frozen.transferredFrom && !transferring) throw new Error('A replacement proof requires atomic source transfer');
  read(store.get(commitRowKey(frozen)), (existing: CommitRequest | undefined) => {
    if (existing) { assertCommitCapture(existing, frozen); done(existing); return; }
    checkOwnershipFormat(store, read, frozen, () => {
      read(store.get(commitGenerationKey(frozen)), (completed: { through: number } | undefined) => {
        if (completed && completed.through >= frozen.editGeneration) throw Object.assign(new Error('This saved generation is already complete'), { code: 'commit-generation-complete' });
        const identity = ['identity', frozen.owner, frozen.id];
        read(store.get(identity), used => {
          if (used) throw new Error('Commit identity is already used');
          validateCommitReferences(store, read, frozen.owner, [...(frozen.predecessor && !frozen.initialized ? [frozen.predecessor] : []), ...(frozen.deleteAfter ?? [])], () => {
            store.put(commitRowKey(frozen), identity);
            store.put({ commitReferences: [frozen.id] }, commitProjectionKey(frozen.owner, frozen.id));
            if (frozen.retentionScope) store.put({ commitReferences: [frozen.id] }, commitCaptureKey(frozen.owner, frozen.retentionScope, frozen.id));
            store.put(frozen, commitRowKey(frozen));
            retainPredecessor(store, frozen);
            done(frozen);
          });
        });
      });
    });
  });
}

/** Derive the frontier only once, from rows read in this same native write transaction. */
function createRecord(store: IDBObjectStore, read: StorageRead, frozen: CommitRequest, done: (record: CommitRequest) => void, transferring = false): void {
  if (frozen.value !== null) { writeRecord(store, read, frozen, done, transferring); return; }
  readCommitRows(store, read, frozen.owner, records => {
    const existing = records.find(record => record.editorId === frozen.editorId && record.editGeneration === frozen.editGeneration);
    const captured = existing ? replayDeleteOrder(frozen, existing) : captureDeleteOrder(frozen, records);
    writeRecord(store, read, captured, done, transferring);
  });
}

/** Each request has its own row; a participant batch shares one IndexedDB transaction. */
export function createIndexedDbCommitStore(collect = collectCommitRows): CommitStore {
  const transaction = createEngineStorageTransaction();
  const createBatch = async (requests: readonly CommitRequest[]): Promise<CommitRequest[]> => {
    const frozen = clone(requests); assertCommitBatch(frozen);
    if (!frozen.length) return [];
    return transaction('readwrite', (store, read, done) => {
      const result: CommitRequest[] = []; let remaining = frozen.length;
      frozen.forEach((request, index) => createRecord(store, read, request, saved => {
        result[index] = saved;
        if (!--remaining) done(result);
      }));
    });
  };
  const compareAndSetBatchInternal = async (changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    project?: (saved: CommitRequest[]) => EditorRecord): Promise<CommitRequest[]> => {
    const frozen = clone(changes); assertCommitIdentities(frozen.map(change => change.previous));
    if (!frozen.length) {
      if (project) throw new Error('A checkpoint projection requires at least one changed commit');
      return [];
    }
    return transaction('readwrite', (store, read, done) => {
      const result: CommitRequest[] = []; let remaining = frozen.length;
      frozen.forEach(({ previous, next }, index) => {
        read(store.get(commitRowKey(previous)), (current: CommitRequest | undefined) => {
          if (!current || current.id !== previous.id || current.revision !== previous.revision) throw changed();
          if (next.id !== previous.id || next.owner !== previous.owner || next.editorId !== previous.editorId
            || next.editGeneration !== previous.editGeneration) throw new Error('Commit identity changed');
          assertCommitCapture(current, next);
          const saved = { ...next, revision: previous.revision + 1 };
          retainPredecessor(store, saved);
          if (saved.state === 'acknowledged' && saved.result?.kind === 'acknowledged') {
            store.put({ commitReferences: [saved.id] }, commitSnapshotKey(saved.owner, saved.id));
          }
          store.put(saved, commitRowKey(saved)); result[index] = saved;
          if (!--remaining) {
            if (project) {
              const record = project(clone(result));
              if (record.owner !== previous.owner) throw new Error('Checkpoint projection owner differs from changed commits');
              writeCheckpointRecord(store, read, record, false, () => done(result), collect);
            } else collect(store, read, saved.owner, () => done(result));
          }
        });
      });
    });
  };
  const compareAndSetBatch = (changes: readonly { previous: CommitRequest; next: CommitRequest }[]): Promise<CommitRequest[]> =>
    compareAndSetBatchInternal(changes);
  const compareAndSetWithCheckpoint = (changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    project: (saved: CommitRequest[]) => EditorRecord): Promise<CommitRequest[]> => compareAndSetBatchInternal(changes, project);
  return {
    list: owner => transaction('readonly', (store, read, done) => {
      readCommitRows(store, read, owner, done);
    }),
    readByIds: (owner, ids) => transaction('readonly', (store, read, done) => {
      readCommitIdentities(store, read, owner, ids, requests => done([...requests.values()]));
    }),
    create: request => createBatch([request]).then(records => records[0]),
    createWithCheckpoint: (request, project) => {
      const frozen = clone(request);
      return transaction('readwrite', (store, read, done) => {
        createRecord(store, read, frozen, saved => {
          writeCheckpointRecord(store, read, project(clone(saved)), false, () => done(saved), collect);
        });
      });
    },
    createWithTransfer: (request, project, sources) => {
      const frozen = clone(request), expected = clone(sources);
      return transaction('readwrite', (store, read, done) => {
        readCommitRows(store, read, frozen.owner, records => {
          const existing = records.find(record => record.editorId === frozen.editorId && record.editGeneration === frozen.editGeneration);
          if (existing?.transferredFrom) {
            assertCommitCapture(existing, frozen);
            if (!isCapturedTransferReplay(existing, frozen)) throw changed();
            // The first transaction already stored the target checkpoint and sources.
            // Replaying it must not replace a newer private target checkpoint.
            done({ request: clone(existing), retired: [] });
            return;
          }
          createRecord(store, read, frozen, saved => {
            const retired = planCaptureTransfer(saved, expected, records);
            for (const source of retired) { store.put(source, commitRowKey(source)); retainPredecessor(store, source); }
            writeCheckpointRecord(store, read, project(clone(saved)), false, () => done({ request: saved, retired }), collect);
          }, true);
        });
      });
    },
    compareAndSet: (previous, next) => compareAndSetBatch([{ previous, next }]).then(records => records[0]),
    createBatch,
    compareAndSetBatch,
    compareAndSetWithCheckpoint,
    listCaptures: (owner, prefix) => transaction('readonly', (store, read, done) => {
      readCommitRows(store, read, owner, requests => {
        const candidates = requests.filter(request => request.retentionScope?.startsWith(prefix));
        if (!candidates.length) { done([]); return; }
        const held: CommitRequest[] = []; let remaining = candidates.length;
        for (const request of candidates) read(store.get(commitCaptureKey(owner, request.retentionScope!, request.id)), reference => {
          if (reference?.commitReferences?.length === 1 && reference.commitReferences[0] === request.id) held.push(request);
          if (!--remaining) done(held);
        });
      });
    }),
    releaseCapture: (owner, scope, id) => transaction('readwrite', (store, read, done) => {
      readCommitRows(store, read, owner, requests => {
        if (!requests.some(request => request.id === id && request.retentionScope === scope)) { done(undefined); return; }
        const key = commitCaptureKey(owner, scope, id);
        read(store.get(key), reference => {
          if (reference?.commitReferences?.length === 1 && reference.commitReferences[0] === id) store.delete(key);
          collect(store, read, owner, () => done(undefined));
        });
      });
    }),
    releaseProjection: (owner, ids) => transaction('readwrite', (store, read, done) => {
      readCommitIdentities(store, read, owner, ids, requested => {
        const missing = [...requested.values()].flatMap(request =>
          request.atomic?.participants.filter(id => !requested.has(id)) ?? []);
        readCommitIdentities(store, read, owner, missing, participants => {
          const ready = [...requested.values()].filter(request =>
            (request.atomic?.participants ?? [request.id]).every(id => {
              const item = requested.get(id) ?? participants.get(id);
              return item && ['acknowledged', 'cancelled'].includes(item.state) && !item.unfinalized.length;
            }));
          let ordered: CommitRequest[] | undefined;
          const projectNext = (index: number): void => {
            const request = ready[index];
            if (!request) {
              if (ready.length) collect(store, read, owner, () => done(undefined));
              else done(undefined);
              return;
            }
            store.delete(commitProjectionKey(owner, request.id));
            store.delete(commitSnapshotKey(owner, request.id));
            read(store.get(checkpointKey(owner, request.editorId)), record => {
              if (!record || (!request.transferredFrom && !request.transferredTo && !record.recoveryOrigins?.length)) {
                projectNext(index + 1); return;
              }
              // Transferred and recovered targets still reconcile through the complete dependency order.
              const project = (requests: CommitRequest[]) => {
                const frozen = validateRecoveryRecord(record, owner, request.editorId, request.baseline.resource);
                writeCheckpointRecord(store, read, reconcileRecoveryRecord(frozen, requests), false,
                  () => projectNext(index + 1), (_store, _read, _owner, finish) => finish());
              };
              if (ordered) project(ordered);
              else readCommitRows(store, read, owner, requests => { ordered = orderCommitRequests(requests); project(ordered); });
            });
          };
          projectNext(0);
        });
      });
    }),
  };
}
