import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { Group, GroupMeetingDate } from '@/models/models';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { newClientId } from '@/utils/clientId';
import { GROUP_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
  addGroupMeetingDate,
  deleteGroup,
  deleteGroupMeetingDate,
  getGroupById,
  GROUP_CONTENT_AGGREGATE,
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

  /**
   * A refused edit, held so it can be re-offered instead of quietly dropped.
   *
   * The group write is fire-and-forget, so without this the refusal would land in
   * `reconcileWriteError`, read as a generic failure, and trigger a refetch that
   * replaces the person's still-unsent text with the server's — the silent loss
   * this whole mechanism exists to prevent. So a refusal does NOT refetch: the
   * typed text stays on screen and the choice is handed over.
   */
  const [saveConflict, setSaveConflict] = usePersistedConflict<Partial<Group>>(
    group?.userId,
    groupId,
    GROUP_CONTENT_AGGREGATE
  );
  const [resolvingConflict, setResolvingConflict] = useState(false);
  /**
   * Bumped when the person chose "take theirs" AND the fresh version really loaded.
   *
   * The screen needs this signal: its form initialises once per group id, so after a
   * refetch the inputs kept the OLD local text — the promised version never appeared,
   * and the next autosave conflicted all over again.
   */
  const [adoptRemoteNonce, setAdoptRemoteNonce] = useState(0);

  /**
   * How many own-doc writes are in flight.
   *
   * The group write is fire-and-forget (offline `updateDoc` never settles, so
   * awaiting it would hang autosave). That made the "Saved" indicator lie: it
   * appeared the moment the write was SENT, before the transaction could refuse
   * it. Counting in-flight writes lets the screen say "saving" until the backend
   * has actually answered — and offline it stays "saving", which is the truth.
   */
  const [pendingWrites, setPendingWrites] = useState(0);

  /**
   * The revision this hook last COMMITTED, kept out of band.
   * The cached group is refreshed asynchronously, so relying on it to learn what
   * we just wrote makes the next keystroke state the pre-write number and get
   * refused against the person's OWN save. Keyed by group id so it cannot leak
   * across a navigation.
   */
  const committedRevRef = useRef<{ groupId: string; revision: number } | null>(null);

  const updateGroupDetail = useCallback(
    async (
      updates: Partial<Group>,
      statedRevision?: number | null,
      /**
       * The content fields as the SCREEN OPENED them. Without it the service used
       * to hash its own fresh read — which compares the server with itself, always
       * agrees, and let a stale save replace what the other device stored.
       */
      expectedBaseline?: Record<string, unknown> | null
    ) => {
      if (!group) return;
      setMutationError(null);
      const id = group.id;
      const cachedRevision = group.rev?.[GROUP_CONTENT_AGGREGATE] ?? 0;
      const ownCommitted =
        committedRevRef.current?.groupId === group.id ? committedRevRef.current.revision : 0;
      const revision =
        statedRevision === undefined ? Math.max(cachedRevision, ownCommitted) : statedRevision;
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
      setPendingWrites((n) => n + 1);
      void updateGroup(id, updates, revision, expectedBaseline ?? null)
        .then((saved) => {
          // NAME the group this commit resolves: landing after the person opened
          // another group, an unnamed clear empties THAT group's slot instead.
          setSaveConflict(null, id);
          // Carry the COMMITTED revision into the caches. Without it the next
          // keystroke states the pre-write number and is refused against the
          // person's OWN save — a false conflict, and worse than before the guard.
          const committedRev = saved?.rev;
          const own = committedRev?.[GROUP_CONTENT_AGGREGATE];
          if (typeof own === 'number') committedRevRef.current = { groupId: id, revision: own };
          if (committedRev) {
            queryClient.setQueryData<Group | null>([QUERY_KEYS.GROUP_DETAIL, id], (old) =>
              old ? ({ ...old, rev: { ...(old.rev ?? {}), ...committedRev } } as Group) : old
            );
            queryClient.setQueryData<Group[]>([QUERY_KEYS.GROUPS, uid], (old) =>
              old
                ? old.map((g) =>
                    g.id === id ? ({ ...g, rev: { ...(g.rev ?? {}), ...committedRev } } as Group) : g
                  )
                : old
            );
          }
          // A group can be a series member; series views snapshot the group's title
          // (useSeriesDetail buildPayload -> getGroupById), so refresh them after a
          // content edit. `.then` fires on backend commit (immediately online, on
          // reconnect offline); offline the series queries are disabled so this is a
          // no-op until reconnect — matching the pre-migration invalidate contract.
          queryClient.invalidateQueries({ queryKey: ['series'] });
          queryClient.invalidateQueries({ queryKey: ['series-detail'] });
        })
        .finally(() => setPendingWrites((n) => Math.max(0, n - 1)))
        .catch((errorValue: unknown) => {
          if (isStaleWriteError(errorValue)) {
            // REFUSED, not failed. Deliberately NO refetch here — see above.
            setSaveConflict({ payload: updates, actualRevision: errorValue.actualRevision });
            toast.error(t('freshness.staleSaveToast'));
            return;
          }
          reconcileWriteError(errorValue);
        });
    },
    [group, queryClient, uid, reconcileWriteError, setSaveConflict, t]
  );

  /** Save the refused edit on top of the newer version — a deliberate overwrite. */
  const keepMineOnConflict = useCallback(async () => {
    if (!saveConflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Adopt the revision the server held AT REFUSAL, or the resend is refused
      // again and the button promises what it never performs.
      await updateGroupDetail(saveConflict.payload, saveConflict.actualRevision);
    } finally {
      setResolvingConflict(false);
    }
  }, [saveConflict, resolvingConflict, updateGroupDetail]);

  /** Drop the refused edit and load what the other device stored. */
  const takeTheirsOnConflict = useCallback(async () => {
    if (resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Judge by the REFETCH RESULT, not by invalidation. `invalidateQueries`
      // resolves even when the refetch fails, and TanStack's `refetch()` resolves
      // an error result rather than throwing — so a bare await would discard the
      // only copy of the typed text without ever loading the promised version.
      const result = await refetch();
      if (result.isError) {
        toast.error(t('workspaces.groups.errors.updateFailed', { defaultValue: 'Failed to update group' }));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GROUPS, uid] });
      setSaveConflict(null, groupId);
      // Now tell the form to adopt what just loaded — clearing the conflict alone
      // left the person looking at their own old text.
      setAdoptRemoteNonce((n) => n + 1);
    } finally {
      setResolvingConflict(false);
    }
  }, [resolvingConflict, queryClient, refetch, uid, groupId, setSaveConflict, t]);

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
    /** Writes sent but not yet answered — the UI must not claim "saved" while > 0. */
    pendingWrites,
    /** A refused save waiting for a decision — render the conflict choice. */
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
    adoptRemoteNonce,
  };
}
