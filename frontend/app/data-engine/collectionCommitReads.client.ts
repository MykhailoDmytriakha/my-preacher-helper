'use client';

import { COMMIT_ROW_KINDS } from './retention.client';
import { engineOwnerRange } from './storage.client';

import type { CommitRequest } from './commits';
import type { StorageRead } from './storage.client';
import type { StorageTransaction } from '@/utils/storageTransaction';

type CollectionsByKey = ReadonlyMap<string, string>;
type CollectionRead = { rows: CommitRequest[]; collections: CollectionsByKey };

function collectionOf(owner: string, key: IDBValidKey, request: CommitRequest | undefined): string {
  const collection = request?.baseline?.resource?.collection;
  if (!request || request.owner !== owner || !Array.isArray(key) || key.length !== 4 || key[1] !== owner
    || key[2] !== request.editorId || key[3] !== request.editGeneration || typeof collection !== 'string') {
    throw new Error('Stored request identity changed');
  }
  return collection;
}

function readColdRows(store: IDBObjectStore, read: StorageRead, owner: string, collection: string,
  done: (result: CollectionRead) => void): void {
  const batches: CommitRequest[][] = [];
  const collections = new Map<string, string>();
  let remaining = COMMIT_ROW_KINDS.length;
  COMMIT_ROW_KINDS.forEach((kind, index) => {
    const range = engineOwnerRange(kind, owner);
    let keys: IDBValidKey[] | undefined, rows: CommitRequest[] | undefined;
    const pair = () => {
      if (!keys || !rows) return;
      if (keys.length !== rows.length) throw new Error('Stored requests do not match their keys');
      batches[index] = rows.filter((request, position) => {
        const key = keys![position];
        const scope = collectionOf(owner, key, request);
        collections.set(JSON.stringify(key), scope);
        return scope === collection;
      });
      if (!--remaining) done({ rows: batches.flat(), collections });
    };
    read(store.getAllKeys(range), result => { keys = result; pair(); });
    read(store.getAll(range), result => { rows = result; pair(); });
  });
}

/** Preserve the same native kind and key order as a full queue read. */
function readMatchingRows(store: IDBObjectStore, read: StorageRead, owner: string, collection: string, known: CollectionsByKey,
  done: (result: CollectionRead) => void): void {
  const batches: (CommitRequest | undefined)[][] = [];
  const collections = new Map<string, string>();
  let remaining = COMMIT_ROW_KINDS.length;
  const finish = () => { if (!--remaining) done({ rows: batches.flatMap(batch => batch.filter(row => row !== undefined)), collections }); };
  COMMIT_ROW_KINDS.forEach((kind, index) => read(store.getAllKeys(engineOwnerRange(kind, owner)), keys => {
    const batch: (CommitRequest | undefined)[] = batches[index] = [];
    let reading = 1;
    const finishKind = () => { if (!--reading) finish(); };
    keys.forEach((key, position) => {
      const encoded = JSON.stringify(key);
      const remembered = known.get(encoded);
      if (remembered !== undefined && remembered !== collection) {
        collections.set(encoded, remembered);
        return;
      }
      reading++;
      read(store.get(key), (request: CommitRequest) => {
        const scope = collectionOf(owner, key, request);
        collections.set(encoded, scope);
        if (scope === collection) batch[position] = request;
        finishKind();
      });
    });
    finishKind();
  }));
}

/** Exact request keys remain visible to old writers without a schema change. A capture's baseline
 * cannot change under its key, and collection of that key permanently retires its generation. */
export function createCollectionCommitReads(transaction: StorageTransaction) {
  let previous: { owner: string; collections: CollectionsByKey } | undefined;
  return async (owner: string, collection: string): Promise<CommitRequest[]> => {
    const known = previous?.owner === owner ? previous.collections : undefined;
    const current = await transaction<CollectionRead>('readonly', (store, read, done) => {
      if (known) readMatchingRows(store, read, owner, collection, known, done);
      else readColdRows(store, read, owner, collection, done);
    });
    previous = { owner, collections: current.collections };
    return current.rows;
  };
}
