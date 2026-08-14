import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { getAllGroups } from '@/services/groups.service';
import { getAllSeries } from '@/services/series.service';
import {
  applySeriesTransform,
  commitSeriesBatch,
  isMembershipQueueFullError,
  type SeriesMembershipRef,
  type SeriesTransform,
} from '@/services/seriesMembership.client';
import { reconcileServerList, type VersionedCopy } from '@/utils/readFreshness';
import {
  persistedWrite,
  queuedMutation,
  skippedWrite,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import {
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
} from '@/utils/seriesItems';
import { seriesContainsRef } from '@/utils/seriesMembership';
import { getSermons } from '@services/sermon.service';

import type { Group, Series, SeriesItem, Sermon } from '@/models/models';
import type { QueryClient } from '@tanstack/react-query';

// The ONE writer of series.items — a keyed, fire-and-forget mutation. Its only
// job online is onError -> refetch (offline that refetch is a no-op, but the
// write is durably queued in Firestore's offline buffer and the optimistic cache
// writes below keep the UI truthful). We never `await` the commit on the
// interactive path, because offline it never resolves (it waits on the server
// ack) — awaiting would hang the UI. Durability lives in Firestore's queue, not
// React Query, so this mutation is deliberately NOT registered as a persisted
// default.
export const SERIES_MEMBERSHIP_MUTATION_KEY = ['series', 'membership', 'sweep'] as const;

type ResolvedSeriesItem = {
  item: SeriesItem;
  sermon?: Sermon;
  group?: Group;
};

type SeriesDetailPayload = {
  series: Series;
  items: ResolvedSeriesItem[];
  sermons: Sermon[];
  groups: Group[];
};

const seriesListKey = (uid: string | undefined) => ['series', uid] as const;
const seriesDetailKey = (seriesId: string) => ['series-detail', seriesId] as const;

const sweepReceipt = (transforms: SeriesTransform[]) =>
  transforms
    .map((transform) =>
      transform.op === 'reorder'
        ? `${transform.seriesId}:reorder:${transform.itemIds.join(',')}`
        : `${transform.seriesId}:${transform.op}:${transform.refs
            .map((ref) => `${ref.type}-${ref.refId}`)
            .join(',')}`
    )
    .join('|');

/**
 * The fresh owner snapshot is asynchronous, but `queued` is only honest once it
 * has produced transforms and React Query owns the sweep. Compose the canonical
 * submission instead of claiming acceptance while that snapshot is still loading.
 */
function afterSweepIsScheduled(start: Promise<WriteSubmission>): WriteSubmission {
  const acceptance = start.then((submission) => submission.acceptance);
  const persistence = start.then((submission) => submission.persistence);
  void acceptance.catch(() => undefined);
  void persistence.catch(() => undefined);
  return { acceptance, persistence };
}

/**
 * Refreshes one owner list without letting a failed read erase what the screen
 * already has. The cache is read after the request resolves because an edit may
 * land while the request is in flight, and that newest local state is the copy the
 * freshness decision must protect.
 */
async function refreshCachedList<T extends VersionedCopy & { id: string }>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  fetchServer: () => Promise<T[]>
): Promise<T[]> {
  try {
    const server = await fetchServer();
    const stored = queryClient.getQueryData<T[]>(queryKey) ?? [];
    const reconciled = reconcileServerList(server, stored);
    queryClient.setQueryData(queryKey, reconciled);
    return reconciled;
  } catch {
    return queryClient.getQueryData<T[]>(queryKey) ?? [];
  }
}

// Minimal, filter-surviving stubs for a ref whose full object is not yet in the
// client cache (e.g. a just-created sermon). buildPayload drops items whose
// resolved object is missing; a stub keeps an offline ADD visible until the real
// object hydrates.
const stubSermon = (id: string): Sermon => ({
  id,
  title: '',
  verse: '',
  date: '',
  thoughts: [],
  userId: '',
});
const stubGroup = (id: string): Group =>
  ({
    id,
    userId: '',
    title: '',
    status: 'draft',
    templates: [],
    flow: [],
    createdAt: '',
    updatedAt: '',
  }) as Group;

function recompute(series: Series, nextItems: SeriesItem[]): Series {
  const items = normalizeSeriesItems(nextItems);
  return {
    ...series,
    items,
    sermonIds: deriveSermonIdsFromItems(items),
    seriesKind: inferSeriesKind(items),
    updatedAt: new Date().toISOString(),
  };
}

// Rebuild a resolved series-detail payload from the new series items + whatever
// sermon/group objects the client already has cached, so the detail page stays
// truthful offline (no server round-trip).
function rebuildDetailPayload(
  prev: SeriesDetailPayload,
  nextSeries: Series,
  sermonsCache: Sermon[],
  groupsCache: Group[]
): SeriesDetailPayload {
  const items = normalizeSeriesItems(nextSeries.items, nextSeries.sermonIds || []);
  const sermonById = new Map<string, Sermon>([
    ...prev.sermons.map((sermon) => [sermon.id, sermon] as const),
    ...sermonsCache.map((sermon) => [sermon.id, sermon] as const),
  ]);
  const groupById = new Map<string, Group>([
    ...prev.groups.map((group) => [group.id, group] as const),
    ...groupsCache.map((group) => [group.id, group] as const),
  ]);

  const resolved: ResolvedSeriesItem[] = items.map((item) =>
    item.type === 'sermon'
      ? { item, sermon: sermonById.get(item.refId) ?? stubSermon(item.refId) }
      : { item, group: groupById.get(item.refId) ?? stubGroup(item.refId) }
  );

  return {
    series: { ...prev.series, ...nextSeries, items, sermonIds: deriveSermonIdsFromItems(items) },
    items: resolved,
    sermons: resolved
      .filter((entry) => entry.item.type === 'sermon')
      .map((entry) => entry.sermon as Sermon),
    groups: resolved
      .filter((entry) => entry.item.type === 'group')
      .map((entry) => entry.group as Group),
  };
}

// Apply the transforms optimistically to every cache that renders membership:
//   - ['series', uid]                       (list — drives every derived badge)
//   - ['series-detail', X] for each touched X (resolved detail payload)
// The group path additionally has no cache to touch: groups/[id] derives its
// series binding from the ['series', uid] list, so updating that list suffices.
function writeOptimisticCaches(
  queryClient: QueryClient,
  uid: string | undefined,
  transforms: SeriesTransform[]
) {
  const sermonsCache = queryClient.getQueryData<Sermon[]>(['sermons', uid]) ?? [];
  const groupsCache = queryClient.getQueryData<Group[]>(['groups', uid]) ?? [];

  const nextBySeriesId = new Map<string, Series>();

  queryClient.setQueryData<Series[]>(seriesListKey(uid), (list) => {
    if (!list) return list;
    return list.map((series) => {
      const transform = transforms.find((entry) => entry.seriesId === series.id);
      if (!transform) return series;
      const currentItems = normalizeSeriesItems(series.items, series.sermonIds || []);
      const nextSeries = recompute(series, applySeriesTransform(currentItems, transform));
      nextBySeriesId.set(series.id, nextSeries);
      return nextSeries;
    });
  });

  // A target series may not be in the list cache yet (rare) — still update its
  // detail cache from a fresh computation off the current detail payload.
  transforms.forEach((transform) => {
    queryClient.setQueryData<SeriesDetailPayload | null | undefined>(
      seriesDetailKey(transform.seriesId),
      (prev) => {
        if (!prev) return prev;
        const currentItems = normalizeSeriesItems(prev.series.items, prev.series.sermonIds || []);
        const nextSeries =
          nextBySeriesId.get(transform.seriesId) ??
          recompute(prev.series, applySeriesTransform(currentItems, transform));
        return rebuildDetailPayload(prev, nextSeries, sermonsCache, groupsCache);
      }
    );
  });
}

type MembershipCacheSnapshot = {
  list?: Series[];
  details: Map<string, SeriesDetailPayload | null | undefined>;
};

function snapshotMembershipCaches(
  queryClient: QueryClient,
  uid: string | undefined,
  transforms: SeriesTransform[]
): MembershipCacheSnapshot {
  return {
    list: queryClient.getQueryData<Series[]>(seriesListKey(uid)),
    details: new Map(
      transforms.map((transform) => [
        transform.seriesId,
        queryClient.getQueryData<SeriesDetailPayload | null | undefined>(
          seriesDetailKey(transform.seriesId)
        ),
      ])
    ),
  };
}

function restoreMembershipCaches(
  queryClient: QueryClient,
  uid: string | undefined,
  snapshot: MembershipCacheSnapshot | undefined
): void {
  if (!snapshot) return;
  if (snapshot.list !== undefined) {
    queryClient.setQueryData(seriesListKey(uid), snapshot.list);
  }
  snapshot.details.forEach((detail, seriesId) => {
    if (detail !== undefined) {
      queryClient.setQueryData(seriesDetailKey(seriesId), detail);
    }
  });
}

/**
 * Playlist membership operations — the single client-side writer of
 * `series.items[]`. Every op:
 *   1. builds a SERIALIZABLE transform set (one-to-one enforced BY CONSTRUCTION —
 *      a ref is removed from every series ≠ target in the same batch);
 *   2. writes the optimistic caches synchronously;
 *   3. fires the sweep mutation (never awaited on the interactive path).
 */
export function useSeriesMembership() {
  const queryClient = useQueryClient();
  const { uid } = useResolvedUid();
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  const sweep = useMutation<void, Error, SeriesTransform[], MembershipCacheSnapshot>({
    mutationKey: SERIES_MEMBERSHIP_MUTATION_KEY,
    mutationFn: (transforms) => commitSeriesBatch(transforms),
    onMutate: (transforms) => {
      const snapshot = snapshotMembershipCaches(queryClient, uid, transforms);
      writeOptimisticCaches(queryClient, uid, transforms);
      return snapshot;
    },
    onSuccess: (_data, transforms) => {
      // Reconcile is bound to the real commit ack (not a guessed setTimeout): pull
      // the authoritative detail for every touched series, so a create-in-series
      // shows the real object instead of the optimistic stub. Offline this is a
      // no-op; the optimistic caches already hold the truth until reconnect.
      transforms.forEach((transform) =>
        queryClient.invalidateQueries({ queryKey: seriesDetailKey(transform.seriesId) })
      );
    },
    onError: (error, transforms, snapshot) => {
      // A membership change that could NOT even be stored for later must be said
      // out loud. The queue used to swallow a storage refusal, so the screen kept
      // the new membership, the mutation resolved, and a reload showed it gone.
      // ONE reporter per refusal. A terminal refusal of an ADD is reported by
      // useSeriesDetail's recovery toast, which also carries the item names and a
      // retry; duplicating it here would show the same refusal twice. What that
      // subscription does NOT cover is a queue that could not even store the intent,
      // so this stays.
      if (isMembershipQueueFullError(error)) toast.error(t('common.saveError'));
      // Refetch can also be refused or unavailable. Restore our own snapshots
      // first, so a rejected move never remains as an optimistic lie on screen.
      restoreMembershipCaches(queryClient, uid, snapshot);
      // Online failure -> reconcile from the server (list + every touched detail).
      // Offline this is a no-op (useServerFirstQuery disables the query) and the
      // write stays queued.
      queryClient.invalidateQueries({ queryKey: seriesListKey(uid) });
      transforms.forEach((transform) =>
        queryClient.invalidateQueries({ queryKey: seriesDetailKey(transform.seriesId) })
      );
    },
  });

  const loadedSeries = useCallback(
    (): Series[] => queryClient.getQueryData<Series[]>(seriesListKey(uid)) ?? [],
    [queryClient, uid]
  );

  // Run `build` with a reconciled owner snapshot. Online, all three lists are read
  // because series membership decides both which series must change and which
  // sermon/group objects the optimistic detail screen renders. Offline, the stored
  // lists are the answer and no service is touched. A failed online read falls back
  // to the stored list without blanking the existing screen.
  const withSeries = useCallback(
    (build: (series: Series[]) => WriteSubmission): Promise<WriteSubmission> => {
      if (!isOnline || !uid) {
        return Promise.resolve(build(loadedSeries()));
      }

      return Promise.all([
        refreshCachedList(queryClient, seriesListKey(uid), () => getAllSeries(uid)),
        refreshCachedList(queryClient, ['sermons', uid], () => getSermons(uid)),
        refreshCachedList(queryClient, ['groups', uid], () => getAllGroups(uid)),
      ]).then(([series]) => build(series));
    },
    [isOnline, loadedSeries, queryClient, uid]
  );

  const runSweep = useCallback(
    (transforms: SeriesTransform[]): WriteSubmission => {
      if (transforms.length === 0) return skippedWrite();
      const request = sweep.mutateAsync(transforms);
      // Offline, commitSeriesBatch stores an operation in the membership outbox (or
      // Firestore's persistent write queue). Online it is a transaction, which is
      // neither replayable nor retained by React Query after this tab closes.
      const durableOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return durableOffline
        ? queuedMutation(`series:membership:${sweepReceipt(transforms)}`, request)
        : persistedWrite(request);
    },
    [sweep]
  );

  const itemLabels = useCallback(
    (transforms: SeriesTransform[]) => {
      const sermons = queryClient.getQueryData<Sermon[]>(['sermons', uid]) ?? [];
      const groups = queryClient.getQueryData<Group[]>(['groups', uid]) ?? [];
      const series = queryClient.getQueryData<Series[]>(seriesListKey(uid)) ?? [];
      const labels: string[] = [];

      transforms.forEach((transform) => {
        if (transform.op === 'reorder') {
          const owner = series.find((entry) => entry.id === transform.seriesId);
          const byItemId = new Map(
            normalizeSeriesItems(owner?.items, owner?.sermonIds || []).map((item) => [item.id, item])
          );
          transform.itemIds.forEach((itemId) => {
            const item = byItemId.get(itemId);
            if (!item) return;
            const title =
              item.type === 'sermon'
                ? sermons.find((sermon) => sermon.id === item.refId)?.title
                : groups.find((group) => group.id === item.refId)?.title;
            if (title) labels.push(title);
          });
          return;
        }

        transform.refs.forEach((ref) => {
          const title =
            ref.type === 'sermon'
              ? sermons.find((sermon) => sermon.id === ref.refId)?.title
              : groups.find((group) => group.id === ref.refId)?.title;
          if (title) labels.push(title);
        });
      });

      return Array.from(new Set(labels)).join(', ');
    },
    [queryClient, uid]
  );

  // Membership has one writer, so it has one recovery owner. This covers adds
  // from the series page, group page and dashboard, plus remove and reorder;
  // a page-local subscription cannot see all of those surfaces reliably.
  useWriteRecovery<SeriesTransform[]>(queryClient, {
    mutationKey: SERIES_MEMBERSHIP_MUTATION_KEY,
    fallbackTitleKey: 'common.saveError',
    recoveryText: itemLabels,
    toastId: (transforms) => `write-recovery:series:membership:${sweepReceipt(transforms)}`,
    // The check below reads the series list, which may still be loading when a restored
    // failure is first examined.
    ownershipEpoch: `${uid ?? ''}:${(queryClient.getQueryData<Series[]>(seriesListKey(uid)) ?? [])
      .map((entry) => entry.id)
      .join(',')}`,
    /**
     * Every touched series must be in THIS person's list. Failed sweeps persist in the
     * shared IndexedDB cache across sign-outs, and their recovery text is the titles of
     * the moved items — so an unguarded descriptor reads the previous account's content
     * aloud to the next one.
     */
    owns: (transforms) => {
      if (!uid) return false;
      const mine = queryClient.getQueryData<Series[]>(seriesListKey(uid)) ?? [];
      if (mine.length === 0) return false;
      return transforms.every((transform) => mine.some((entry) => entry.id === transform.seriesId));
    },
    retry: (transforms) => {
      // A recovery action has no editor waiting on a submission. Re-run the same
      // mutation directly so React Query owns the retry immediately.
      sweep.mutate(transforms);
    },
  });

  /**
   * Add (or MOVE) a ref into `targetSeriesId`. One-to-one is enforced: the ref
   * is removed from every OTHER series it currently sits in — same atomic batch.
   */
  const addToSeries = useCallback(
    (targetSeriesId: string, ref: SeriesMembershipRef, position?: number): WriteSubmission => {
      return afterSweepIsScheduled(withSeries((series) => {
        const sourceRemovals = series
          .filter((s) => s.id !== targetSeriesId && seriesContainsRef(s, ref.refId))
          .map((s): SeriesTransform => ({ seriesId: s.id, op: 'remove', refs: [ref] }));
        return runSweep([
          { seriesId: targetSeriesId, op: 'add', refs: [ref], position },
          ...sourceRemovals,
        ]);
      }));
    },
    [withSeries, runSweep]
  );

  /**
   * Multi-add: put every ref into `targetSeriesId` in ONE union-sweep batch (never
   * N parallel sweeps, which would clobber the target doc). Each source series
   * drops only the refs it actually holds.
   */
  const addRefsToSeries = useCallback(
    (targetSeriesId: string, refs: SeriesMembershipRef[]): WriteSubmission => {
      if (refs.length === 0) return skippedWrite();
      return afterSweepIsScheduled(withSeries((series) => {
        const sourceRemovals = new Map<string, SeriesMembershipRef[]>();
        series.forEach((s) => {
          if (s.id === targetSeriesId) return;
          const held = refs.filter((ref) => seriesContainsRef(s, ref.refId));
          if (held.length > 0) {
            sourceRemovals.set(s.id, held);
          }
        });

        return runSweep([
          { seriesId: targetSeriesId, op: 'add', refs },
          ...Array.from(sourceRemovals.entries()).map(
            ([seriesId, removeRefs]): SeriesTransform => ({
              seriesId,
              op: 'remove',
              refs: removeRefs,
            })
          ),
        ]);
      }));
    },
    [withSeries, runSweep]
  );

  /** Remove a ref from EVERY series that contains it (sweep-all). */
  const removeFromAllSeries = useCallback(
    (ref: SeriesMembershipRef): WriteSubmission => {
      // withSeries falls back to a fresh SDK read when the list cache is cold, so a
      // remove-from-all issued before the list loads discovers memberships instead
      // of silently no-op'ing (the D3 warn is no longer needed — an empty fresh
      // read genuinely means the ref is in no series).
      return afterSweepIsScheduled(withSeries((series) => {
        const transforms: SeriesTransform[] = series
          .filter((entry) => seriesContainsRef(entry, ref.refId))
          .map((entry): SeriesTransform => ({ seriesId: entry.id, op: 'remove', refs: [ref] }));
        return runSweep(transforms);
      }));
    },
    [withSeries, runSweep]
  );

  /** Reorder items within a single series (own-doc). */
  const reorderSeries = useCallback(
    (seriesId: string, itemIds: string[]): WriteSubmission => {
      return runSweep([{ seriesId, op: 'reorder', itemIds }]);
    },
    [runSweep]
  );

  return { addToSeries, addRefsToSeries, removeFromAllSeries, reorderSeries };
}
