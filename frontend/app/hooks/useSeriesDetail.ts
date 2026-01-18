import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSeriesById } from "@services/series.service";
import {
  addSermonToSeries,
  removeSermonFromSeries,
  reorderSermons as reorderSermonsAPI,
  updateSeries,
} from "@services/series.service";
import { getSermonById } from "@services/sermon.service";

import type { Series, Sermon } from "@/models/models";

type SeriesDetailPayload = {
  series: Series;
  sermons: Sermon[];
};

// Query key constants
const QUERY_KEYS = {
  SERIES_DETAIL: "series-detail",
} as const;

export function useSeriesDetail(seriesId: string) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const isOnline = useOnlineStatus();

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<SeriesDetailPayload | null>({
    queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId],
    enabled: !!seriesId && isOnline,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!seriesId) return null;

      const seriesData = await getSeriesById(seriesId);
      if (!seriesData) {
        throw new Error("Series not found");
      }

      const sermonsData = await Promise.all(seriesData.sermonIds.map((id) => getSermonById(id)));
      const validSermons = sermonsData
        .filter((sermon): sermon is Sermon => sermon !== undefined)
        .sort((a, b) => (a.seriesPosition || 0) - (b.seriesPosition || 0));

      return { series: seriesData, sermons: validSermons };
    },
  });

  const series = data?.series ?? null;
  const sermons = data?.sermons ?? [];

  const refreshSeriesDetail = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const updateDetailCache = useCallback(
    (updater: (payload: SeriesDetailPayload) => SeriesDetailPayload) => {
      queryClient.setQueryData<SeriesDetailPayload | null>([QUERY_KEYS.SERIES_DETAIL, seriesId], (old) =>
        old ? updater(old) : old
      );
    },
    [queryClient, seriesId]
  );

  const addSermon = useCallback(
    async (sermonId: string, position?: number) => {
      if (!series) return;
      setMutationError(null);
      try {
        await addSermonToSeries(series.id, sermonId, position);
        await refreshSeriesDetail();
        queryClient.invalidateQueries({ queryKey: ["series", series.userId] });
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      } catch (e: unknown) {
        const errorObj = e instanceof Error ? e : new Error(String(e));
        setMutationError(errorObj);
        throw errorObj;
      }
    },
    [series, refreshSeriesDetail, queryClient, seriesId]
  );

  const addSermons = useCallback(
    async (sermonIds: string[]) => {
      if (!series) return;
      setMutationError(null);
      const previous = data;

      try {
        updateDetailCache((payload) => {
          if (!payload) return payload;

          const existingIds = new Set(payload.series.sermonIds);
          const optimisticSermons = [...payload.sermons];

          sermonIds.forEach((id, index) => {
            if (optimisticSermons.some((s) => s.id === id)) return;
            const basePosition = optimisticSermons.length + 1;
            optimisticSermons.push({
              id,
              title: "Loading…",
              verse: "",
              date: "",
              userId: payload.series.userId,
              thoughts: [],
              outline: {
                introduction: [],
                main: [],
                conclusion: [],
              },
              isPreached: false,
              seriesId: payload.series.id,
              seriesPosition: basePosition + index,
            } as Sermon);
            existingIds.add(id);
          });

          return {
            ...payload,
            series: { ...payload.series, sermonIds: Array.from(existingIds) },
            sermons: optimisticSermons,
          };
        });

        await Promise.all(
          sermonIds.map((id, idx) =>
            addSermonToSeries(series.id, id, (data?.sermons?.length || 0) + idx + 1)
          )
        );

        const fetchedSermons = await Promise.all(sermonIds.map((id) => getSermonById(id)));

        updateDetailCache((payload) => {
          if (!payload) return payload;

          const existing = payload.sermons.filter((s) => !sermonIds.includes(s.id));
          const basePosition = existing.length;

          const hydrated = fetchedSermons.map((sermon, idx) => {
            const fallback: Sermon = {
              id: sermonIds[idx],
              title: "New Sermon",
              verse: "",
              date: "",
              userId: payload.series.userId,
              thoughts: [],
              outline: {
                introduction: [],
                main: [],
                conclusion: []
              },
              isPreached: false,
              seriesId: payload.series.id,
              seriesPosition: basePosition + idx + 1,
            };

            const merged = {
              ...fallback,
              ...(sermon ?? {}),
              thoughts: sermon?.thoughts ?? fallback.thoughts,
              outline: sermon?.outline ?? fallback.outline,
              seriesId: sermon?.seriesId ?? fallback.seriesId,
              seriesPosition: sermon?.seriesPosition ?? fallback.seriesPosition,
            };

            return merged;
          });

          const mergedSermons = [...existing, ...hydrated].sort(
            (a, b) => (a.seriesPosition || 0) - (b.seriesPosition || 0)
          );

          const mergedIds = Array.from(new Set([...payload.series.sermonIds, ...sermonIds]));

          return {
            ...payload,
            series: { ...payload.series, sermonIds: mergedIds },
            sermons: mergedSermons,
          };
        });

        queryClient.invalidateQueries({ queryKey: ["series", series.userId] });
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      } catch (e: unknown) {
        if (previous) {
          queryClient.setQueryData([QUERY_KEYS.SERIES_DETAIL, seriesId], previous);
        }
        const errorObj = e instanceof Error ? e : new Error(String(e));
        setMutationError(errorObj);
        throw errorObj;
      }
    },
    [series, data, updateDetailCache, queryClient, seriesId]
  );

  const removeSermon = useCallback(
    async (sermonId: string) => {
      if (!series) return;
      setMutationError(null);
      const previous = data;
      try {
        updateDetailCache((payload) =>
          payload
            ? {
                ...payload,
                series: {
                  ...payload.series,
                  sermonIds: payload.series.sermonIds.filter((id) => id !== sermonId),
                },
                sermons: payload.sermons.filter((sermon) => sermon.id !== sermonId),
              }
            : payload
        );

        await removeSermonFromSeries(series.id, sermonId);
        queryClient.invalidateQueries({ queryKey: ["series", series.userId] });
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      } catch (e: unknown) {
        if (previous) {
          queryClient.setQueryData([QUERY_KEYS.SERIES_DETAIL, seriesId], previous);
        }
        const errorObj = e instanceof Error ? e : new Error(String(e));
        setMutationError(errorObj);
        throw errorObj;
      }
    },
    [series, data, updateDetailCache, queryClient, seriesId]
  );

  const reorderSeriesSermons = useCallback(
    async (sermonIds: string[]) => {
      if (!series) return;
      setMutationError(null);

      const previous = data;

      // Optimistic UI update
      updateDetailCache((payload) => {
        const reordered = sermonIds.map((sermonId, index) => {
          const sermon = payload.sermons.find((s) => s.id === sermonId);
          if (!sermon) {
            throw new Error(`Sermon with id ${sermonId} not found`);
          }
          return { ...sermon, seriesPosition: index + 1 };
        });

        return {
          ...payload,
          series: { ...payload.series, sermonIds },
          sermons: reordered,
        };
      });

      try {
        await reorderSermonsAPI(series.id, sermonIds);
        // Invalidate to ensure persisted cache syncs after reorder
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      } catch (e: unknown) {
        if (previous) {
          queryClient.setQueryData([QUERY_KEYS.SERIES_DETAIL, seriesId], previous);
        }
        const errorObj = e instanceof Error ? e : new Error(String(e));
        setMutationError(errorObj);
        throw errorObj;
      }
    },
    [series, data, updateDetailCache, queryClient, seriesId]
  );

  const updateSeriesDetail = useCallback(
    async (updates: Partial<Series>) => {
      if (!series) return;
      setMutationError(null);
      try {
        await updateSeries(series.id, updates);
        await refreshSeriesDetail();
        queryClient.invalidateQueries({ queryKey: ["series", series.userId] });
      } catch (e: unknown) {
        const errorObj = e instanceof Error ? e : new Error(String(e));
        setMutationError(errorObj);
        throw errorObj;
      }
    },
    [series, refreshSeriesDetail, queryClient]
  );

  return {
    series,
    sermons,
    loading: isLoading || isFetching,
    error: (error as Error | null) ?? mutationError,
    refreshSeriesDetail,
    addSermon,
    addSermons,
    removeSermon,
    reorderSeriesSermons,
    updateSeriesDetail,
  };
}
