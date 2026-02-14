import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { normalizeSeriesItems } from '@/utils/seriesItems';
import { getGroupById } from '@services/groups.service';
import {
  addGroupToSeries,
  addSermonToSeries,
  getSeriesById,
  removeSeriesItem,
  reorderSeriesItems,
  updateSeries,
} from '@services/series.service';
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
  const items = data?.items ?? [];
  const sermons = data?.sermons ?? [];
  const groups = data?.groups ?? [];

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

  const addSermon = useCallback(
    async (sermonId: string, position?: number) => {
      if (!series) return;
      await withMutationGuard(async () => {
        await addSermonToSeries(series.id, sermonId, position);
        await queryClient.invalidateQueries({ queryKey: ['series', series.userId] });
      });
    },
    [series, withMutationGuard, queryClient]
  );

  const addSermons = useCallback(
    async (sermonIds: string[]) => {
      if (!series) return;
      await withMutationGuard(async () => {
        await Promise.all(
          sermonIds.map((sermonId, index) =>
            addSermonToSeries(series.id, sermonId, (series.items?.length || 0) + index)
          )
        );
        await queryClient.invalidateQueries({ queryKey: ['series', series.userId] });
      });
    },
    [series, withMutationGuard, queryClient]
  );

  const addGroup = useCallback(
    async (groupId: string, position?: number) => {
      if (!series) return;
      await withMutationGuard(async () => {
        await addGroupToSeries(series.id, groupId, position);
        await queryClient.invalidateQueries({ queryKey: ['series', series.userId] });
        await queryClient.invalidateQueries({ queryKey: ['groups', series.userId] });
      });
    },
    [series, withMutationGuard, queryClient]
  );

  const removeItem = useCallback(
    async (type: 'sermon' | 'group', refId: string) => {
      if (!series) return;
      await withMutationGuard(async () => {
        await removeSeriesItem(series.id, type, refId);
        await queryClient.invalidateQueries({ queryKey: ['series', series.userId] });
        if (type === 'group') {
          await queryClient.invalidateQueries({ queryKey: ['groups', series.userId] });
        }
      });
    },
    [series, withMutationGuard, queryClient]
  );

  const removeSermon = useCallback(
    async (sermonId: string) => removeItem('sermon', sermonId),
    [removeItem]
  );

  const reorderSeriesSermons = useCallback(
    async (sermonIds: string[]) => {
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
      const nextItemIds = currentItems
        .map((item) => {
          if (item.type !== 'sermon') return item.id;
          const next = finalSermonItems[cursor];
          cursor += 1;
          return next?.id || item.id;
        });

      await withMutationGuard(async () => {
        await reorderSeriesItems(series.id, nextItemIds);
      });
    },
    [series, withMutationGuard]
  );

  const reorderMixedItems = useCallback(
    async (itemIds: string[]) => {
      if (!series) return;
      await withMutationGuard(async () => {
        await reorderSeriesItems(series.id, itemIds);
      });
    },
    [series, withMutationGuard]
  );

  const updateSeriesDetail = useCallback(
    async (updates: Partial<Series>) => {
      if (!series) return;
      await withMutationGuard(async () => {
        await updateSeries(series.id, updates);
        await queryClient.invalidateQueries({ queryKey: ['series', series.userId] });
      });
    },
    [series, withMutationGuard, queryClient]
  );

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
    removeItem,
    removeSermon,
    reorderSeriesSermons,
    reorderMixedItems,
    updateSeriesDetail,
  };
}
