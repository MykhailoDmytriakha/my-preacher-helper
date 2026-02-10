import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group, GroupMeetingDate } from '@/models/models';
import {
  addGroupMeetingDate,
  deleteGroup,
  deleteGroupMeetingDate,
  getGroupById,
  updateGroup,
  updateGroupMeetingDate,
} from '@services/groups.service';

const QUERY_KEYS = {
  GROUP_DETAIL: 'group-detail',
  GROUPS: 'groups',
} as const;

export function useGroupDetail(groupId: string) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useServerFirstQuery<Group | null>({
    queryKey: [QUERY_KEYS.GROUP_DETAIL, groupId],
    enabled: !!groupId,
    queryFn: async () => {
      if (!groupId) return null;
      const group = await getGroupById(groupId);
      if (!group) {
        throw new Error('Group not found');
      }
      return group;
    },
  });

  const group = data ?? null;

  const refreshGroupDetail = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const updateGroupDetail = useCallback(
    async (updates: Partial<Group>) => {
      if (!group) return;
      setMutationError(null);
      try {
        const updated = await updateGroup(group.id, updates);
        queryClient.setQueryData([QUERY_KEYS.GROUP_DETAIL, groupId], updated);
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS] });
      } catch (errorValue: unknown) {
        const normalized =
          errorValue instanceof Error ? errorValue : new Error(String(errorValue));
        setMutationError(normalized);
        throw normalized;
      }
    },
    [group, groupId, queryClient]
  );

  const addMeetingDate = useCallback(
    async (payload: Omit<GroupMeetingDate, 'id' | 'createdAt'>) => {
      if (!group) return;
      setMutationError(null);
      try {
        await addGroupMeetingDate(group.id, payload);
        await refreshGroupDetail();
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS] });
      } catch (errorValue: unknown) {
        const normalized =
          errorValue instanceof Error ? errorValue : new Error(String(errorValue));
        setMutationError(normalized);
        throw normalized;
      }
    },
    [group, refreshGroupDetail, queryClient]
  );

  const updateMeetingDate = useCallback(
    async (dateId: string, updates: Partial<GroupMeetingDate>) => {
      if (!group) return;
      setMutationError(null);
      try {
        await updateGroupMeetingDate(group.id, dateId, updates);
        await refreshGroupDetail();
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS] });
      } catch (errorValue: unknown) {
        const normalized =
          errorValue instanceof Error ? errorValue : new Error(String(errorValue));
        setMutationError(normalized);
        throw normalized;
      }
    },
    [group, refreshGroupDetail, queryClient]
  );

  const removeMeetingDate = useCallback(
    async (dateId: string) => {
      if (!group) return;
      setMutationError(null);
      try {
        await deleteGroupMeetingDate(group.id, dateId);
        await refreshGroupDetail();
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS] });
      } catch (errorValue: unknown) {
        const normalized =
          errorValue instanceof Error ? errorValue : new Error(String(errorValue));
        setMutationError(normalized);
        throw normalized;
      }
    },
    [group, refreshGroupDetail, queryClient]
  );

  const deleteGroupDetail = useCallback(async () => {
    if (!group) return;
    setMutationError(null);
    try {
      await deleteGroup(group.id);
      queryClient.removeQueries({ queryKey: [QUERY_KEYS.GROUP_DETAIL, group.id] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS] });
    } catch (errorValue: unknown) {
      const normalized =
        errorValue instanceof Error ? errorValue : new Error(String(errorValue));
      setMutationError(normalized);
      throw normalized;
    }
  }, [group, queryClient]);

  return {
    group,
    loading: isLoading || isFetching,
    error: (error as Error | null) ?? mutationError,
    refreshGroupDetail,
    updateGroupDetail,
    addMeetingDate,
    updateMeetingDate,
    removeMeetingDate,
    deleteGroupDetail,
  };
}
