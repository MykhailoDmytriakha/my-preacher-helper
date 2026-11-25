/** Native index for the verified owner and collection of each saved request. */
export const COLLECTION_COMMIT_INDEX = 'request-owner-collection';

/** The native index updates in the same transaction even for a writer from an older bundle. */
export function initializeCollectionCommitIndex(store: IDBObjectStore): void {
  if (!store.indexNames.contains(COLLECTION_COMMIT_INDEX)) {
    store.createIndex(COLLECTION_COMMIT_INDEX, ['owner', 'baseline.resource.collection']);
  }
}
