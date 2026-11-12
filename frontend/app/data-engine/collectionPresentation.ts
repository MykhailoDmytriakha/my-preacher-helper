import type { CollectionState } from './collections';
import type { DocumentData } from './types';

export type CollectionPresentationRow = { value: DocumentData | null; deleting?: boolean };

/** Only ordinary presentation: the raw row stays available to presence, delivery and recovery. */
export function isLiveCollectionDocument<T extends CollectionPresentationRow>(row: T): row is T & { value: DocumentData } {
  return row.value != null && !row.deleting;
}


/** Keep absence and confirmed removal separate when projecting a reference list. */
export function knownCollectionRemovals(state?: CollectionState | null): ReadonlySet<string> {
  const removed = new Set(state?.snapshots.filter(snapshot => snapshot.metadata?.deleted).map(snapshot => snapshot.resource.id));
  for (const row of state?.documents ?? []) {
    if (row.deleting || row.acknowledged?.metadata?.deleted) removed.add(row.resource.id);
  }
  return removed;
}
