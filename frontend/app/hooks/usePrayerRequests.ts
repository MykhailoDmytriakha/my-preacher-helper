import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { newClientId } from '@/utils/clientId';
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

type AddUpdateMutationVars = {
  id: string;
  updateId: string;
  text: string;
  createdAt: string;
};

type StatusMutationVars = {
  id: string;
  status: PrayerStatus;
  updatedAt: string;
  answeredAt?: string;
  answerText?: string;
};

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

  const listKey = PRAYER_QUERY_KEY(effectiveUserId);
  const replacePrayerInCaches = (prayer: PrayerRequest) => {
    queryClient.setQueryData<PrayerRequest[]>(listKey, (old) =>
      old ? old.map((item) => (item.id === prayer.id ? prayer : item)) : old
    );
    queryClient.setQueryData<PrayerRequest | undefined>(detailKey(prayer.id), prayer);
  };

  const {
    data: prayerRequests = [],
    isLoading,
    error,
  } = useServerFirstQuery<PrayerRequest[]>({
    queryKey: listKey,
    queryFn: () => (effectiveUserId ? getAllPrayerRequests(effectiveUserId) : Promise.resolve([])),
    enabled: !!effectiveUserId,
  });

  // Optimistic + offline-buffered: mutationKey ties each mutation to its resumable
  // default in mutationDefaults.ts (survives reload + replays on reconnect);
  // onMutate gives instant UI; onError rolls back + surfaces genuine failures.
  // Create uses a client-generated id (see clientId.ts): the optimistic row, the
  // POST body and the stored doc all share one stable id. onSuccess still swaps
  // the optimistic row for the persisted shape so server/client defaults are exact.
  const createMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.create,
    mutationFn: (payload: CreatePrayerPayload & { id: string }) => createPrayerRequest(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PrayerRequest[]>(listKey);
      const now = new Date().toISOString();
      const tempId = payload.id ?? newClientId();
      const optimistic = {
        status: 'active',
        updates: [],
        createdAt: now,
        updatedAt: now,
        ...payload,
        id: tempId,
      } as PrayerRequest;
      queryClient.setQueryData<PrayerRequest[]>(listKey, (old = []) => [
        optimistic,
        ...old,
      ]);
      setMutationError(null);
      return { previous: previous ?? [], tempId };
    },
    onError: (e: unknown, _payload, ctx) => {
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      reportError(e);
    },
    onSuccess: (created, _payload, ctx) => {
      if (created?.id && ctx?.tempId) {
        queryClient.setQueryData<PrayerRequest[]>(listKey, (old = []) =>
          old.map((prayer) => (prayer.id === ctx.tempId ? created : prayer))
        );
        queryClient.setQueryData<PrayerRequest | undefined>(detailKey(created.id), created);
      }
      setMutationError(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
    },
  });

  const updateMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.update,
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PrayerRequest> }) =>
      updatePrayerRequest(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PrayerRequest[]>(listKey);
      const previousDetail = queryClient.getQueryData<PrayerRequest>(detailKey(id));
      queryClient.setQueryData<PrayerRequest[]>(listKey, (old = []) =>
        old.map((p) => (p.id === id ? ({ ...p, ...updates } as PrayerRequest) : p))
      );
      queryClient.setQueryData<PrayerRequest | undefined>(detailKey(id), (prev) =>
        prev ? ({ ...prev, ...updates } as PrayerRequest) : prev
      );
      setMutationError(null);
      return { previous: previous ?? [], previousDetail, id };
    },
    onError: (e: unknown, _vars, ctx) => {
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) replacePrayerInCaches(updated);
      setMutationError(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
    },
  });

  const deleteMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.delete,
    mutationFn: (id: string) => deletePrayerRequest(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PrayerRequest[]>(listKey);
      queryClient.setQueryData<PrayerRequest[]>(listKey, (old = []) =>
        old.filter((p) => p.id !== id)
      );
      return { previous: previous ?? [] };
    },
    onError: (e: unknown, _id, ctx) => {
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      reportError(e);
    },
    onSuccess: (_r, id) => {
      queryClient.removeQueries({ queryKey: detailKey(id) });
      setMutationError(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
    },
  });

  const addUpdateMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.addUpdate,
    mutationFn: ({ id, updateId, text, createdAt }: AddUpdateMutationVars) =>
      addPrayerUpdate(id, { updateId, text, createdAt }),
    onMutate: async ({ id, updateId, text, createdAt }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PrayerRequest[]>(listKey);
      const previousDetail = queryClient.getQueryData<PrayerRequest>(detailKey(id));
      const optimisticUpdate = { id: updateId, text, createdAt };
      const applyUpdate = (p: PrayerRequest): PrayerRequest =>
        p.id === id
          ? { ...p, updates: [...(p.updates ?? []), optimisticUpdate], updatedAt: createdAt }
          : p;
      queryClient.setQueryData<PrayerRequest[]>(listKey, (old = []) =>
        old.map(applyUpdate)
      );
      queryClient.setQueryData<PrayerRequest | undefined>(detailKey(id), (prev) =>
        prev ? applyUpdate(prev) : prev
      );
      setMutationError(null);
      return { previous: previous ?? [], previousDetail, id };
    },
    onError: (e: unknown, _vars, ctx) => {
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) replacePrayerInCaches(updated);
      setMutationError(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
    },
  });

  const statusMutation = useMutation({
    mutationKey: PRAYER_MUTATION_KEYS.status,
    mutationFn: ({ id, status, answerText, updatedAt, answeredAt }: StatusMutationVars) =>
      setPrayerStatus(id, { status, answerText, updatedAt, answeredAt }),
    onMutate: async ({ id, status, answerText, updatedAt, answeredAt }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PrayerRequest[]>(listKey);
      const previousDetail = queryClient.getQueryData<PrayerRequest>(detailKey(id));
      const optimisticStatus = {
        status,
        updatedAt,
        ...(answeredAt !== undefined ? { answeredAt } : {}),
        ...(answerText !== undefined ? { answerText } : {}),
      };
      const applyStatus = (p: PrayerRequest): PrayerRequest =>
        p.id === id ? ({ ...p, ...optimisticStatus } as PrayerRequest) : p;
      queryClient.setQueryData<PrayerRequest[]>(listKey, (old = []) =>
        old.map(applyStatus)
      );
      queryClient.setQueryData<PrayerRequest | undefined>(detailKey(id), (prev) =>
        prev ? applyStatus(prev) : prev
      );
      setMutationError(null);
      return { previous: previous ?? [], previousDetail, id };
    },
    onError: (e: unknown, _vars, ctx) => {
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) replacePrayerInCaches(updated);
      setMutationError(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
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
      addUpdateMutation.mutate({
        id,
        updateId: newClientId(),
        text,
        createdAt: new Date().toISOString(),
      });
    },
    setStatus: async (id: string, status: PrayerStatus, answerText?: string) => {
      const updatedAt = new Date().toISOString();
      statusMutation.mutate({
        id,
        status,
        answerText,
        updatedAt,
        ...(status === 'answered' ? { answeredAt: updatedAt } : {}),
      });
    },
  };
}
