'use client';

import { createStore, get, update } from 'idb-keyval';

import { collectionHeadRef } from './feed';

import type { CollectionCursor, CollectionCursorStore } from './collections';

function validate(value: unknown): CollectionCursor {
  const cursor = value as CollectionCursor | null;
  if (!cursor || !Number.isSafeInteger(cursor.version) || cursor.version < 0
    || !Number.isSafeInteger(cursor.revision) || cursor.revision < 1
    || typeof cursor.initialized !== 'boolean') {
    throw new Error('Invalid collection cursor');
  }
  return { version: cursor.version, revision: cursor.revision, initialized: cursor.initialized };
}

/** A local CAS generation prevents a stale tab from undoing another tab's reset. */
export function createIndexedDbCollectionCursors(): CollectionCursorStore {
  let store: ReturnType<typeof createStore> | undefined;
  const database = () => (store ??= createStore('preacher-data-engine-cursors-v1', 'cursors'));
  const key = (owner: string, collection: string) => collectionHeadRef(owner, collection).id;
  return {
    async read(owner, collection) {
      const value = await get<unknown>(key(owner, collection), database());
      return value === undefined ? undefined : validate(value);
    },
    async put(owner, collection, expected, next) {
      let committed!: CollectionCursor;
      await update<CollectionCursor>(key(owner, collection), current => {
        const stored = current === undefined ? undefined : validate(current);
        if (stored?.revision !== expected?.revision || stored?.version !== expected?.version
          || stored?.initialized !== expected?.initialized) {
          throw Object.assign(new Error('Collection cursor changed; reload before retrying'), { code: 'cursor-changed' });
        }
        committed = validate({ ...next, revision: (stored?.revision ?? 0) + 1 });
        if (committed.version < (stored?.version ?? 0)) throw new Error('Collection cursor cannot regress');
        return committed;
      }, database());
      return committed;
    },
  };
}
