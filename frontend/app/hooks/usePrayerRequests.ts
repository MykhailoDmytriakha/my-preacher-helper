import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
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
  /** Revision the status change was built from; guards the human `answerText`. */
  expectedRevision?: number | null;
  updatedAt: string;
  answeredAt?: string;
  answerText?: string;
};

export function usePrayerRequests(userId?: string | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  /**
   * A refused edit, held so it can be re-offered instead of vanishing with the
   * optimistic rollback. Without this the person's words are gone from the screen
   * and only a toast remains — the silent loss the mechanism exists to prevent.
   */
  const [saveConflict, setSaveConflict] = useState<{
    id: string;
    updates: Partial<PrayerRequest>;
    /** The server's revision at refusal — what a deliberate overwrite must state. */
    actualRevision: number;
  } | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
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
    mutationFn: ({
      id,
      updates,
      expectedRevision,
    }: {
      id: string;
      updates: Partial<PrayerRequest>;
      expectedRevision?: number | null;
    }) => updatePrayerRequest(id, updates, expectedRevision ?? null),
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
    onError: (e: unknown, vars, ctx) => {
      // The rollback is right either way — the server is the truth. What must NOT
      // happen is the typed text disappearing with it, so a refusal hands it to
      // the conflict panel instead of reporting a generic failure.
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      if (isStaleWriteError(e)) {
        setSaveConflict({ id: vars.id, updates: vars.updates, actualRevision: e.actualRevision });
        return;
      }
      reportError(e);
    },
    onSuccess: (updated) => {
      if (updated?.id) replacePrayerInCaches(updated);
      // Clear the conflict HERE — on the actual commit. Clearing it at click time
      // would throw the typed text away before knowing whether the resend landed.
      setSaveConflict(null);
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
    mutationFn: ({ id, status, answerText, updatedAt, answeredAt, expectedRevision }: StatusMutationVars) =>
      setPrayerStatus(id, { status, answerText, updatedAt, answeredAt }, undefined, expectedRevision ?? null),
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

  /** Save the refused edit on top of the newer version — a deliberate overwrite. */
  const keepMineOnConflict = async () => {
    if (!saveConflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Adopt the revision the server held AT REFUSAL, or the resend is refused
      // again and the button promises what it never performs.
      // NOT cleared here: `mutate` only starts the write. `onSuccess` clears the
      // conflict once it committed; a later refusal or failure keeps the text.
      updateMutation.mutate({
        id: saveConflict.id,
        updates: saveConflict.updates,
        expectedRevision: saveConflict.actualRevision,
      });
    } finally {
      setResolvingConflict(false);
    }
  };

  /** Drop the refused edit and keep what the other device stored. */
  const takeTheirsOnConflict = async () => {
    if (resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // `invalidateQueries` resolves even when the refetch fails, so clearing the
      // conflict unconditionally would discard the only copy of the typed text
      // without loading the version it promised.
      await queryClient.refetchQueries({ queryKey: PRAYER_PREFIX });
      const failed = queryClient
        .getQueryCache()
        .findAll({ queryKey: PRAYER_PREFIX })
        .some((q) => q.state.status === 'error');
      if (failed) {
        reportError(new Error('refresh failed'));
        return;
      }
      setSaveConflict(null);
    } finally {
      setResolvingConflict(false);
    }
  };

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
    updatePrayer: async (
      id: string,
      updates: Partial<PrayerRequest>,
      expectedRevision?: number | null
    ) => {
      updateMutation.mutate({ id, updates, expectedRevision });
    },
    /** A refused save waiting for a decision — render the conflict choice. */
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
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
    setStatus: async (
      id: string,
      status: PrayerStatus,
      answerText?: string,
      expectedRevision?: number | null
    ) => {
      const updatedAt = new Date().toISOString();
      statusMutation.mutate({
        id,
        status,
        answerText,
        updatedAt,
        expectedRevision,
        ...(status === 'answered' ? { answeredAt: updatedAt } : {}),
      });
    },
  };
}
