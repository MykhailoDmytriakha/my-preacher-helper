import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useResolvedUid } from "@/hooks/useResolvedUid";
import { useServerFirstQuery } from "@/hooks/useServerFirstQuery";
import { newClientId } from "@/utils/clientId";
import { debugLog } from "@/utils/debugMode";
import { SERIES_MUTATION_KEYS } from "@/utils/mutationDefaults";
import { normalizeError } from "@/utils/normalizeError";
import {
  persistedWrite,
  queuedMutation,
  useWriteRecovery,
  type WriteSubmission,
} from "@/utils/recoverableWrite";
import {
  recoveryText,
} from "@/utils/writeRecovery";
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
const buildQueryKey = (userId: string | null) => ["series", userId];

// Query key constants
const QUERY_KEYS = {
  SERIES_DETAIL: "series-detail",
} as const;

export function useSeries(userId?: string | null) {
  const queryClient = useQueryClient();
  /**
   * Kept as a write-side signal only. It is deliberately NOT returned as the hook's
   * `error`: that field is the query's, and the page renders it as a fatal state — one
   * refused write used to replace the whole screen.
   */
  const [, setMutationError] = useState<Error | null>(null);
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

  useWriteRecovery<Omit<Series, "id"> & { id?: string }>(queryClient, {
    mutationKey: SERIES_MUTATION_KEYS.create,
    fallbackTitleKey: "writeRecovery.seriesCreateFailed",
    titleParams: (payload) => ({ name: payload.title }),
    recoveryText: (payload) =>
      recoveryText([payload.title, payload.bookOrTopic, payload.description, payload.status, payload.color]),
    toastId: (payload) => `write-recovery:series:create:${payload.id}`,
    owns: (payload) => Boolean(effectiveUserId) && payload.userId === effectiveUserId,
    retry: (payload) => createSeriesMutation.mutate(payload),
  });

  const updateSeriesMutation = useMutation({
    mutationKey: SERIES_MUTATION_KEYS.update,
    // `userId` is carried but not sent: it says WHOSE write this is, so a refusal that
    // arrives after this screen is gone can be reported to the right person only.
    mutationFn: ({ seriesId, updates }: { seriesId: string; updates: Partial<Series>; userId?: string }) =>
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

  /**
   * A series is this person's only if it is in THEIR loaded list. Refused mutations
   * outlive a sign-out in the shared IndexedDB cache, so an unguarded descriptor shows
   * the previous account's series title and description to whoever signs in next.
   */
  const ownsSeries = (seriesId: string) =>
    Boolean(effectiveUserId) && series.some((entry) => entry.id === seriesId);

  useWriteRecovery<{ seriesId: string; updates: Partial<Series> }>(queryClient, {
    mutationKey: SERIES_MUTATION_KEYS.update,
    fallbackTitleKey: SAVE_ERROR_KEY,
    recoveryText: ({ updates }) =>
      recoveryText([
        updates.title,
        updates.theme,
        updates.description,
        updates.bookOrTopic,
        updates.status,
        updates.color,
      ]),
    toastId: ({ seriesId, updates }) =>
      `write-recovery:series:update:${seriesId}:${JSON.stringify(updates)}`,
    ownershipEpoch: `${effectiveUserId ?? ''}:${series.map((entry) => entry.id).join(',')}`,
    owns: ({ seriesId }) => ownsSeries(seriesId),
    retry: (variables) => updateSeriesMutation.mutate(variables),
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
    },
    onSuccess: (_data, seriesId) => {
      queryClient.removeQueries({ queryKey: [QUERY_KEYS.SERIES_DETAIL, seriesId] });
      queryClient.invalidateQueries({ queryKey: SERIES_PREFIX });
      setMutationError(null);
    },
  });

  useWriteRecovery<string>(queryClient, {
    mutationKey: SERIES_MUTATION_KEYS.delete,
    fallbackTitleKey: SAVE_ERROR_KEY,
    recoveryText: () => undefined,
    toastId: (seriesId) => `write-recovery:series:delete:${seriesId}`,
    ownershipEpoch: `${effectiveUserId ?? ''}:${series.map((entry) => entry.id).join(',')}`,
    /**
     * "Anyone signed in" is not ownership. Failed mutations outlive a sign-out in a
     * shared cache, so that rule handed the PREVIOUS account's refused delete to
     * whoever signed in next — with a retry aimed at their id. A delete is mine only
     * if the series is (or was) in MY list.
     */
    owns: (seriesId) => Boolean(effectiveUserId) && series.some((entry) => entry.id === seriesId),
    retry: (seriesId) => deleteSeriesMutation.mutate(seriesId),
  });

  // Fire-and-forget + optimistic: resolve immediately so the UI does not hang
  // awaiting the network; offline the mutation pauses + persists and replays.
  const createNewSeries = useCallback(
    (seriesData: Omit<Series, "id"> & { id?: string }): WriteSubmission => {
      // Mint a stable client id so the create is idempotent (setDoc by this id) —
      // a buffered create that ever replays overwrites the same doc, no duplicate.
      const payload = { ...seriesData, id: seriesData.id ?? newClientId() };
      return queuedMutation(`series:create:${payload.id}`, createSeriesMutation.mutateAsync(payload));
    },
    [createSeriesMutation]
  );

  const updateExistingSeries = useCallback(
    (seriesId: string, updates: Partial<Series>): WriteSubmission => {
      return queuedMutation(
        `series:update:${seriesId}:${JSON.stringify(updates)}`,
        updateSeriesMutation.mutateAsync({ seriesId, updates, userId: effectiveUserId ?? undefined })
      );
    },
    [updateSeriesMutation]
  );

  const deleteExistingSeries = useCallback(
    (seriesId: string): WriteSubmission => {
      // DELETE is a plain fetch request, not a replayable client-SDK write. React
      // Query does not retain an online pending request across a reload either.
      return persistedWrite(deleteSeriesMutation.mutateAsync(seriesId));
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
    /**
     * ONLY the query's error. A refused WRITE used to travel through this same field,
     * and the page renders that as a fatal state — the whole screen replaced, the open
     * editor and the list gone — for something that is recoverable and already reported
     * by the recovery descriptor. A write that fails must never cost the person the
     * screen they are working on.
     */
    error: (error as Error | null) ?? null,
    refreshSeries,
    createNewSeries,
    updateExistingSeries,
    deleteExistingSeries,
  };
}
