'use client';

import { COLLECTION_COMMIT_INDEX } from './collectionCommitIndex';
import { COMMIT_ROW_KINDS } from './retention.client';
import { engineOwnerRange } from './storage.client';

import type { CommitRequest } from './commits';
import type { StorageRead } from './storage.client';
import type { StorageTransaction } from '@/utils/storageTransaction';

type CollectionsByKey = ReadonlyMap<string, string>;
type CollectionRead = { rows: CommitRequest[]; collections?: CollectionsByKey };

function collectionOf(owner: string, key: IDBValidKey, request: CommitRequest | undefined): string {
  const collection = request?.baseline?.resource?.collection;
  if (!request || request.owner !== owner || !Array.isArray(key) || key.length !== 4 || key[1] !== owner
    || key[2] !== request.editorId || key[3] !== request.editGeneration || typeof collection !== 'string') {
    throw new Error('Stored request identity changed');
  }
  return collection;
}

function readRowsWithKeys(source: Pick<IDBObjectStore, 'getAll' | 'getAllKeys'>, range: IDBKeyRange, read: StorageRead,
  done: (keys: IDBValidKey[], rows: CommitRequest[]) => void): void {
  let keys: IDBValidKey[] | undefined, rows: CommitRequest[] | undefined;
  const finish = () => {
    if (!keys || !rows) return;
    if (keys.length !== rows.length) throw new Error('Stored requests do not match their keys');
    done(keys, rows);
  };
  read(source.getAllKeys(range), result => { keys = result; finish(); });
  read(source.getAll(range), result => { rows = result; finish(); });
}

function readIndexedRows(index: IDBIndex, read: StorageRead, owner: string, collection: string,
  done: (result: CollectionRead) => void): void {
  const scope = [owner, collection];
  readRowsWithKeys(index, IDBKeyRange.bound(scope, scope), read, (keys, rows) => {
    // Index duplicates are returned by primary key. Group the recognized kinds in the same
    // order the unindexed reader used. Other records sharing these fields are not requests.
    const kinds = new Map<string, CommitRequest[]>(COMMIT_ROW_KINDS.map(kind => [kind, []]));
    rows.forEach((request, position) => {
      const key = keys[position];
      if (!Array.isArray(key) || key[1] !== owner || typeof key[0] !== 'string') return;
      const batch = kinds.get(key[0]);
      if (!batch) return;
      if (collectionOf(owner, key, request) !== collection) throw new Error('Stored request identity changed');
      batch.push(request);
    });
    done({ rows: [...kinds.values()].flat() });
  });
}

function readColdRows(store: IDBObjectStore, read: StorageRead, owner: string, collection: string,
  done: (result: CollectionRead) => void): void {
  const batches: CommitRequest[][] = [];
  const collections = new Map<string, string>();
  let remaining = COMMIT_ROW_KINDS.length;
  COMMIT_ROW_KINDS.forEach((kind, index) => {
    readRowsWithKeys(store, engineOwnerRange(kind, owner), read, (keys, rows) => {
      batches[index] = rows.filter((request, position) => {
        const key = keys[position];
        const scope = collectionOf(owner, key, request);
        collections.set(JSON.stringify(key), scope);
        return scope === collection;
      });
      if (!--remaining) done({ rows: batches.flat(), collections });
    });
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
      if (store.indexNames?.contains(COLLECTION_COMMIT_INDEX)) {
        readIndexedRows(store.index(COLLECTION_COMMIT_INDEX), read, owner, collection, done);
      } else if (known) readMatchingRows(store, read, owner, collection, known, done);
      else readColdRows(store, read, owner, collection, done);
    });
    previous = current.collections ? { owner, collections: current.collections } : undefined;
    return current.rows;
  };
}
