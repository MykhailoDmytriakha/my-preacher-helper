import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useResolvedUid } from "@/hooks/useResolvedUid";
import { useServerFirstQuery } from "@/hooks/useServerFirstQuery";
import { newClientId } from "@/utils/clientId";
import { debugLog } from "@/utils/debugMode";
import { SERIES_MUTATION_KEYS } from "@/utils/mutationDefaults";
import { normalizeError } from "@/utils/normalizeError";
import {
  createSeries,
  deleteSeries,
  getAllSeries,
  updateSeries,
} from "@services/series.service";

import type { Series } from "@/models/models";

type SeriesDetailCache = {
  series?: Series;
};

const SERIES_PREFIX = ["series"];
const SAVE_ERROR_KEY = "common.saveError";
const SAVE_ERROR_FALLBACK = "Failed to save. Please try again.";
const buildQueryKey = (userId: string | null) => ["series", userId];

// Query key constants
const QUERY_KEYS = {
  SERIES_DETAIL: "series-detail",
} as const;

export function useSeries(userId?: string | null) {
  const { t } = useTranslation();
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

  // Optimistic + offline-buffered (same pattern as groups): mutationKey ties each
  // mutation to its resumable default in mutationDefaults.ts so a write made
  // offline survives reload and replays on reconnect; onMutate gives instant UI;
  // onError rolls back + surfaces genuine (online) failures.
  const createSeriesMutation = useMutation({
    mutationKey: SERIES_MUTATION_KEYS.create,
    mutationFn: (payload: Omit<Series, "id"> & { id?: string }) => createSeries(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Series[]>(buildQueryKey(effectiveUserId));
      const tempId = payload.id ?? newClientId();
      const optimistic = { ...payload, id: tempId } as Series;
      queryClient.setQueryData<Series[]>(buildQueryKey(effectiveUserId), (old = []) => [
        optimistic,
        ...(old ?? []),
      ]);
      setMutationError(null);
      return { previous, tempId };
    },
    onError: (err: unknown, _payload, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), ctx.previous);
      }
      setMutationError(normalizeError(err));
      toast.error(t(SAVE_ERROR_KEY, { defaultValue: SAVE_ERROR_FALLBACK }));
    },
    onSuccess: (createdSeries, _payload, ctx) => {
      if (createdSeries?.id && ctx?.tempId) {
        queryClient.setQueryData<Series[]>(buildQueryKey(effectiveUserId), (old = []) =>
          (old ?? []).map((s) => (s.id === ctx.tempId ? createdSeries : s))
        );
      }
      queryClient.invalidateQueries({ queryKey: SERIES_PREFIX });
      setMutationError(null);
    },
  });

  const updateSeriesMutation = useMutation({
    mutationKey: SERIES_MUTATION_KEYS.update,
    mutationFn: ({ seriesId, updates }: { seriesId: string; updates: Partial<Series> }) =>
      updateSeries(seriesId, updates),
    onMutate: async ({ seriesId, updates }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Series[]>(buildQueryKey(effectiveUserId));
      const previousDetail = queryClient.getQueryData<SeriesDetailCache | undefined>([
        QUERY_KEYS.SERIES_DETAIL,
        seriesId,
      ]);
      queryClient.setQueryData<Series[]>(buildQueryKey(effectiveUserId), (old) =>
        (old ?? []).map((s) => (s.id === seriesId ? ({ ...s, ...updates } as Series) : s))
      );
      queryClient.setQueryData<SeriesDetailCache | undefined>(
        [QUERY_KEYS.SERIES_DETAIL, seriesId],
        (prev) =>
          prev ? { ...prev, series: { ...(prev.series ?? ({} as Series)), ...updates } } : prev
      );
      setMutationError(null);
      return { previous, previousDetail, seriesId };
    },
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), ctx.previous);
      }
      if (ctx?.seriesId !== undefined) {
        queryClient.setQueryData([QUERY_KEYS.SERIES_DETAIL, ctx.seriesId], ctx.previousDetail);
      }
      setMutationError(normalizeError(err));
      toast.error(t(SAVE_ERROR_KEY, { defaultValue: SAVE_ERROR_FALLBACK }));
    },
    onSuccess: (updated) => {
      if (updated?.id) {
        queryClient.setQueryData<SeriesDetailCache | undefined>(
          [QUERY_KEYS.SERIES_DETAIL, updated.id],
          (prev) => (prev ? { ...prev, series: { ...(prev.series ?? ({} as Series)), ...updated } } : prev)
        );
      }
      queryClient.invalidateQueries({ queryKey: SERIES_PREFIX });
      setMutationError(null);
    },
  });

  const deleteSeriesMutation = useMutation({
    mutationKey: SERIES_MUTATION_KEYS.delete,
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
      setMutationError(normalizeError(err));
      toast.error(t(SAVE_ERROR_KEY, { defaultValue: SAVE_ERROR_FALLBACK }));
    },
    onSuccess: (_data, seriesId) => {
      queryClient.removeQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      queryClient.invalidateQueries({ queryKey: SERIES_PREFIX });
      setMutationError(null);
    },
  });

  // Fire-and-forget + optimistic: resolve immediately so the UI does not hang
  // awaiting the network; offline the mutation pauses + persists and replays.
  const createNewSeries = useCallback(
    async (seriesData: Omit<Series, "id"> & { id?: string }) => {
      // Mint a stable client id so the create is idempotent (setDoc by this id) —
      // a buffered create that ever replays overwrites the same doc, no duplicate.
      createSeriesMutation.mutate({ ...seriesData, id: seriesData.id ?? newClientId() });
    },
    [createSeriesMutation]
  );

  const updateExistingSeries = useCallback(
    async (seriesId: string, updates: Partial<Series>) => {
      updateSeriesMutation.mutate({ seriesId, updates });
    },
    [updateSeriesMutation]
  );

  const deleteExistingSeries = useCallback(
    async (seriesId: string) => {
      deleteSeriesMutation.mutate(seriesId);
    },
    [deleteSeriesMutation]
  );

  const refreshSeries = useCallback(async () => {
    if (!effectiveUserId || !isOnline) return;
    setMutationError(null);
    try {
      const updated = await getAllSeries(effectiveUserId);
      queryClient.setQueryData(buildQueryKey(effectiveUserId), updated);
      return updated;
    } catch (e: unknown) {
      const errorObj = normalizeError(e);
      setMutationError(errorObj);
      throw errorObj;
    }
  }, [queryClient, isOnline, effectiveUserId]);

  return {
    series,
    loading: isLoading,
    error: (error as Error | null) ?? mutationError,
    refreshSeries,
    createNewSeries,
    updateExistingSeries,
    deleteExistingSeries,
  };
}
