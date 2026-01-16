import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { debugLog } from "@/utils/debugMode";
import {
  addSermonToSeries,
  createSeries,
  deleteSeries,
  getAllSeries,
  removeSermonFromSeries,
  reorderSermons,
  updateSeries,
} from "@services/series.service";

import type { Series } from "@/models/models";

type SeriesDetailCache = {
  series?: Series;
};

const buildQueryKey = (userId: string | null) => ["series", userId];

// Query key constants
const QUERY_KEYS = {
  SERIES_DETAIL: "series-detail",
} as const;

export function useSeries(userId: string | null) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const isOnline = useOnlineStatus();

  const {
    data: series = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getAllSeries(userId) : Promise.resolve([])),
    enabled: !!userId && isOnline,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    debugLog("Series state", {
      isOnline,
      userId,
      count: series.length,
      isLoading,
      isFetching,
    });
  }, [isOnline, userId, series.length, isLoading, isFetching]);

  const createSeriesMutation = useMutation({
    mutationFn: (payload: Omit<Series, "id">) => createSeries(payload),
    onSuccess: (createdSeries) => {
      queryClient.setQueryData<Series[]>(buildQueryKey(userId), (old = []) => [
        createdSeries,
        ...(old ?? []),
      ]);
      setMutationError(null);
    },
    onError: (err: unknown) => {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
    },
  });

  const updateSeriesMutation = useMutation({
    mutationFn: ({ seriesId, updates }: { seriesId: string; updates: Partial<Series> }) =>
      updateSeries(seriesId, updates),
    onSuccess: (updated) => {
      queryClient.setQueryData<Series[]>(buildQueryKey(userId), (old) =>
        (old ?? []).map((s) => (s.id === updated.id ? updated : s))
      );
      queryClient.setQueryData<SeriesDetailCache | undefined>([QUERY_KEYS.SERIES_DETAIL, updated.id], (prev) =>
        prev
          ? {
              ...prev,
              series: { ...(prev.series ?? {} as Series), ...updated },
            }
          : prev
      );
      setMutationError(null);
    },
    onError: (err: unknown) => {
      setMutationError(err instanceof Error ? err : new Error(String(err)));
    },
  });

  const deleteSeriesMutation = useMutation({
    mutationFn: (seriesId: string) => deleteSeries(seriesId),
    onMutate: async (seriesId) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<Series[]>(buildQueryKey(userId));
      queryClient.setQueryData<Series[]>(buildQueryKey(userId), (old = []) =>
        (old ?? []).filter((s) => s.id !== seriesId)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(buildQueryKey(userId), ctx.previous);
      }
      setMutationError(err instanceof Error ? err : new Error(String(err)));
    },
    onSuccess: (_data, seriesId) => {
      queryClient.removeQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      setMutationError(null);
    },
  });

  const mutationGuard = useCallback(
    async <TResult>(action: () => Promise<TResult>) => {
      if (!isOnline) {
        const offlineError = new Error("Offline: operation not available.");
        setMutationError(offlineError);
        throw offlineError;
      }
      setMutationError(null);
      try {
        return await action();
      } catch (e: unknown) {
        const errorObj = e instanceof Error ? e : new Error(String(e));
        setMutationError(errorObj);
        throw errorObj;
      }
    },
    [isOnline]
  );

  const createNewSeries = useCallback(
    async (seriesData: Omit<Series, "id">) =>
      mutationGuard(() => createSeriesMutation.mutateAsync(seriesData)),
    [createSeriesMutation, mutationGuard]
  );

  const updateExistingSeries = useCallback(
    async (seriesId: string, updates: Partial<Series>) =>
      mutationGuard(() => updateSeriesMutation.mutateAsync({ seriesId, updates })),
    [updateSeriesMutation, mutationGuard]
  );

  const deleteExistingSeries = useCallback(
    async (seriesId: string) => mutationGuard(() => deleteSeriesMutation.mutateAsync(seriesId)),
    [deleteSeriesMutation, mutationGuard]
  );

  const refreshSeries = useCallback(async () => {
    if (!userId || !isOnline) return;
    setMutationError(null);
    try {
      const updated = await getAllSeries(userId);
      queryClient.setQueryData(buildQueryKey(userId), updated);
      return updated;
    } catch (e: unknown) {
      const errorObj = e instanceof Error ? e : new Error(String(e));
      setMutationError(errorObj);
      throw errorObj;
    }
  }, [queryClient, isOnline, userId]);

  const addSermon = useCallback(
    async (seriesId: string, sermonId: string, position?: number) =>
      mutationGuard(async () => {
        await addSermonToSeries(seriesId, sermonId, position);
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
      }),
    [mutationGuard, queryClient, userId]
  );

  const removeSermon = useCallback(
    async (seriesId: string, sermonId: string) =>
      mutationGuard(async () => {
        await removeSermonFromSeries(seriesId, sermonId);
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
      }),
    [mutationGuard, queryClient, userId]
  );

  const reorderSeriesSermons = useCallback(
    async (seriesId: string, sermonIds: string[]) =>
      mutationGuard(async () => {
        await reorderSermons(seriesId, sermonIds);
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(userId) });
      }),
    [mutationGuard, queryClient, userId]
  );

  return {
    series,
    loading: isLoading || isFetching,
    error: (error as Error | null) ?? mutationError,
    refreshSeries,
    createNewSeries,
    updateExistingSeries,
    deleteExistingSeries,
    addSermon,
    removeSermon,
    reorderSeriesSermons,
  };
}
