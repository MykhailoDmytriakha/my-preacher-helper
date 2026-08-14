import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { isOfflineQueuedError, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { PRAYER_CORE_AGGREGATE, PRAYER_STATUS_AGGREGATE } from '@/services/prayerRequests.client';
import { newClientId } from '@/utils/clientId';
import { PRAYER_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { normalizeError } from '@/utils/normalizeError';
import {
  persistedWrite,
  queuedMutation,
  skippedWrite,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';
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
const PRAYER_UPDATE_FAILED_KEY = 'writeRecovery.prayerUpdateFailed';
const detailKey = (id: string) => ['prayerRequest', id];

type CreatePrayerPayload = Pick<PrayerRequest, 'userId' | 'title'> &
  Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>> & {
    /** Verbatim form values, kept out of the persisted record but available for recovery. */
    recoveryDraft?: string;
  };

type UpdatePrayerMutationVars = {
  id: string;
  updates: Partial<PrayerRequest>;
  expectedRevision?: number | null;
  expectedBaseline?: Record<string, unknown> | null;
  /** Verbatim form values, never sent to Firestore. */
  recoveryDraft?: string;
};

type AddUpdateMutationVars = {
  id: string;
  updateId: string;
  text: string;
  createdAt: string;
  /** Verbatim textarea value before its persisted form is normalised. */
  recoveryDraft?: string;
};

type StatusMutationVars = {
  id: string;
  status: PrayerStatus;
  /** Revision the status change was built from; guards the human `answerText`. */
  expectedRevision?: number | null;
  /**
   * Status/answer values as the MODAL OPENED them. The service must not derive this
   * from its own fresh read — that compares the server with itself and agrees every
   * time, which is how a stale answer replaced the one written on the other device.
   */
  expectedBaseline?: Record<string, unknown> | null;
  updatedAt: string;
  answeredAt?: string;
  answerText?: string;
  /** Verbatim answer before its persisted form is normalised. */
  recoveryDraft?: string;
};

/**
 * @param activeDocId id of the prayer the caller currently has OPEN. Supplying it
 *   makes a refused save durable: without a document key the conflict can only
 *   live in memory, and a reload before the person chooses destroys the only copy
 *   of the typed text. List screens can omit it — they do not edit text.
 */
export function usePrayerRequests(userId?: string | null, activeDocId?: string | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  /**
   * Write-side signal only, deliberately NOT returned as the hook's `error`: that field
   * belongs to the query, and a page renders it as a fatal state.
   */
  const [, setMutationError] = useState<Error | null>(null);
  /**
   * A refused edit, held so it can be re-offered instead of vanishing with the
   * optimistic rollback. Without this the person's words are gone from the screen
   * and only a toast remains — the silent loss the mechanism exists to prevent.
   */
  const [saveConflict, setSaveConflict] = usePersistedConflict<{
    id: string;
    updates: Partial<PrayerRequest>;
  }>(userId ?? null, activeDocId ?? null, PRAYER_CORE_AGGREGATE);
  /**
   * A REFUSED ANSWER, held durably — the answer is the longest text in this screen and
   * it lives nowhere but the modal that carries it. The modal now stays open on a
   * refusal, but the backdrop and the ✕ still close it, and a reload always did: the
   * ninth review was right that "stays open" is not durability. This is a separate
   * slot from the core fields, because status and answer are their own aggregate.
   */
  const [statusConflict, setStatusConflict] = usePersistedConflict<{
    id: string;
    status: PrayerStatus;
    answerText?: string;
  }>(userId ?? null, activeDocId ?? null, PRAYER_STATUS_AGGREGATE);
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
    mutationFn: ({ recoveryDraft: _recoveryDraft, ...payload }: CreatePrayerPayload & { id: string }) =>
      createPrayerRequest(payload),
    onMutate: async ({ recoveryDraft: _recoveryDraft, ...payload }) => {
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
      setMutationError(normalizeError(e));
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
      expectedBaseline,
    }: UpdatePrayerMutationVars) => updatePrayerRequest(id, updates, expectedRevision ?? null, expectedBaseline ?? null),
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
      // The outbox owns this exact intent. Its optimistic mirror is accepted work,
      // not a failed save, and must survive until replay resolves it.
      if (isOfflineQueuedError(e)) return;
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      if (isStaleWriteError(e)) {
        setSaveConflict({ payload: { id: vars.id, updates: vars.updates }, actualRevision: e.actualRevision });
        return;
      }
      setMutationError(normalizeError(e));
    },
    onSuccess: (updated, vars) => {
      if (updated?.id) replacePrayerInCaches(updated);
      // Clear the conflict HERE — on the actual commit. Clearing it at click time
      // would throw the typed text away before knowing whether the resend landed.
      // And NAME the prayer it belongs to: a commit landing after the person opened
      // another one would otherwise empty THAT prayer's slot instead.
      setSaveConflict(null, vars.id);
      setMutationError(null);
    },
    onSettled: (_data, error) => {
      if (isOfflineQueuedError(error)) return;
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
      setMutationError(normalizeError(e));
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
      setMutationError(normalizeError(e));
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
    mutationFn: ({
      id,
      status,
      answerText,
      updatedAt,
      answeredAt,
      expectedRevision,
      expectedBaseline,
    }: StatusMutationVars) =>
      setPrayerStatus(
        id,
        { status, answerText, updatedAt, answeredAt },
        undefined,
        expectedRevision ?? null,
        expectedBaseline ?? null
      ),
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
    onError: (e: unknown, vars, ctx) => {
      // `OfflineQueuedError` means the durable outbox accepted the guarded intent.
      // Do not roll its optimistic mirror back or refetch it away.
      if (isOfflineQueuedError(e)) return;
      queryClient.setQueryData(listKey, ctx?.previous ?? []);
      if (ctx?.id) queryClient.setQueryData(detailKey(ctx.id), ctx.previousDetail);
      // A REFUSAL keeps the typed answer somewhere that survives the modal, the
      // backdrop, the ✕ and a reload. Any other failure is reported as before.
      if (isStaleWriteError(e)) {
        setStatusConflict(
          {
            payload: { id: vars.id, status: vars.status, answerText: vars.answerText },
            actualRevision: e.actualRevision,
          },
          vars.id
        );
        return;
      }
      setMutationError(normalizeError(e));
    },
    onSuccess: (updated, vars) => {
      if (updated?.id) replacePrayerInCaches(updated);
      // Committed — only now is the refused answer safe to retire, and only for the
      // prayer it was typed for.
      setStatusConflict(null, vars.id);
      setMutationError(null);
    },
    onSettled: (_data, error) => {
      if (isOfflineQueuedError(error)) return;
      queryClient.invalidateQueries({ queryKey: PRAYER_PREFIX });
    },
  });

  /** Send the refused ANSWER again, deliberately, on top of the newer version. */
  const keepMineOnStatusConflict = async () => {
    if (!statusConflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      const updatedAt = new Date().toISOString();
      /**
       * AWAITED, so the button is actually busy while the overwrite is in flight.
       * `mutate()` only STARTS the write, and `finally` then cleared the flag on the
       * same tick — the guard above never saw it, so a second click sent a second
       * deliberate overwrite, or raced "take theirs" and undid the choice the person
       * made last. Rejection is expected here (that is what the conflict banner is for)
       * and stays with the mutation's own handlers.
       */
      await statusMutation.mutateAsync({
        id: statusConflict.payload.id,
        status: statusConflict.payload.status,
        answerText: statusConflict.payload.answerText,
        updatedAt,
        expectedRevision: statusConflict.actualRevision,
        ...(statusConflict.payload.status === 'answered' ? { answeredAt: updatedAt } : {}),
      }).catch(() => undefined);
    } finally {
      setResolvingConflict(false);
    }
  };

  /** Drop the refused answer and keep what the other device stored. */
  const takeTheirsOnStatusConflict = () => {
    if (!statusConflict) return;
    setStatusConflict(null, statusConflict.payload.id);
  };

  /** Save the refused edit on top of the newer version — a deliberate overwrite. */
  const keepMineOnConflict = async () => {
    if (!saveConflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Adopt the revision the server held AT REFUSAL, or the resend is refused
      // again and the button promises what it never performs.
      // NOT cleared here: `mutate` only starts the write. `onSuccess` clears the
      // conflict once it committed; a later refusal or failure keeps the text.
      // Awaited for the same reason as the status overwrite above: an unawaited
      // `mutate` left the button clickable while its own write was still travelling.
      await updateMutation.mutateAsync({
        id: saveConflict.payload.id,
        updates: saveConflict.payload.updates,
        expectedRevision: saveConflict.actualRevision,
      }).catch(() => undefined);
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
      setSaveConflict(null, saveConflict?.payload.id);
    } finally {
      setResolvingConflict(false);
    }
  };

  /**
   * Whose prayer this is. The route id ALONE is not proof: opening an old `/prayer/<id>`
   * URL after signing in as someone else made `activeDocId` match a document belonging
   * to the previous account, and a refusal restored from the shared cache would then be
   * read aloud — title, update, or answer — to the wrong person.
   *
   * The payload's OWN `userId` is the answer, because it was recorded when the write
   * was made. The route is not: opening an old `/prayer/<id>` URL after signing in as
   * someone else made the id "active", and a refusal restored from the shared cache
   * was then read aloud — title, update or answer — to the wrong person. The loaded
   * list is accepted as a second proof for older payloads that predate the owner field.
   */
  /**
   * WHICH prayers are known, not how many. A list of the same LENGTH with different
   * contents changes the ownership answer without changing a count, and the failure
   * would then never be looked at again.
   */
  const prayerOwnershipEpoch = `${effectiveUserId ?? ''}:${prayerRequests
    .map((prayer) => prayer.id)
    .join(',')}`;

  const ownsPrayerPayload = (payload: { userId?: string; id?: string } | undefined) => {
    if (!effectiveUserId || !payload) return false;
    if (payload.userId) return payload.userId === effectiveUserId;
    // Legacy payload without an owner: fall back to "is it in MY list", never the URL.
    return Boolean(payload.id) && prayerRequests.some((prayer) => prayer.id === payload.id);
  };

  useWriteRecovery<CreatePrayerPayload & { id: string }>(queryClient, {
    mutationKey: PRAYER_MUTATION_KEYS.create,
    fallbackTitleKey: 'writeRecovery.prayerCreateFailed',
    titleParams: (payload) => ({ name: payload.title }),
    recoveryText: (payload) => payload.recoveryDraft ?? recoveryText([payload.title, payload.description, payload.tags?.join(', ')]),
    toastId: (payload) => `write-recovery:prayer:create:${payload.id}`,
    owns: (payload) => Boolean(effectiveUserId) && payload.userId === effectiveUserId,
    retry: (payload) => createMutation.mutate(payload),
  });

  useWriteRecovery<UpdatePrayerMutationVars>(queryClient, {
    mutationKey: PRAYER_MUTATION_KEYS.update,
    fallbackTitleKey: PRAYER_UPDATE_FAILED_KEY,
    titleParams: (payload) => ({ name: payload.updates.title }),
    recoveryText: (payload) => payload.recoveryDraft ?? recoveryText([
      payload.updates.title,
      payload.updates.description,
      payload.updates.tags?.join(', '),
    ]),
    toastId: (payload) => `write-recovery:prayer:edit:${payload.id}`,
    // A stale revision opens the version CHOICE on screen; a recovery message on top of
    // it made one conflict look like two events with two different resolutions.
    ignore: (error) => isStaleWriteError(error),
    ownershipEpoch: prayerOwnershipEpoch,
    owns: (payload) => ownsPrayerPayload(payload),
    retry: (payload) => updateMutation.mutate(payload),
  });

  useWriteRecovery<AddUpdateMutationVars>(queryClient, {
    mutationKey: PRAYER_MUTATION_KEYS.addUpdate,
    fallbackTitleKey: PRAYER_UPDATE_FAILED_KEY,
    recoveryText: (payload) => payload.recoveryDraft ?? payload.text,
    toastId: (payload) => `write-recovery:prayer:update:${payload.updateId}`,
    ownershipEpoch: prayerOwnershipEpoch,
    owns: (payload) => ownsPrayerPayload(payload),
    retry: (payload) => addUpdateMutation.mutate(payload),
  });

  useWriteRecovery<StatusMutationVars>(queryClient, {
    mutationKey: PRAYER_MUTATION_KEYS.status,
    fallbackTitleKey: PRAYER_UPDATE_FAILED_KEY,
    recoveryText: (payload) => payload.recoveryDraft ?? payload.answerText,
    toastId: (payload) => `write-recovery:prayer:status:${payload.id}`,
    // A stale revision opens the version CHOICE on screen; a recovery message on top of
    // it made one conflict look like two events with two different resolutions.
    ignore: (error) => isStaleWriteError(error),
    ownershipEpoch: prayerOwnershipEpoch,
    owns: (payload) => ownsPrayerPayload(payload),
    retry: (payload) => statusMutation.mutate(payload),
  });

  useWriteRecovery<string>(queryClient, {
    mutationKey: PRAYER_MUTATION_KEYS.delete,
    fallbackTitleKey: PRAYER_UPDATE_FAILED_KEY,
    recoveryText: () => undefined,
    toastId: (id) => `write-recovery:prayer:delete:${id}`,
    ownershipEpoch: prayerOwnershipEpoch,
    // A delete carries only an id and no text to hand back, so ownership reduces to
    // "is this prayer in MY list" — and never to what the URL says.
    owns: (id) => Boolean(effectiveUserId) && prayerRequests.some((prayer) => prayer.id === id),
    retry: (id) => deleteMutation.mutate(id),
  });

  const hasPendingMutation = <TVars,>(
    mutationKey: readonly unknown[],
    matches: (variables: TVars) => boolean
  ) =>
    queryClient.getMutationCache().getAll().some((mutation) =>
      JSON.stringify(mutation.options.mutationKey) === JSON.stringify(mutationKey) &&
      mutation.state.status === 'pending' &&
      matches(mutation.state.variables as TVars)
    );

  // Fire-and-forget + optimistic: resolve immediately so UI never hangs awaiting
  // the network; offline the mutation pauses + persists and replays on reconnect.
  /**
   * Pull the newer version in place, for the "changed on another device" banner.
   *
   * Throws when the refetch fails, so the caller can say so instead of quietly
   * showing a success while the screen still holds the older version — the same
   * trap the conflict resolution above guards against.
   */
  const refreshPrayers = async () => {
    await queryClient.refetchQueries({ queryKey: PRAYER_PREFIX });
    const failed = queryClient
      .getQueryCache()
      .findAll({ queryKey: PRAYER_PREFIX })
      .some((q) => q.state.status === 'error');
    if (failed) throw new Error('prayer refresh failed');
  };

  return {
    prayerRequests,
    loading: isLoading,
    /**
     * ONLY the query's error. A refused WRITE must not travel through this field: pages
     * render it as a fatal state, and one refused write then replaces the whole screen
     * — the editor and the list with it. Fixed in useGroups/useSeries after review
     * round 10; these two carried the same wiring and are aligned here before anyone
     * reads them.
     */
    error: (error as Error | null) ?? null,
    refreshPrayers,
    /**
     * Returns the new prayer's id ALONGSIDE the submission, the same shape dashboard
     * sermon creation uses. Without it a caller that needs to navigate had nothing to
     * navigate to: the dashboard awaited the submission object itself and pushed
     * `/prayers/[object Object]`, so creating a prayer from the dashboard led nowhere.
     */
    createPrayer: (payload: CreatePrayerPayload): WriteSubmission & { prayerId: string } => {
      const id = newClientId();
      const vars = { ...payload, id };
      return {
        ...queuedMutation(`prayer:create:${id}`, createMutation.mutateAsync(vars)),
        prayerId: id,
      };
    },
    /**
     * AWAITED on purpose. It used to call `mutate` and resolve immediately, so the
     * screen said "Updated" and closed the modal before the write had even been
     * attempted — and a refusal arriving afterwards contradicted a success the
     * person had already been shown. `mutateAsync` settles on the real outcome;
     * offline the mutation pauses and this simply does not resolve, which is
     * honest rather than falsely cheerful.
     */
    updatePrayer: (
      id: string,
      updates: Partial<PrayerRequest>,
      expectedRevision?: number | null,
      /** The edited fields as the form OPENED them — see the guard's baseline. */
      expectedBaseline?: Record<string, unknown> | null,
      recoveryDraft?: string
    ): WriteSubmission => {
      // The owner travels with the write, like create/addUpdate/status: without it a
      // refusal arriving after this screen closed has no reporter that can tell whose
      // words these are, and the person is told nothing.
      const vars = {
        id,
        userId: effectiveUserId ?? undefined,
        updates,
        expectedRevision,
        expectedBaseline,
        recoveryDraft,
      };
      if (hasPendingMutation<UpdatePrayerMutationVars>(
        PRAYER_MUTATION_KEYS.update,
        (pending) => pending.id === id && JSON.stringify(pending.updates) === JSON.stringify(updates)
      )) return skippedWrite();
      const request = updateMutation.mutateAsync(vars);
      return isOnline
        ? persistedWrite(request)
        : queuedMutation(`outbox:prayer:update:${id}`, request);
    },
    /** A refused save waiting for a decision — render the conflict choice. */
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
    statusConflict,
    keepMineOnStatusConflict,
    takeTheirsOnStatusConflict,
    deletePrayer: (id: string): WriteSubmission => {
      if (hasPendingMutation<string>(PRAYER_MUTATION_KEYS.delete, (pending) => pending === id)) {
        return skippedWrite();
      }
      return queuedMutation(`prayer:delete:${id}`, deleteMutation.mutateAsync(id));
    },
    addUpdate: (id: string, text: string, recoveryDraft?: string): WriteSubmission => {
      const vars = {
        id,
        // WHOSE write this is, carried in the payload itself. Without it a reporter
        // cannot tell a refusal of THIS person's text from one left in a shared cache by
        // a previous account — and these are the most valuable words in the app to lose.
        userId: effectiveUserId ?? undefined,
        updateId: newClientId(),
        text,
        createdAt: new Date().toISOString(),
        recoveryDraft,
      };
      return queuedMutation(`prayer:update:${vars.updateId}`, addUpdateMutation.mutateAsync(vars));
    },
    /**
     * AWAITED, like updatePrayer. Marking a prayer answered carries human text,
     * and this used to resolve the moment the write was SENT: the page announced
     * the change and closed the modal, the guarded write was refused afterwards,
     * and the typed answer — which lived only in that modal — was gone. Awaiting
     * the real outcome lets the caller keep the modal open and the words on screen.
     */
    setStatus: (
      id: string,
      status: PrayerStatus,
      answerText?: string,
      expectedRevision?: number | null,
      /** Status/answer as the modal OPENED them — see the guard's baseline. */
      expectedBaseline?: Record<string, unknown> | null,
      recoveryDraft?: string
    ): WriteSubmission => {
      const updatedAt = new Date().toISOString();
      const vars = {
        id,
        // See addUpdate: the owner travels with the write, so a late refusal can be
        // reported to the right person and to nobody else.
        userId: effectiveUserId ?? undefined,
        status,
        answerText,
        updatedAt,
        expectedRevision,
        expectedBaseline,
        recoveryDraft,
        ...(status === 'answered' ? { answeredAt: updatedAt } : {}),
      };
      if (hasPendingMutation<StatusMutationVars>(
        PRAYER_MUTATION_KEYS.status,
        (pending) =>
          pending.id === id && pending.status === status && pending.answerText === answerText
      )) return skippedWrite();
      const request = statusMutation.mutateAsync(vars);
      return isOnline
        ? persistedWrite(request)
        : queuedMutation(`outbox:prayer:status:${id}`, request);
    },
  };
}
