import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import {
  applySeriesTransform,
  commitSeriesBatch,
  type SeriesMembershipRef,
  type SeriesTransform,
} from '@/services/seriesMembership.client';
import {
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
} from '@/utils/seriesItems';
import { seriesContainsRef } from '@/utils/seriesMembership';

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

  const sweep = useMutation<void, Error, SeriesTransform[]>({
    mutationKey: SERIES_MEMBERSHIP_MUTATION_KEY,
    mutationFn: (transforms) => commitSeriesBatch(transforms),
    onError: () => {
      // Online failure -> reconcile from the server. Offline this is a no-op
      // (useServerFirstQuery disables the query) and the write stays queued.
      queryClient.invalidateQueries({ queryKey: seriesListKey(uid) });
    },
  });

  const loadedSeries = useCallback(
    (): Series[] => queryClient.getQueryData<Series[]>(seriesListKey(uid)) ?? [],
    [queryClient, uid]
  );

  // Series (other than the target) that the loaded list says contain a given ref.
  const sourceSeriesIdsFor = useCallback(
    (refId: string, targetSeriesId: string | undefined): string[] =>
      loadedSeries()
        .filter((series) => series.id !== targetSeriesId && seriesContainsRef(series, refId))
        .map((series) => series.id),
    [loadedSeries]
  );

  const runSweep = useCallback(
    (transforms: SeriesTransform[]) => {
      if (transforms.length === 0) return;
      writeOptimisticCaches(queryClient, uid, transforms);
      // Fire-and-forget: the promise is intentionally not awaited.
      sweep.mutate(transforms);
    },
    [queryClient, sweep, uid]
  );

  /**
   * Add (or MOVE) a ref into `targetSeriesId`. One-to-one is enforced: the ref
   * is removed from every OTHER series it currently sits in — same atomic batch.
   */
  const addToSeries = useCallback(
    (targetSeriesId: string, ref: SeriesMembershipRef, position?: number) => {
      const transforms: SeriesTransform[] = [
        { seriesId: targetSeriesId, op: 'add', refs: [ref], position },
        ...sourceSeriesIdsFor(ref.refId, targetSeriesId).map(
          (seriesId): SeriesTransform => ({ seriesId, op: 'remove', refs: [ref] })
        ),
      ];
      runSweep(transforms);
    },
    [runSweep, sourceSeriesIdsFor]
  );

  /**
   * Multi-add: put every ref into `targetSeriesId` in ONE union-sweep batch (never
   * N parallel sweeps, which would clobber the target doc). Each source series
   * drops only the refs it actually holds.
   */
  const addRefsToSeries = useCallback(
    (targetSeriesId: string, refs: SeriesMembershipRef[]) => {
      if (refs.length === 0) return;
      const sourceRemovals = new Map<string, SeriesMembershipRef[]>();
      loadedSeries().forEach((series) => {
        if (series.id === targetSeriesId) return;
        const held = refs.filter((ref) => seriesContainsRef(series, ref.refId));
        if (held.length > 0) {
          sourceRemovals.set(series.id, held);
        }
      });

      const transforms: SeriesTransform[] = [
        { seriesId: targetSeriesId, op: 'add', refs },
        ...Array.from(sourceRemovals.entries()).map(
          ([seriesId, removeRefs]): SeriesTransform => ({
            seriesId,
            op: 'remove',
            refs: removeRefs,
          })
        ),
      ];
      runSweep(transforms);
    },
    [loadedSeries, runSweep]
  );

  /** Remove a ref from EVERY series that contains it (sweep-all). */
  const removeFromAllSeries = useCallback(
    (ref: SeriesMembershipRef) => {
      const transforms: SeriesTransform[] = loadedSeries()
        .filter((series) => seriesContainsRef(series, ref.refId))
        .map((series): SeriesTransform => ({ seriesId: series.id, op: 'remove', refs: [ref] }));
      runSweep(transforms);
    },
    [loadedSeries, runSweep]
  );

  /** Reorder items within a single series (own-doc). */
  const reorderSeries = useCallback(
    (seriesId: string, itemIds: string[]) => {
      runSweep([{ seriesId, op: 'reorder', itemIds }]);
    },
    [runSweep]
  );

  return { addToSeries, addRefsToSeries, removeFromAllSeries, reorderSeries };
}
