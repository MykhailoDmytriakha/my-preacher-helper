import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { GROUP_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
  queuedMutation,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { recoveryText } from '@/utils/writeRecovery';
import { createGroup, deleteGroup, getAllGroups, updateGroup } from '@services/groups.service';

const GROUPS_PREFIX = ['groups'];
const GROUP_DETAIL_KEY = 'group-detail';
const buildQueryKey = (userId: string | null) => ['groups', userId];

export function useGroups(userId?: string | null) {
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
    data: groups = [],
    isLoading,
    error,
  } = useServerFirstQuery({
    queryKey: buildQueryKey(effectiveUserId),
    queryFn: () => (effectiveUserId ? getAllGroups(effectiveUserId) : Promise.resolve([])),
    enabled: !!effectiveUserId,
  });

  // CREATE — optimistic: insert a client-only temp row immediately so the UI
  // reflects the write even offline; on server success re-fetch the authoritative
  // list (drops the temp, pulls the real id); on error roll back. The mutationKey
  // ties this to the resumable default in mutationDefaults.ts so a write made
  // offline survives a page reload and replays on reconnect.
  const createMutation = useMutation({
    mutationKey: GROUP_MUTATION_KEYS.create,
    mutationFn: (payload: Omit<Group, 'id'> & { id?: string }) => createGroup(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Group[]>(buildQueryKey(effectiveUserId));
      const tempId = payload.id ?? newClientId();
      const optimistic = { ...payload, id: tempId } as Group;
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) => [
        optimistic,
        ...old,
      ]);
      setMutationError(null);
      return { previous, tempId };
    },
    onError: (errorValue: unknown, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), context.previous);
      }
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
    onSuccess: (created, _payload, context) => {
      // Swap the temp row for the real record directly (don't depend on the
      // refetch landing) so the cache is correct even if invalidate's refetch
      // is delayed or briefly fails; invalidate then confirms against the server.
      if (created?.id && context?.tempId) {
        queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) =>
          old.map((group) => (group.id === context.tempId ? created : group))
        );
      }
      queryClient.invalidateQueries({ queryKey: GROUPS_PREFIX });
      setMutationError(null);
    },
  });

  // CANONICAL EXAMPLE of refusal reporting — one descriptor instead of a hand-rolled
  // subscription per hook. The previous copies drifted: some covered one operation,
  // some none, and the wording diverged. See frontend/docs/recoverable-writes.md.
  useWriteRecovery<Omit<Group, 'id'> & { id?: string }>(queryClient, {
    mutationKey: GROUP_MUTATION_KEYS.create,
    fallbackTitleKey: 'writeRecovery.groupCreateFailed',
    titleParams: (payload) => ({ name: payload.title }),
    // Everything the person typed. A field missing here is a field they must retype.
    recoveryText: (payload) =>
      recoveryText([
        payload.title,
        payload.description,
        // The create form asks for a first meeting date; without it the copy hands back
        // a draft the person still has to complete from memory.
        ...(payload.meetingDates ?? []).map((meeting) => meeting.date),
      ]),
    toastId: (payload) => `write-recovery:group:create:${payload.id}`,
    owns: (payload) => Boolean(effectiveUserId) && payload.userId === effectiveUserId,
    retry: (payload) => createMutation.mutate(payload),
  });

  const updateMutation = useMutation({
    mutationKey: GROUP_MUTATION_KEYS.update,
    // `userId` is carried but not sent: it identifies WHOSE write this is for recovery
    // reporting after the screen that started it is gone.
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Group>; userId?: string }) =>
      updateGroup(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Group[]>(buildQueryKey(effectiveUserId));
      const previousDetail = queryClient.getQueryData<Group | null>([GROUP_DETAIL_KEY, id]);
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) =>
        old.map((group) => (group.id === id ? ({ ...group, ...updates } as Group) : group))
      );
      queryClient.setQueryData<Group | null>([GROUP_DETAIL_KEY, id], (old) =>
        old ? ({ ...old, ...updates } as Group) : old
      );
      setMutationError(null);
      return { previous, previousDetail, id };
    },
    onError: (errorValue: unknown, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), context.previous);
      }
      if (context?.id !== undefined) {
        queryClient.setQueryData([GROUP_DETAIL_KEY, context.id], context.previousDetail ?? null);
      }
      // NO direct toast: the recovery descriptor below reports this failure, and the
      // this refusal. A refusal that lands after this hook unmounts is the tracked debt
      // BUG-20260813-late-refusal-silent-after-navigation. Announcing here as well
      // gave the person two — sometimes three — messages for one refusal.
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
    onSuccess: (updated) => {
      if (updated?.id) {
        queryClient.setQueryData<Group | null>([GROUP_DETAIL_KEY, updated.id], updated);
      }
      queryClient.invalidateQueries({ queryKey: GROUPS_PREFIX });
      setMutationError(null);
    },
  });

  useWriteRecovery<{ id: string; updates: Partial<Group> }>(queryClient, {
    mutationKey: GROUP_MUTATION_KEYS.update,
    fallbackTitleKey: 'workspaces.groups.errors.updateFailed',
    titleParams: ({ updates }) => ({ name: updates.title }),
    recoveryText: ({ updates }) =>
      recoveryText([
        updates.title,
        updates.description,
        ...(updates.meetingDates ?? []).map((meeting) => meeting.date),
      ]),
    toastId: ({ id }) => `write-recovery:group:update:${id}`,
    // A group is this person's only if it is in THEIR loaded list — failed mutations
    // outlive a sign-out in a shared cache.
    ownershipEpoch: `${effectiveUserId ?? ''}:${groups.map((group) => group.id).join(',')}`,
    owns: ({ id }) => Boolean(effectiveUserId) && groups.some((group) => group.id === id),
    retry: (variables) => updateMutation.mutate(variables),
  });

  const deleteMutation = useMutation({
    mutationKey: GROUP_MUTATION_KEYS.delete,
    mutationFn: (groupId: string) => deleteGroup(groupId),
    onMutate: async (groupId) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Group[]>(buildQueryKey(effectiveUserId));
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) =>
        old.filter((group) => group.id !== groupId)
      );
      return { previous };
    },
    onError: (errorValue, _groupId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), context.previous);
      }
      // Same as update: one refusal, one reporter.
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
    onSuccess: (_result, groupId) => {
      queryClient.removeQueries({ queryKey: [GROUP_DETAIL_KEY, groupId] });
      queryClient.invalidateQueries({ queryKey: GROUPS_PREFIX });
      setMutationError(null);
    },
  });

  useWriteRecovery<string>(queryClient, {
    mutationKey: GROUP_MUTATION_KEYS.delete,
    fallbackTitleKey: 'workspaces.groups.errors.deleteFailed',
    // A delete carries no typed text to hand back — the row returning to the list is
    // the recovery — but the person still has to be TOLD, and offered the retry.
    recoveryText: () => undefined,
    toastId: (id) => `write-recovery:group:delete:${id}`,
    ownershipEpoch: `${effectiveUserId ?? ''}:${groups.map((group) => group.id).join(',')}`,
    // A restored failure from a shared cache must not be announced to whoever signs in
    // next: this delete is mine only if the group is (or was) in MY list.
    owns: (id) => Boolean(effectiveUserId) && groups.some((group) => group.id === id),
    retry: (id) => deleteMutation.mutate(id),
  });

  const refreshGroups = useCallback(async () => {
    if (!effectiveUserId || !isOnline) return;
    setMutationError(null);
    const updated = await getAllGroups(effectiveUserId);
    queryClient.setQueryData(buildQueryKey(effectiveUserId), updated);
    return updated;
  }, [effectiveUserId, isOnline, queryClient]);

  return {
    groups,
    loading: isLoading,
    /**
     * ONLY the query's error. A refused WRITE used to travel through this same field,
     * and the page renders that as a fatal state — the whole screen replaced, the open
     * editor and the list gone — for something that is recoverable and already reported
     * by the recovery descriptor. A write that fails must never cost the person the
     * screen they are working on.
     */
    error: (error as Error | null) ?? null,
    refreshGroups,
    /**
     * CANONICAL EXAMPLE of the write contract — copy THIS shape for a new entity.
     * See frontend/docs/recoverable-writes.md.
     *
     * Returns a `WriteSubmission`, never `Promise<void>`: the caller must be able to
     * tell "the server has it" from "a queue owns it", because only the first may be
     * announced as saved. The write itself stays fire-and-forget so it works offline;
     * React Query's persisted mutation is what takes ownership, and that ownership is
     * exactly what `queuedMutation` reports.
     */
    createNewGroup: (payload: Omit<Group, 'id'> & { id?: string }): WriteSubmission => {
      // Mint a stable client id so the create is idempotent (setDoc by this id):
      // a buffered create that ever replays overwrites the same doc instead of
      // allocating a fresh id and duplicating the group.
      const vars = { ...payload, id: payload.id ?? newClientId() };
      return queuedMutation(`group:create:${vars.id}`, createMutation.mutateAsync(vars));
    },
    // Every write here returns a `WriteSubmission`, including these two. They used to
    // return `Promise<void>` resolved on LAUNCH — the exact shape the contract exists
    // to abolish — sitting inside the hook the documentation points newcomers at.
    updateExistingGroup: (id: string, updates: Partial<Group>): WriteSubmission =>
      queuedMutation(
        `group:update:${id}`,
        // The owner travels WITH the write: a refusal that lands after this screen is
        // gone can then be reported to the right person, and to nobody else.
        updateMutation.mutateAsync({ id, updates, userId: effectiveUserId ?? undefined })
      ),
    deleteExistingGroup: (id: string): WriteSubmission =>
      queuedMutation(`group:delete:${id}`, deleteMutation.mutateAsync(id)),
  };
}
