import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group } from '@/models/models';
import { createGroup, deleteGroup, getAllGroups, updateGroup } from '@services/groups.service';

const buildQueryKey = (userId: string | null) => ['groups', userId];

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

  const createMutation = useMutation({
    mutationFn: (payload: Omit<Group, 'id'>) => createGroup(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) => [created, ...old]);
      setMutationError(null);
    },
    onError: (errorValue: unknown) => {
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Group> }) => updateGroup(id, updates),
    onSuccess: (updated) => {
      queryClient.setQueryData<Group[]>(buildQueryKey(effectiveUserId), (old = []) =>
        old.map((group) => (group.id === updated.id ? updated : group))
      );
      queryClient.setQueryData<Group | null>(['group-detail', updated.id], updated);
      setMutationError(null);
    },
    onError: (errorValue: unknown) => {
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
    },
  });

  const deleteMutation = useMutation({
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
      setMutationError(null);
    },
  });

  const mutationGuard = useCallback(
    async <TResult>(action: () => Promise<TResult>) => {
      if (!isOnline) {
        const offlineError = new Error('Offline: operation not available.');
        setMutationError(offlineError);
        throw offlineError;
      }
      setMutationError(null);
      try {
        return await action();
      } catch (errorValue: unknown) {
        const normalized =
          errorValue instanceof Error ? errorValue : new Error(String(errorValue));
        setMutationError(normalized);
        throw normalized;
      }
    },
    [isOnline]
  );

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
    createNewGroup: (payload: Omit<Group, 'id'>) =>
      mutationGuard(() => createMutation.mutateAsync(payload)),
    updateExistingGroup: (id: string, updates: Partial<Group>) =>
      mutationGuard(() => updateMutation.mutateAsync({ id, updates })),
    deleteExistingGroup: (id: string) => mutationGuard(() => deleteMutation.mutateAsync(id)),
  };
}
