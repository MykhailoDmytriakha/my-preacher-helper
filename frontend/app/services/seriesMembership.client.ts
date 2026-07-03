import { doc, getDoc, writeBatch } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Series, SeriesItem, SeriesItemType } from '@/models/models';
import {
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
  removeSeriesItemByRef,
  reorderSeriesItemsById,
  upsertSeriesItem,
} from '@/utils/seriesItems';

// Playlist membership writes — the SOLE writer of `series.items[]`.
//
// Every membership mutation (add / move / remove / reorder / create-in-series)
// funnels through the client Firestore SDK here, so there is exactly ONE offline
// queue (Firestore's native IndexedDB write buffer) instead of two competing
// ones. A cross-series move is a SINGLE atomic `writeBatch` (all-or-nothing,
// and — unlike runTransaction — it works offline). Each doc the batch writes is
// read FRESH via getDoc first (never from a stale React Query snapshot), so a
// concurrent/background sync is never clobbered.
//
// The op payloads are intentionally plain, JSON-serializable data (no closures):
// a keyed mutation carrying them stays safe to persist/replay.

const SERIES_COLLECTION = 'series';

export type SeriesMembershipRef = { type: SeriesItemType; refId: string };

export type SeriesTransform =
  | { seriesId: string; op: 'add'; refs: SeriesMembershipRef[]; position?: number }
  | { seriesId: string; op: 'remove'; refs: SeriesMembershipRef[] }
  | { seriesId: string; op: 'reorder'; itemIds: string[] };

/** Firestore rejects `undefined`; drop it recursively before writing. */
function deepCleanUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepCleanUndefined(item)) as T;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deepCleanUndefined(v)])
    ) as T;
  }
  return value;
}

// Recompute the same-doc derived fields atomically alongside items so the
// server-query mirror (`sermonIds`) and UX hint (`seriesKind`) never desync —
// mirrors seriesRepository.persistSeriesItems byte-for-byte.
function recomputeDocFields(items: SeriesItem[]) {
  const normalized = normalizeSeriesItems(items);
  return deepCleanUndefined({
    items: normalized,
    sermonIds: deriveSermonIdsFromItems(normalized),
    seriesKind: inferSeriesKind(normalized),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Pure application of one transform to a list of items. Exported so the
 * optimistic cache layer can mirror EXACTLY what the batch will do to the doc.
 */
export function applySeriesTransform(currentItems: SeriesItem[], transform: SeriesTransform): SeriesItem[] {
  switch (transform.op) {
    case 'add': {
      let next = currentItems;
      transform.refs.forEach((ref) => {
        next = upsertSeriesItem(next, {
          type: ref.type,
          refId: ref.refId,
          position: transform.position,
        });
      });
      return next;
    }
    case 'remove': {
      let next = currentItems;
      transform.refs.forEach((ref) => {
        next = removeSeriesItemByRef(next, { type: ref.type, refId: ref.refId });
      });
      return next;
    }
    case 'reorder':
      return reorderSeriesItemsById(currentItems, transform.itemIds);
    default:
      return currentItems;
  }
}

/**
 * Apply a set of per-series transforms in ONE atomic `writeBatch`. Each target
 * doc is read FRESH via getDoc, the transform is applied to its current items,
 * and the doc's derived fields are recomputed. A missing doc is tolerated
 * (skipped) so a batch whose source series was concurrently deleted still
 * commits the rest instead of rejecting wholesale.
 *
 * IMPORTANT: callers must NOT await this on the interactive path — offline the
 * batch commit never resolves (it waits on the server ack) while the write is
 * durably queued in Firestore's offline buffer. Fire it and drive the UI from
 * optimistic cache writes instead.
 */
export async function commitSeriesBatch(transforms: SeriesTransform[]): Promise<void> {
  if (transforms.length === 0) return;
  const db = getClientDb();

  const snaps = await Promise.all(
    transforms.map((transform) => getDoc(doc(db, SERIES_COLLECTION, transform.seriesId)))
  );

  const batch = writeBatch(db);
  let writes = 0;
  transforms.forEach((transform, index) => {
    const snap = snaps[index];
    if (!snap.exists()) return; // tolerate a concurrently-deleted series doc
    const series = { ...(snap.data() as Omit<Series, 'id'>), id: snap.id } as Series;
    const currentItems = normalizeSeriesItems(series.items, series.sermonIds || []);
    const nextItems = applySeriesTransform(currentItems, transform);
    batch.update(doc(db, SERIES_COLLECTION, transform.seriesId), recomputeDocFields(nextItems));
    writes += 1;
  });

  if (writes === 0) return;
  await batch.commit();
}
