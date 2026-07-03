import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group, GroupMeetingDate } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { GROUP_MUTATION_KEYS } from '@/utils/mutationDefaults';
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const { uid } = useResolvedUid();

  // Read connectivity AT CATCH-TIME, not from a value closured into a callback:
  // a captured `isOnline` goes stale, so an offline write's `.catch` would read
  // the online value it was created with and toast a false alarm.
  const isOnline = useOnlineStatus();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  const { data, isLoading, error, refetch } = useServerFirstQuery<Group | null>({
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

  // Shared hard-error handler for the fire-and-forget own-doc writes below. A
  // getDoc-first RMW rejects offline on a cache-miss (pre-existing to the whole
  // client-SDK own-doc pattern — thoughts/preachDates share it), so OFFLINE we do
  // NOT toast: the common offline path succeeds via the native queue and toasting
  // there is a false alarm. ONLINE, a reject is a real hard error (permission/
  // validation the queue won't retry) -> reconcile to the server + toast. The
  // online invalidate may transiently drop an in-flight sibling optimistic patch;
  // it self-heals on the next refetch and only runs on rare online hard errors.
  const reconcileWriteError = useCallback(
    (errorValue: unknown) => {
      const normalized = errorValue instanceof Error ? errorValue : new Error(String(errorValue));
      setMutationError(normalized);
      if (isOnlineRef.current) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUP_DETAIL, groupId] });
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS, uid] });
        toast.error(t('workspaces.groups.errors.updateFailed', { defaultValue: 'Failed to update group' }));
      } else {
        console.error(errorValue);
      }
    },
    [queryClient, groupId, uid, t]
  );

  const updateGroupDetail = useCallback(
    async (updates: Partial<Group>) => {
      if (!group) return;
      setMutationError(null);
      const id = group.id;
      // Cancel any in-flight ['group-detail'] refetch before the optimistic write,
      // else a slower server-first refetch can resolve with pre-edit data and clobber
      // the optimistic patch (restores the pre-migration guard dropped in the rewrite).
      // updateGroupDetail runs first in performSave, so this also protects the
      // meeting-date optimistic writes that follow in the same autosave batch.
      await queryClient.cancelQueries({ queryKey: [QUERY_KEYS.GROUP_DETAIL, id] });
      // Field-disjoint invariant: the content write sets ONLY content fields
      // ({title,description,status,templates,flow} + updatedAt), NEVER meetingDates.
      // The meeting-date writes below set ONLY {meetingDates,updatedAt}. Because
      // the write-sets don't overlap, two RMW writes to the same group doc in one
      // autosave compose without clobbering — do NOT merge meeting fields here.
      queryClient.setQueryData<Group | null>([QUERY_KEYS.GROUP_DETAIL, id], (old) =>
        old ? ({ ...old, ...updates } as Group) : old
      );
      queryClient.setQueryData<Group[]>([QUERY_KEYS.GROUPS, uid], (old) =>
        old ? old.map((g) => (g.id === id ? ({ ...g, ...updates } as Group) : g)) : old
      );
      // Fire-and-forget: offline `updateDoc` never resolves (Firestore queues it
      // natively), so awaiting would hang the caller's autosave. The optimistic
      // writes above keep the UI truthful; durability lives in the offline queue.
      void updateGroup(id, updates)
        .then(() => {
          // A group can be a series member; series views snapshot the group's title
          // (useSeriesDetail buildPayload -> getGroupById), so refresh them after a
          // content edit. `.then` fires on backend commit (immediately online, on
          // reconnect offline); offline the series queries are disabled so this is a
          // no-op until reconnect — matching the pre-migration invalidate contract.
          queryClient.invalidateQueries({ queryKey: ['series'] });
          queryClient.invalidateQueries({ queryKey: ['series-detail'] });
        })
        .catch(reconcileWriteError);
    },
    [group, queryClient, uid, reconcileWriteError]
  );

  const addMeetingDate = useCallback(
    async (payload: Omit<GroupMeetingDate, 'id' | 'createdAt'>) => {
      if (!group) return;
      setMutationError(null);
      const id = group.id;
      // Caller mints the id so the buffered add is idempotent (upsert-by-id).
      const dateId = newClientId();
      const optimistic: GroupMeetingDate = { ...payload, id: dateId, createdAt: new Date().toISOString() };
      // Derive the next array from the CACHE (old.meetingDates), never from a
      // closured `group` snapshot, so a combined content+meeting autosave composes.
      queryClient.setQueryData<Group | null>([QUERY_KEYS.GROUP_DETAIL, id], (old) =>
        old ? ({ ...old, meetingDates: [...(old.meetingDates || []), optimistic] } as Group) : old
      );
      queryClient.setQueryData<Group[]>([QUERY_KEYS.GROUPS, uid], (old) =>
        old
          ? old.map((g) =>
              g.id === id ? ({ ...g, meetingDates: [...(g.meetingDates || []), optimistic] } as Group) : g
            )
          : old
      );
      void addGroupMeetingDate(id, { ...payload, id: dateId }).catch(reconcileWriteError);
    },
    [group, queryClient, uid, reconcileWriteError]
  );

  const updateMeetingDate = useCallback(
    async (dateId: string, updates: Partial<GroupMeetingDate>) => {
      if (!group) return;
      setMutationError(null);
      const id = group.id;
      const patch = (dates: GroupMeetingDate[] | undefined) =>
        (dates || []).map((entry) => (entry.id === dateId ? ({ ...entry, ...updates } as GroupMeetingDate) : entry));
      queryClient.setQueryData<Group | null>([QUERY_KEYS.GROUP_DETAIL, id], (old) =>
        old ? ({ ...old, meetingDates: patch(old.meetingDates) } as Group) : old
      );
      queryClient.setQueryData<Group[]>([QUERY_KEYS.GROUPS, uid], (old) =>
        old ? old.map((g) => (g.id === id ? ({ ...g, meetingDates: patch(g.meetingDates) } as Group) : g)) : old
      );
      void updateGroupMeetingDate(id, dateId, updates).catch(reconcileWriteError);
    },
    [group, queryClient, uid, reconcileWriteError]
  );

  const removeMeetingDate = useCallback(
    async (dateId: string) => {
      if (!group) return;
      setMutationError(null);
      const id = group.id;
      const patch = (dates: GroupMeetingDate[] | undefined) =>
        (dates || []).filter((entry) => entry.id !== dateId);
      queryClient.setQueryData<Group | null>([QUERY_KEYS.GROUP_DETAIL, id], (old) =>
        old ? ({ ...old, meetingDates: patch(old.meetingDates) } as Group) : old
      );
      queryClient.setQueryData<Group[]>([QUERY_KEYS.GROUPS, uid], (old) =>
        old ? old.map((g) => (g.id === id ? ({ ...g, meetingDates: patch(g.meetingDates) } as Group) : g)) : old
      );
      void deleteGroupMeetingDate(id, dateId).catch(reconcileWriteError);
    },
    [group, queryClient, uid, reconcileWriteError]
  );

  // Delete goes through a keyed, persisted mutation (mirror useGroups.deleteMutation)
  // so an offline delete is buffered + replays on reconnect. The server cascades
  // via removeGroupFromAllSeries, which is why delete stays a server fetch.
  const deleteMutation = useMutation({
    mutationKey: GROUP_MUTATION_KEYS.delete,
    mutationFn: (id: string) => deleteGroup(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [QUERY_KEYS.GROUPS, uid] });
      const previous = queryClient.getQueryData<Group[]>([QUERY_KEYS.GROUPS, uid]);
      queryClient.setQueryData<Group[]>([QUERY_KEYS.GROUPS, uid], (old) =>
        old ? old.filter((g) => g.id !== id) : old
      );
      setMutationError(null);
      return { previous };
    },
    onError: (errorValue, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData([QUERY_KEYS.GROUPS, uid], context.previous);
      }
      setMutationError(errorValue instanceof Error ? errorValue : new Error(String(errorValue)));
      toast.error(t('workspaces.groups.errors.deleteFailed', { defaultValue: 'Failed to delete group' }));
    },
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: [QUERY_KEYS.GROUP_DETAIL, id] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS] });
      setMutationError(null);
    },
  });

  const deleteGroupDetail = useCallback(() => {
    if (!group) return;
    // Fire-and-forget: resolves immediately so the caller can navigate away even
    // offline; the mutation pauses + persists and replays on reconnect.
    deleteMutation.mutate(group.id);
  }, [group, deleteMutation]);

  return {
    group,
    loading: isLoading,
    error: (error as Error | null) ?? mutationError,
    refreshGroupDetail,
    updateGroupDetail,
    addMeetingDate,
    updateMeetingDate,
    removeMeetingDate,
    deleteGroupDetail,
  };
}
