import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { GROUP_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { createGroup, deleteGroup, getAllGroups, updateGroup } from '@services/groups.service';

const GROUPS_PREFIX = ['groups'];
const GROUP_DETAIL_KEY = 'group-detail';
const buildQueryKey = (userId: string | null) => ['groups', userId];

export function useGroups(userId?: string | null) {
  const { t } = useTranslation();
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
      toast.error(t('workspaces.groups.errors.createFailed', { defaultValue: 'Failed to create group' }));
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

  const updateMutation = useMutation({
    mutationKey: GROUP_MUTATION_KEYS.update,
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Group> }) => updateGroup(id, updates),
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
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
      toast.error(t('workspaces.groups.errors.updateFailed', { defaultValue: 'Failed to update group' }));
    },
    onSuccess: (updated) => {
      if (updated?.id) {
        queryClient.setQueryData<Group | null>([GROUP_DETAIL_KEY, updated.id], updated);
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
      toast.error(t('workspaces.groups.errors.deleteFailed', { defaultValue: 'Failed to delete group' }));
    },
    onSuccess: (_result, groupId) => {
      queryClient.removeQueries({ queryKey: [GROUP_DETAIL_KEY, groupId] });
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
    createNewGroup: async (payload: Omit<Group, 'id'> & { id?: string }) => {
      // Mint a stable client id so the create is idempotent (setDoc by this id):
      // a buffered create that ever replays overwrites the same doc instead of
      // allocating a fresh id and duplicating the group.
      createMutation.mutate({ ...payload, id: payload.id ?? newClientId() });
    },
    updateExistingGroup: async (id: string, updates: Partial<Group>) => {
      updateMutation.mutate({ id, updates });
    },
    deleteExistingGroup: async (id: string) => {
      deleteMutation.mutate(id);
    },
  };
}
