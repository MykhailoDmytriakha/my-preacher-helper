'use client';

import { assertCommitBatch, assertCommitCapture, assertCommitIdentities, type CommitRequest, type CommitStore } from './commits';
import { COMMIT_ROW_KINDS, collectCommitRows, commitCaptureKey, commitDependencyKey, commitGenerationKey, commitProjectionKey, commitRowKey, readCommitRows } from './retention.client';
import { createEngineStorageTransaction, validateCommitReferences, type StorageRead } from './storage.client';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const changed = () => Object.assign(new Error('Commit changed'), { code: 'commit-changed' });

/** Older collectors honor reference rows even when they cannot read a new request format. */
function retainPredecessor(store: IDBObjectStore, request: CommitRequest): void {
  const key = commitDependencyKey(request.owner, request.id);
  if (request.predecessor && !request.initialized && !['cancelled', 'acknowledged'].includes(request.state)) {
    store.put({ commitReferences: [request.predecessor] }, key);
  } else store.delete(key);
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

function createRecord(store: IDBObjectStore, read: StorageRead, frozen: CommitRequest, done: (record: CommitRequest) => void): void {
  read(store.get(commitRowKey(frozen)), (existing: CommitRequest | undefined) => {
    if (existing) { assertCommitCapture(existing, frozen); done(existing); return; }
    checkOwnershipFormat(store, read, frozen, () => {
      read(store.get(commitGenerationKey(frozen)), (completed: { through: number } | undefined) => {
        if (completed && completed.through >= frozen.editGeneration) throw Object.assign(new Error('This saved generation is already complete'), { code: 'commit-generation-complete' });
        const identity = ['identity', frozen.owner, frozen.id];
        read(store.get(identity), used => {
          if (used) throw new Error('Commit identity is already used');
          validateCommitReferences(store, read, frozen.owner, frozen.predecessor && !frozen.initialized ? [frozen.predecessor] : [], () => {
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

/** Each request has its own row; a participant batch shares one IndexedDB transaction. */
export function createIndexedDbCommitStore(): CommitStore {
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
  const compareAndSetBatch = async (changes: readonly { previous: CommitRequest; next: CommitRequest }[]): Promise<CommitRequest[]> => {
    const frozen = clone(changes); assertCommitIdentities(frozen.map(change => change.previous));
    if (!frozen.length) return [];
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
          store.put(saved, commitRowKey(saved)); result[index] = saved;
          if (!--remaining) collectCommitRows(store, read, saved.owner, () => done(result));
        });
      });
    });
  };
  return {
    list: owner => transaction('readonly', (store, read, done) => {
      readCommitRows(store, read, owner, done);
    }),
    create: request => createBatch([request]).then(records => records[0]),
    compareAndSet: (previous, next) => compareAndSetBatch([{ previous, next }]).then(records => records[0]),
    createBatch,
    compareAndSetBatch,
  };
}
