import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useResolvedUid } from "@/hooks/useResolvedUid";
import { useServerFirstQuery } from "@/hooks/useServerFirstQuery";
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

export function useSeries(userId?: string | null) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const isOnline = useOnlineStatus();
  const { uid: resolvedUid } = useResolvedUid();
  const effectiveUserId = userId ?? resolvedUid ?? null;

  const {
    data: series = [],
    isLoading,
    isFetching,
    error,
  } = useServerFirstQuery({
    queryKey: buildQueryKey(effectiveUserId),
    queryFn: () => (effectiveUserId ? getAllSeries(effectiveUserId) : Promise.resolve([])),
    enabled: !!effectiveUserId,
  });

  useEffect(() => {
    debugLog("Series state", {
      isOnline,
      userId: effectiveUserId,
      count: series.length,
      isLoading,
      isFetching,
    });
  }, [isOnline, effectiveUserId, series.length, isLoading, isFetching]);

  const createSeriesMutation = useMutation({
    mutationFn: (payload: Omit<Series, "id">) => createSeries(payload),
    onSuccess: (createdSeries) => {
      queryClient.setQueryData<Series[]>(buildQueryKey(effectiveUserId), (old = []) => [
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
      queryClient.setQueryData<Series[]>(buildQueryKey(effectiveUserId), (old) =>
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
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Series[]>(buildQueryKey(effectiveUserId));
      queryClient.setQueryData<Series[]>(buildQueryKey(effectiveUserId), (old = []) =>
        (old ?? []).filter((s) => s.id !== seriesId)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), ctx.previous);
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
    if (!effectiveUserId || !isOnline) return;
    setMutationError(null);
    try {
      const updated = await getAllSeries(effectiveUserId);
      queryClient.setQueryData(buildQueryKey(effectiveUserId), updated);
      return updated;
    } catch (e: unknown) {
      const errorObj = e instanceof Error ? e : new Error(String(e));
      setMutationError(errorObj);
      throw errorObj;
    }
  }, [queryClient, isOnline, effectiveUserId]);

  const addSermon = useCallback(
    async (seriesId: string, sermonId: string, position?: number) =>
      mutationGuard(async () => {
        await addSermonToSeries(seriesId, sermonId, position);
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(effectiveUserId) });
      }),
    [mutationGuard, queryClient, effectiveUserId]
  );

  const removeSermon = useCallback(
    async (seriesId: string, sermonId: string) =>
      mutationGuard(async () => {
        await removeSermonFromSeries(seriesId, sermonId);
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(effectiveUserId) });
      }),
    [mutationGuard, queryClient, effectiveUserId]
  );

  const reorderSeriesSermons = useCallback(
    async (seriesId: string, sermonIds: string[]) =>
      mutationGuard(async () => {
        await reorderSermons(seriesId, sermonIds);
        await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(effectiveUserId) });
      }),
    [mutationGuard, queryClient, effectiveUserId]
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
