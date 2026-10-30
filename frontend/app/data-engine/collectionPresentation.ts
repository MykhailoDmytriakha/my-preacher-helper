import type { DocumentData } from './types';

export type CollectionPresentationRow = { value: DocumentData | null; deleting?: boolean };

/** Only ordinary presentation: the raw row stays available to presence, delivery and recovery. */
export function isLiveCollectionDocument<T extends CollectionPresentationRow>(row: T): row is T & { value: DocumentData } {
  return row.value != null && !row.deleting;
}
