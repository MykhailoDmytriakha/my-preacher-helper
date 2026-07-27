import { doc, getDoc, runTransaction, writeBatch } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Series, SeriesItem, SeriesItemType } from '@/models/models';
import { revisionBump } from '@/services/conflictSafeUpdate.client';
import { auth } from '@/services/firebaseAuth.service';
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
 * Apply a set of per-series transforms in ONE atomic transaction. Every target
 * doc is read INSIDE it, the transform is applied to what is actually stored, and
 * the derived fields are recomputed. A missing doc is tolerated (skipped) so a
 * batch whose source series was concurrently deleted still commits the rest.
 *
 * Offline the operations are QUEUED instead — see the check below. They are never
 * turned into a precomputed array: that array is built from a cached read and
 * would delete whatever another device added while this one was away.
 *
 * IMPORTANT: callers must NOT await this on the interactive path — offline the
 * batch commit never resolves (it waits on the server ack) while the write is
 * durably queued in Firestore's offline buffer. Fire it and drive the UI from
 * optimistic cache writes instead.
 */
/**
 * OFFLINE MEMBERSHIP QUEUE — one record per operation, per owner.
 *
 * It used to be a single mutable array under one shared key, and every part of
 * that shape was a defect adversarial review named:
 *
 *  - a `localStorage` refusal (quota, privacy mode) was caught and IGNORED, so the
 *    optimistic UI kept the membership and the mutation resolved successfully while
 *    nothing had been stored anywhere — the entry was gone after a reload. That is
 *    worse than what came before, where the write went into Firestore's own durable
 *    offline buffer;
 *  - replay removed THE WHOLE KEY after committing, so an operation queued while
 *    the commit was in flight disappeared unsubmitted;
 *  - operations carried no owner, and all accounts shared the key. Two accounts on
 *    one computer could deadlock each other for good: every replay tried to write
 *    both, and the other account's document answered `permission-denied`.
 *
 * So: each operation is its own record, stamped with the signed-in owner and an id,
 * listed and replayed only for the current owner, and removed only by id after the
 * transaction that carried it committed. Storage refusal is reported, never
 * swallowed.
 */
const MEMBERSHIP_PREFIX = 'membershipOutbox:v2:';

interface MembershipEntry {
  id: string;
  uid: string;
  transform: SeriesTransform;
  savedAt: number;
}

/** Membership storage refused the operation — the caller must NOT claim success. */
export class MembershipQueueFullError extends Error {
  constructor() {
    super('Could not store the membership change for later');
    this.name = 'MembershipQueueFullError';
  }
}

export function isMembershipQueueFullError(error: unknown): boolean {
  return (error as Error | null)?.name === 'MembershipQueueFullError';
}

function membershipStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function listMembershipEntries(uid: string): MembershipEntry[] {
  const store = membershipStore();
  if (!store) return [];
  const entries: MembershipEntry[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key?.startsWith(MEMBERSHIP_PREFIX)) continue;
    try {
      const parsed = JSON.parse(store.getItem(key) as string) as MembershipEntry;
      if (parsed?.uid === uid) entries.push(parsed);
    } catch {
      /* skip an unreadable record rather than discarding the whole queue */
    }
  }
  return entries.sort((a, b) => a.savedAt - b.savedAt);
}

/** Offline membership operations for one owner, oldest first. Never throws. */
export function listMembershipTransforms(uid: string): SeriesTransform[] {
  return listMembershipEntries(uid).map((entry) => entry.transform);
}

function enqueueMembershipTransforms(uid: string, transforms: SeriesTransform[]): void {
  const store = membershipStore();
  if (!store) throw new MembershipQueueFullError();
  // ALL OR NOTHING. A move is two operations — add to the target, remove from the
  // source — and storing only the first one is worse than storing neither: the UI
  // reports a failure, then a reconnect quietly applies the half that got through
  // and the sermon ends up in BOTH series. HEAD sent one atomic batch; this keeps
  // that property in the queue.
  const written: string[] = [];
  try {
    transforms.forEach((transform, index) => {
      const id = `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      store.setItem(
        `${MEMBERSHIP_PREFIX}${id}`,
        JSON.stringify({ id, uid, transform, savedAt: Date.now() } satisfies MembershipEntry)
      );
      written.push(id);
    });
  } catch {
    written.forEach((id) => {
      try {
        store.removeItem(`${MEMBERSHIP_PREFIX}${id}`);
      } catch {
        /* nothing better to do; the throw below still tells the truth */
      }
    });
    // Do not pretend. The caller shows a real failure and keeps the change on
    // screen as unsaved, instead of a success that evaporates on reload.
    throw new MembershipQueueFullError();
  }
}

/**
 * Re-apply this owner's queued membership operations to what is ACTUALLY stored.
 *
 * Records are removed BY ID and only after the transaction that carried them
 * committed, so an operation queued while the commit was in flight stays queued
 * instead of vanishing unsubmitted. A failure keeps everything, so a person's
 * offline "add this sermon to the series" is never silently forgotten.
 */
export async function replayMembershipOutbox(uid: string | null | undefined): Promise<number> {
  if (!uid) return 0;
  const entries = listMembershipEntries(uid);
  if (entries.length === 0) return 0;

  /**
   * ONE ENVELOPE AT A TIME — a dead operation must not poison the live ones.
   *
   * Replaying the whole queue as a single batch looked tidy and was a hard-law
   * regression: the ninth review showed that one operation whose target series had
   * been deleted elsewhere made the commit throw, rolling back a perfectly good
   * addition to a DIFFERENT series — and then repeating the same poisoned batch every
   * minute, forever. HEAD skipped a missing document, so the independent operation
   * still landed.
   *
   * Each entry now commits on its own: a failure keeps ITS record and leaves the
   * others alone.
   */
  const store = membershipStore();
  let replayed = 0;
  for (const entry of entries) {
    try {
      await commitSeriesBatch([entry.transform]);
      try {
        store?.removeItem(`${MEMBERSHIP_PREFIX}${entry.id}`);
      } catch {
        /* it already landed; a leftover record replays as a no-op */
      }
      replayed += 1;
    } catch (error) {
      // Kept for the next drain. Nothing else in the queue is affected.
      console.error('membershipOutbox: replay failed for', entry.id, error);
    }
  }
  return replayed;
}

export async function commitSeriesBatch(transforms: SeriesTransform[]): Promise<void> {
  if (transforms.length === 0) return;
  const db = getClientDb();

  /**
   * ONE ENTRY PER SERIES, with every transform for it in order.
   *
   * Grouping is not tidiness — it is the difference between keeping both operations
   * and losing one. Add sermon A to a series offline, then add B: the queue holds
   * two transforms for the SAME document. Applied separately, both computed their
   * new item list from the same stored value and both wrote the whole list, so the
   * second write erased the first — and then the replay deleted both queue records
   * as "committed". Reduced in sequence over one read, both survive.
   */
  const grouped = new Map<string, SeriesTransform[]>();
  transforms.forEach((transform) => {
    const forSeries = grouped.get(transform.seriesId) ?? [];
    forSeries.push(transform);
    grouped.set(transform.seriesId, forSeries);
  });
  const seriesIds = [...grouped.keys()];
  const refs = seriesIds.map((seriesId) => doc(db, SERIES_COLLECTION, seriesId));

  /** Apply EVERY transform for one document to its stored state, in order. */
  const nextFieldsFor = (index: number, data: Omit<Series, 'id'> | undefined) => {
    const seriesId = seriesIds[index];
    const series = { ...(data as Omit<Series, 'id'>), id: seriesId } as Series;
    let items = normalizeSeriesItems(series.items, series.sermonIds || []);
    (grouped.get(seriesId) ?? []).forEach((transform) => {
      items = applySeriesTransform(items, transform);
    });
    // Membership is its own aggregate: adding a sermon must not read as a change
    // to the series title, and vice versa. The counter also keeps the freshness
    // detector honest for a reorder, which changes no length at all.
    return { ...recomputeDocFields(items), ...revisionBump(SERIES_ITEMS_AGGREGATE) };
  };

  // OFFLINE: a transaction cannot run without the server, and this writer must
  // keep working offline (the whole point of firing it without awaiting). Fall
  // back to the pre-existing read + batch, exactly as before — see the note in
  // conflictSafeUpdate.client.ts about degrading openly rather than pretending.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // Queue the OPERATION, never a computed array.
    //
    // The old offline path read the cached document, built the whole new item list
    // from it and queued that array. Hours later it landed and silently deleted
    // whatever the other device had added in between — a person adding a sermon
    // from the train erased one added from the phone. Storing the transform instead
    // means `replayMembershipOutbox` re-applies it to whatever is ACTUALLY stored,
    // through the same transaction, so both changes survive.
    // Stamped with the SIGNED-IN owner: a shared queue let one account's stuck
    // operation block another's for good (`permission-denied` on every replay).
    const actorUid = auth.currentUser?.uid;
    if (actorUid) {
      try {
        enqueueMembershipTransforms(actorUid, transforms);
        return;
      } catch {
        // Storage refused the semantic intent. Do NOT refuse the save: HEAD stored it
        // durably with a Firestore batched write, and batched writes DO execute
        // offline — refusing here would be strictly worse than before (a legitimate
        // membership change simply denied). Fall back to that path, accepting its
        // known weakness (a computed array can replace a concurrent change), and say
        // so rather than pretending the intent was queued.
        console.error('membershipOutbox: no room for the intent, falling back to a batched write');
      }
    }
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
  try {
    await runTransaction(db, async (tx) => {
      // Firestore requires every read before any write inside a transaction.
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      snaps.forEach((snap, index) => {
        if (!snap.exists()) {
          // A missing SOURCE is fine — there is nothing left to remove from. A
          // missing TARGET is not: skipping it while the source removal commits
          // reported success and left the sermon in NEITHER series. Aborting keeps
          // the operation whole, and the queue keeps it for a later decision.
          const addsHere = (grouped.get(seriesIds[index]) ?? []).some(
            (transform) => transform.op === 'add'
          );
          if (addsHere) {
            throw new Error(`Series ${seriesIds[index]} not found`);
          }
          return;
        }
        tx.update(refs[index], nextFieldsFor(index, snap.data() as Omit<Series, 'id'>));
      });
    });
  } catch (error) {
    // NO fallback here, deliberately. Adversarial review showed why: the batch
    // path rebuilds the item list from a CACHED read, so when the server has
    // already moved on it writes a stale full array and DELETES what the other
    // device added. Failing loudly is what this writer did before it became
    // transactional in the nominally-online case, and it is the honest outcome —
    // membership is a rare, manual action, and losing someone else's entry to
    // "help" is worse than telling the person it did not go through.
    //
    // The genuinely-offline case never reaches here: it took the queued batch
    // above, exactly as it always did.
    throw error;
  }
}
