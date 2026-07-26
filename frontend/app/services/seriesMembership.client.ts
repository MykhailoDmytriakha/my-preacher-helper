import { doc, getDoc, runTransaction, writeBatch } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Series, SeriesItem, SeriesItemType } from '@/models/models';
import { revisionBump } from '@/services/conflictSafeUpdate.client';
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

/** Membership (`series.items`) is edited independently of the series' own text. */
export const SERIES_ITEMS_AGGREGATE = 'items';

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
  const refs = transforms.map((transform) => doc(db, SERIES_COLLECTION, transform.seriesId));

  /** Apply one transform to a document's stored state. Shared by both paths. */
  const nextFieldsFor = (index: number, data: Omit<Series, 'id'> | undefined) => {
    const series = { ...(data as Omit<Series, 'id'>), id: transforms[index].seriesId } as Series;
    const currentItems = normalizeSeriesItems(series.items, series.sermonIds || []);
    const nextItems = applySeriesTransform(currentItems, transforms[index]);
    // Membership is its own aggregate: adding a sermon must not read as a change
    // to the series title, and vice versa. The counter also keeps the freshness
    // detector honest for a reorder, which changes no length at all.
    return { ...recomputeDocFields(nextItems), ...revisionBump(SERIES_ITEMS_AGGREGATE) };
  };

  // OFFLINE: a transaction cannot run without the server, and this writer must
  // keep working offline (the whole point of firing it without awaiting). Fall
  // back to the pre-existing read + batch, exactly as before — see the note in
  // conflictSafeUpdate.client.ts about degrading openly rather than pretending.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const snaps = await Promise.all(refs.map((ref) => getDoc(ref)));
    const batch = writeBatch(db);
    let writes = 0;
    snaps.forEach((snap, index) => {
      if (!snap.exists()) return; // tolerate a concurrently-deleted series doc
      batch.update(refs[index], nextFieldsFor(index, snap.data() as Omit<Series, 'id'>));
      writes += 1;
    });
    if (writes === 0) return;
    await batch.commit();
    return;
  }

  // ONLINE: read and write inside ONE transaction. The previous read-then-batch
  // left a window where two devices both read `[A, B]`, one added C and the other
  // reordered — and the later commit dropped C without a trace. The SDK re-runs
  // this callback when a target document changed mid-flight, so the transform is
  // always applied to what is actually stored.
  await runTransaction(db, async (tx) => {
    // Firestore requires every read before any write inside a transaction.
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    snaps.forEach((snap, index) => {
      if (!snap.exists()) return; // tolerate a concurrently-deleted series doc
      tx.update(refs[index], nextFieldsFor(index, snap.data() as Omit<Series, 'id'>));
    });
  });
}
