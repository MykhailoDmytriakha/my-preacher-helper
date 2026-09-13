'use client';

import { assertCommitCapture, type CommitRequest, type CommitStore } from './commits';
import { collectCommitRows, commitGenerationKey, commitProjectionKey, commitRowKey } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from './storage.client';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const changed = () => Object.assign(new Error('Commit changed'), { code: 'commit-changed' });

/** Each request has its own row. Generation uniqueness and identity are one transaction. */
export function createIndexedDbCommitStore(): CommitStore {
  const transaction = createEngineStorageTransaction();
  return {
    list: owner => transaction('readonly', (store, read, done) => {
      read(store.getAll(engineOwnerRange('request', owner)), values => done(values as CommitRequest[]));
    }),
    create: request => transaction('readwrite', (store, read, done) => {
      const frozen = clone(request);
      read(store.get(commitRowKey(frozen)), (existing: CommitRequest | undefined) => {
        if (existing) { assertCommitCapture(existing, frozen); done(existing); return; }
        read(store.get(commitGenerationKey(frozen)), (completed: { through: number } | undefined) => {
          if (completed && completed.through >= frozen.editGeneration) throw Object.assign(new Error('This saved generation is already complete'), { code: 'commit-generation-complete' });
          const identity = ['identity', frozen.owner, frozen.id];
          read(store.get(identity), used => {
            if (used) throw new Error('Commit identity is already used');
            validateCommitReferences(store, read, frozen.owner, frozen.predecessor && !frozen.initialized ? [frozen.predecessor] : [], () => {
              store.put(commitRowKey(frozen), identity);
              store.put({ commitReferences: [frozen.id] }, commitProjectionKey(frozen.owner, frozen.id));
              store.put(frozen, commitRowKey(frozen));
              done(frozen);
            });
          });
        });
      });
    }),
    compareAndSet: (previous, next) => transaction('readwrite', (store, read, done) => {
      read(store.get(commitRowKey(previous)), (current: CommitRequest | undefined) => {
        if (!current || current.id !== previous.id || current.revision !== previous.revision) throw changed();
        if (next.id !== previous.id || next.owner !== previous.owner || next.editorId !== previous.editorId
          || next.editGeneration !== previous.editGeneration) throw new Error('Commit identity changed');
        assertCommitCapture(current, next);
        const saved = { ...clone(next), revision: previous.revision + 1 };
        store.put(saved, commitRowKey(saved)); collectCommitRows(store, read, saved.owner, () => done(saved));
      });
    }),
  };
}
