import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group } from '@/models/models';
import { GROUP_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { createGroup, deleteGroup, getAllGroups, updateGroup } from '@services/groups.service';

const GROUPS_PREFIX = ['groups'];
const buildQueryKey = (userId: string | null) => ['groups', userId];

const genTempId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `temp-${crypto.randomUUID()}`
    : `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function useGroups(userId?: string | null) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
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
    mutationFn: (payload: Omit<Group, 'id'>) => createGroup(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Group[]>(buildQueryKey(effectiveUserId));
      const optimistic = { ...payload, id: genTempId() } as Group;
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) => [
        optimistic,
        ...old,
      ]);
      setMutationError(null);
      return { previous };
    },
    onError: (errorValue: unknown, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(buildQueryKey(effectiveUserId), context.previous);
      }
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_PREFIX });
      setMutationError(null);
    },
  });

  const updateMutation = useMutation({
    mutationKey: GROUP_MUTATION_KEYS.update,
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Group> }) => updateGroup(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(effectiveUserId) });
      const previous = queryClient.getQueryData<Group[]>(buildQueryKey(effectiveUserId));
      const previousDetail = queryClient.getQueryData<Group | null>(['group-detail', id]);
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) =>
        old.map((group) => (group.id === id ? ({ ...group, ...updates } as Group) : group))
      );
      queryClient.setQueryData<Group | null>(['group-detail', id], (old) =>
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
        queryClient.setQueryData(['group-detail', context.id], context.previousDetail ?? null);
      }
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
    onSuccess: (updated) => {
      if (updated?.id) {
        queryClient.setQueryData<Group | null>(['group-detail', updated.id], updated);
      }
      queryClient.invalidateQueries({ queryKey: GROUPS_PREFIX });
      setMutationError(null);
    },
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
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
    onSuccess: (_result, groupId) => {
      queryClient.removeQueries({ queryKey: ['group-detail', groupId] });
      queryClient.invalidateQueries({ queryKey: GROUPS_PREFIX });
      setMutationError(null);
    },
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
    error: (error as Error | null) ?? mutationError,
    refreshGroups,
    // Fire-and-forget + optimistic: resolves immediately so the UI (modal close,
    // toast) proceeds without awaiting the network. Offline, the underlying
    // mutation pauses + persists and replays on reconnect; the optimistic cache
    // update from onMutate keeps the write visible meanwhile.
    createNewGroup: async (payload: Omit<Group, 'id'>) => {
      createMutation.mutate(payload);
    },
    updateExistingGroup: async (id: string, updates: Partial<Group>) => {
      updateMutation.mutate({ id, updates });
    },
    deleteExistingGroup: async (id: string) => {
      deleteMutation.mutate(id);
    },
  };
}
