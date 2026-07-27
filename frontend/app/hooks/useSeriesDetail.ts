import { useQueryClient } from '@tanstack/react-query';
import i18n from 'i18next';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { normalizeSeriesItems } from '@/utils/seriesItems';
import { getGroupById } from '@services/groups.service';
import { getSeriesById, SERIES_META_AGGREGATE, updateSeries } from '@services/series.service';
import { getSermonById } from '@services/sermon.service';

import type { Group, Series, SeriesItem, Sermon } from '@/models/models';

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

const QUERY_KEYS = {
  SERIES_DETAIL: 'series-detail',
} as const;

// Stable empty fallbacks. `data?.x ?? []` would mint a NEW array every render
// when the query has no data (loading / error / offline-disabled query). That
// fresh `items` ref feeds the detail page's `useEffect([items, isRefetching])`
// (setOptimisticItems) and, once the query settles without data (e.g. a transient
// permission error, or offline where the query is disabled), drives an INFINITE
// setState render loop that turns a recoverable error into a dead page. Referential
// stability across renders removes the loop entirely.
const EMPTY_ITEMS: ResolvedSeriesItem[] = [];
const EMPTY_SERMONS: Sermon[] = [];
const EMPTY_GROUPS: Group[] = [];

const buildPayload = async (seriesData: Series): Promise<SeriesDetailPayload> => {
  const normalizedItems = normalizeSeriesItems(seriesData.items, seriesData.sermonIds || []);
  const sermonIds = Array.from(
    new Set(normalizedItems.filter((entry) => entry.type === 'sermon').map((entry) => entry.refId))
  );
  const groupIds = Array.from(
    new Set(normalizedItems.filter((entry) => entry.type === 'group').map((entry) => entry.refId))
  );

  const [sermonResults, groupResults] = await Promise.all([
    Promise.all(sermonIds.map((id) => getSermonById(id))),
    Promise.all(groupIds.map((id) => getGroupById(id))),
  ]);

  const sermons = sermonResults.filter((sermon): sermon is Sermon => Boolean(sermon));
  const groups = groupResults.filter((group): group is Group => Boolean(group));

  const sermonById = new Map(sermons.map((sermon) => [sermon.id, sermon]));
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const items = normalizedItems
    .map((item) => ({
      item,
      sermon: item.type === 'sermon' ? sermonById.get(item.refId) : undefined,
      group: item.type === 'group' ? groupById.get(item.refId) : undefined,
    }))
    .filter((entry) => (entry.item.type === 'sermon' ? Boolean(entry.sermon) : Boolean(entry.group)));

  return {
    series: { ...seriesData, items: normalizedItems, sermonIds: sermonIds },
    items,
    sermons,
    groups,
  };
};

export function useSeriesDetail(seriesId: string) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const { addToSeries, addRefsToSeries, removeFromAllSeries, reorderSeries } = useSeriesMembership();

  const { data, isLoading, isFetching, error, refetch } = useServerFirstQuery<SeriesDetailPayload | null>({
    queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId],
    enabled: !!seriesId,
    queryFn: async () => {
      if (!seriesId) return null;
      const seriesData = await getSeriesById(seriesId);
      if (!seriesData) {
        throw new Error('Series not found');
      }

      return buildPayload(seriesData);
    },
  });

  const series = data?.series ?? null;
  const items = data?.items ?? EMPTY_ITEMS;
  const sermons = data?.sermons ?? EMPTY_SERMONS;
  const groups = data?.groups ?? EMPTY_GROUPS;

  const refreshSeriesDetail = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const withMutationGuard = useCallback(async (action: () => Promise<void>) => {
    setMutationError(null);
    try {
      await action();
      await refetch();
    } catch (errorValue: unknown) {
      const normalized = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
      setMutationError(normalized);
      throw normalized;
    }
  }, [refetch]);

  // Membership writes go through the client playlist sweep (the SOLE writer of
  // series.items). Each is fire-and-forget + optimistic (the sweep updates the
  // ['series'] list and every affected ['series-detail'] cache), so they work
  // offline and never hang awaiting the network.
  const addSermon = useCallback(
    (sermonId: string, position?: number) => {
      if (!series) return;
      addToSeries(series.id, { type: 'sermon', refId: sermonId }, position);
    },
    [series, addToSeries]
  );

  const addSermons = useCallback(
    (sermonIds: string[]) => {
      if (!series) return;
      // ONE union-sweep batch (never N parallel sweeps that would clobber the target).
      addRefsToSeries(
        series.id,
        sermonIds.map((sermonId) => ({ type: 'sermon' as const, refId: sermonId }))
      );
    },
    [series, addRefsToSeries]
  );

  const addGroup = useCallback(
    (groupId: string, position?: number) => {
      if (!series) return;
      addToSeries(series.id, { type: 'group', refId: groupId }, position);
    },
    [series, addToSeries]
  );

  const addGroups = useCallback(
    (groupIds: string[]) => {
      if (!series) return;
      // ONE union-sweep batch — never N parallel sweeps (which clobber the target doc).
      addRefsToSeries(
        series.id,
        groupIds.map((groupId) => ({ type: 'group' as const, refId: groupId }))
      );
    },
    [series, addRefsToSeries]
  );

  const removeItem = useCallback(
    (type: 'sermon' | 'group', refId: string) => {
      if (!series) return;
      removeFromAllSeries({ type, refId });
    },
    [series, removeFromAllSeries]
  );

  const removeSermon = useCallback(
    (sermonId: string) => removeItem('sermon', sermonId),
    [removeItem]
  );

  const reorderSeriesSermons = useCallback(
    (sermonIds: string[]) => {
      if (!series) return;
      const currentItems = normalizeSeriesItems(series.items, series.sermonIds || []);
      const orderedSermonItems = sermonIds
        .map((sermonId) => currentItems.find((item) => item.type === 'sermon' && item.refId === sermonId))
        .filter((entry): entry is SeriesItem => Boolean(entry));

      const missingSermons = currentItems.filter(
        (item) => item.type === 'sermon' && !orderedSermonItems.find((entry) => entry.id === item.id)
      );
      const finalSermonItems = [...orderedSermonItems, ...missingSermons];

      let cursor = 0;
      const nextItemIds = currentItems.map((item) => {
        if (item.type !== 'sermon') return item.id;
        const next = finalSermonItems[cursor];
        cursor += 1;
        return next?.id || item.id;
      });

      reorderSeries(series.id, nextItemIds);
    },
    [series, reorderSeries]
  );

  const reorderMixedItems = useCallback(
    (itemIds: string[]) => {
      if (!series) return;
      reorderSeries(series.id, itemIds);
    },
    [series, reorderSeries]
  );

  /**
   * A refused edit, held so it can be re-offered instead of quietly dropped.
   * The modal that submitted it has already closed, so this state is the ONLY
   * remaining copy of what the person typed.
   */
  const [saveConflict, setSaveConflict] = usePersistedConflict<Partial<Series>>(
    series?.userId,
    seriesId,
    SERIES_META_AGGREGATE
  );
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const writeSeriesDetail = useCallback(
    async (
      updates: Partial<Series>,
      statedRevision: number,
      /**
       * The values the form OPENED with. `null` means a DELIBERATE overwrite (the
       * person saw the other version and chose theirs) — then only the counter is
       * checked, or the content comparison would refuse the very act they confirmed.
       */
      expectedBaseline: Record<string, unknown> | null = null
    ) => {
      if (!series) return;
      await withMutationGuard(async () => {
        try {
          // State the revision this edit was built from AND what it was built from,
          // so a save from a tab that never saw another device's change is refused
          // rather than replacing it — even if that device left the counter alone.
          await updateSeries(series.id, updates, statedRevision, expectedBaseline);
          // NAME the series this commit resolves — see usePersistedConflict.
          setSaveConflict(null, series.id);
        } catch (error) {
          if (isStaleWriteError(error)) {
            // REFUSED, not failed. Hold the text and hand the person the choice —
            // a generic save error would read as a glitch and hide a real conflict.
            setSaveConflict({ payload: updates, actualRevision: error.actualRevision });
            toast.error(i18n.t('freshness.staleSaveToast'));
            return;
          }
          throw error;
        }
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, series.id] });
        await queryClient.invalidateQueries({ queryKey: ['series', series.userId] });
      });
    },
    [series, withMutationGuard, queryClient, setSaveConflict]
  );

  const updateSeriesDetail = useCallback(
    /**
     * @param baseRevision the revision the EDITOR was opened with. Pass it: the
     *   live document can advance under an open form, and pairing that fresh
     *   number with the form's older text makes compare-and-set approve an
     *   overwrite it exists to refuse. Omitting it falls back to the live value,
     *   which is only safe for writes built at this instant.
     */
    async (
      updates: Partial<Series>,
      baseRevision?: number | null,
      /** The same fields as the form OPENED them — see `writeSeriesDetail`. */
      expectedBaseline?: Record<string, unknown> | null
    ) => {
      if (!series) return;
      const stated =
        baseRevision === undefined || baseRevision === null
          ? (series.rev?.[SERIES_META_AGGREGATE] ?? 0)
          : baseRevision;
      await writeSeriesDetail(updates, stated, expectedBaseline ?? null);
    },
    [series, writeSeriesDetail]
  );

  /** Save the refused edit on top of the newer version — a deliberate overwrite. */
  const keepMineOnConflict = useCallback(async () => {
    if (!saveConflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Adopt the revision the server held AT REFUSAL. Resending the original one
      // would be refused again, making the button a promise it never keeps.
      await writeSeriesDetail(saveConflict.payload, saveConflict.actualRevision);
    } finally {
      setResolvingConflict(false);
    }
  }, [saveConflict, resolvingConflict, writeSeriesDetail]);

  /** Drop the refused edit and load what the other device stored. */
  const takeTheirsOnConflict = useCallback(async () => {
    if (resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // TanStack `refetch()` RESOLVES an error result instead of throwing, so a
      // bare await would let a failed load clear the only copy of the typed text.
      const result = await refetch();
      if (result.isError) {
        toast.error(i18n.t('common.saveError', { defaultValue: 'Failed to load' }));
        return;
      }
      setSaveConflict(null, seriesId);
    } finally {
      setResolvingConflict(false);
    }
  }, [resolvingConflict, refetch, seriesId, setSaveConflict]);

  return {
    series,
    items,
    sermons,
    groups,
    loading: isLoading,
    isRefetching: isFetching,
    error: (error as Error | null) ?? mutationError,
    refreshSeriesDetail,
    addSermon,
    addSermons,
    addGroup,
    addGroups,
    removeItem,
    removeSermon,
    reorderSeriesSermons,
    reorderMixedItems,
    updateSeriesDetail,
    /** A refused save waiting for a decision — render the conflict choice. */
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
  };
}
