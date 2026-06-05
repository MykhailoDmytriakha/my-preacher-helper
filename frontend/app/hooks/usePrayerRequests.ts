import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { buildId } from '@/utils/groupFlow';
import { PRAYER_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { normalizeError } from '@/utils/normalizeError';
import {
  addPrayerUpdate,
  createPrayerRequest,
  deletePrayerRequest,
  getAllPrayerRequests,
  setPrayerStatus,
  updatePrayerRequest,
} from '@services/prayerRequests.service';

export const PRAYER_QUERY_KEY = (userId: string | null) => ['prayerRequests', userId];
const PRAYER_PREFIX = ['prayerRequests'];
const detailKey = (id: string) => ['prayerRequest', id];

type CreatePrayerPayload = Pick<PrayerRequest, 'userId' | 'title'> &
  Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>>;

export function usePrayerRequests(userId?: string | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const { uid: resolvedUid } = useResolvedUid();
  const effectiveUserId = userId ?? resolvedUid ?? null;

  const reportError = (e: unknown) => {
    setMutationError(normalizeError(e));
    toast.error(t('common.saveError', { defaultValue: 'Failed to save. Please try again.' }));
  };

  const {
    data: prayerRequests = [],
    isLoading,
    error,
  } = useServerFirstQuery<PrayerRequest[]>({
    queryKey: PRAYER_QUERY_KEY(effectiveUserId),
    queryFn: () => (effectiveUserId ? getAllPrayerRequests(effectiveUserId) : Promise.resolve([])),
    enabled: !!effectiveUserId,
  });

  // Optimistic + offline-buffered: mutationKey ties each mutation to its resumable
  // default in mutationDefaults.ts (survives reload + replays on reconnect);
  // onMutate gives instant UI; onError rolls back + surfaces genuine failures.
  // Create uses a client-generated id (see clientId.ts): the optimistic row, the
  // POST body and the server doc all share one id, so there is no temp→real swap
  // and a replayed offline create is idempotent (no duplicate).
  const createMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.create,
    mutationFn: (payload: CreatePrayerPayload & { id: string }) => createPrayerRequest(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId) });
      const previous = queryClient.getQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId));
      const now = new Date().toISOString();
      const optimistic = {
        status: 'active',
        updates: [],
        createdAt: now,
        updatedAt: now,
        ...payload,
      } as PrayerRequest;
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) => [
        optimistic,
        ...old,
      ]);
      setMutationError(null);
      return { previous };
    },
    onError: (e: unknown, _payload, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PRAYER_QUERY_KEY(effectiveUserId), ctx.previous);
      reportError(e);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
      setMutationError(null);
    },
  });

  const updateMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.update,
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PrayerRequest> }) =>
      updatePrayerRequest(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId) });
      const previous = queryClient.getQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId));
      const previousDetail = queryClient.getQueryData<PrayerRequest>(detailKey(id));
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.map((p) => (p.id === id ? ({ ...p, ...updates } as PrayerRequest) : p))
      );
      queryClient.setQueryData<PrayerRequest | undefined>(detailKey(id), (prev) =>
        prev ? ({ ...prev, ...updates } as PrayerRequest) : prev
      );
      setMutationError(null);
      return { previous, previousDetail, id };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PRAYER_QUERY_KEY(effectiveUserId), ctx.previous);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) queryClient.setQueryData<PrayerRequest>(detailKey(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
      setMutationError(null);
    },
  });

  const deleteMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.delete,
    mutationFn: (id: string) => deletePrayerRequest(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId) });
      const previous = queryClient.getQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId));
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (e: unknown, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PRAYER_QUERY_KEY(effectiveUserId), ctx.previous);
      reportError(e);
    },
    onSuccess: (_r, id) => {
      queryClient.removeQueries({ queryKey: detailKey(id) });
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
      setMutationError(null);
    },
  });

  const addUpdateMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.addUpdate,
    mutationFn: ({ id, text }: { id: string; text: string }) => addPrayerUpdate(id, text),
    onMutate: async ({ id, text }) => {
      await queryClient.cancelQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId) });
      const previous = queryClient.getQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId));
      const previousDetail = queryClient.getQueryData<PrayerRequest>(detailKey(id));
      const optimisticUpdate = { id: buildId('temp'), text, createdAt: new Date().toISOString() };
      const applyUpdate = (p: PrayerRequest): PrayerRequest =>
        p.id === id ? { ...p, updates: [...(p.updates ?? []), optimisticUpdate] } : p;
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.map(applyUpdate)
      );
      queryClient.setQueryData<PrayerRequest | undefined>(detailKey(id), (prev) =>
        prev ? applyUpdate(prev) : prev
      );
      setMutationError(null);
      return { previous, previousDetail, id };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PRAYER_QUERY_KEY(effectiveUserId), ctx.previous);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) queryClient.setQueryData<PrayerRequest>(detailKey(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
      setMutationError(null);
    },
  });

  const statusMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.status,
    mutationFn: ({ id, status, answerText }: { id: string; status: PrayerStatus; answerText?: string }) =>
      setPrayerStatus(id, status, answerText),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: PRAYER_QUERY_KEY(effectiveUserId) });
      const previous = queryClient.getQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId));
      const previousDetail = queryClient.getQueryData<PrayerRequest>(detailKey(id));
      const applyStatus = (p: PrayerRequest): PrayerRequest => (p.id === id ? { ...p, status } : p);
      queryClient.setQueryData<PrayerRequest[]>(PRAYER_QUERY_KEY(effectiveUserId), (old = []) =>
        old.map(applyStatus)
      );
      queryClient.setQueryData<PrayerRequest | undefined>(detailKey(id), (prev) =>
        prev ? applyStatus(prev) : prev
      );
      setMutationError(null);
      return { previous, previousDetail, id };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PRAYER_QUERY_KEY(effectiveUserId), ctx.previous);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) queryClient.setQueryData<PrayerRequest>(detailKey(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
      setMutationError(null);
    },
  });

  // Fire-and-forget + optimistic: resolve immediately so UI never hangs awaiting
  // the network; offline the mutation pauses + persists and replays on reconnect.
  return {
    prayerRequests,
    loading: isLoading,
    error: (error as Error | null) ?? mutationError,
    createPrayer: async (payload: CreatePrayerPayload): Promise<string> => {
      // Returns the client-generated id immediately so callers can navigate to
      // the new prayer's detail route without awaiting the network round-trip.
      const id = newClientId();
      createMutation.mutate({ ...payload, id });
      return id;
    },
    updatePrayer: async (id: string, updates: Partial<PrayerRequest>) => {
      updateMutation.mutate({ id, updates });
    },
    deletePrayer: async (id: string) => {
      deleteMutation.mutate(id);
    },
    addUpdate: async (id: string, text: string) => {
      addUpdateMutation.mutate({ id, text });
    },
    setStatus: async (id: string, status: PrayerStatus, answerText?: string) => {
      statusMutation.mutate({ id, status, answerText });
    },
  };
}
