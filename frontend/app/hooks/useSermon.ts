import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useServerFirstQuery } from "@/hooks/useServerFirstQuery";
import { debugLog } from "@/utils/debugMode";
import { resolveOwnerUid, sermonDetailKey, sermonListKey } from "@/utils/queryKeys";
import { getSermonById } from "@services/sermon.service";

import type { Sermon, Thought } from "@/models/models";

type SermonUpdater = Sermon | null | ((previous: Sermon | null) => Sermon | null);

function useSermon(sermonId: string) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const uid = resolveOwnerUid();

  /**
   * The owner's list, READ THROUGH A SUBSCRIPTION rather than a one-off cache peek.
   *
   * This is the offline fallback: when the detail query has nothing, the sermon is
   * taken from the list the dashboard already loaded. A plain `getQueryData` inside
   * a memo samples the cache once and never hears about it again — which used to be
   * harmless only because the detail query itself was subscribed to the key the
   * persister restored. With the detail key now owner-scoped, that entry starts out
   * empty, so a list restored from IndexedDB moments later would never reach the
   * screen and an offline reader would be told there is no local copy of a sermon
   * sitting right there. `skipToken` means "never fetch this, just watch it".
   */
  const { data: cachedSermons = [] } = useQuery<Sermon[], Error, Sermon[], readonly unknown[]>({
    queryKey: sermonListKey(uid ?? ''),
    queryFn: skipToken,
    enabled: Boolean(uid),
    notifyOnChangeProps: ['data'],
  });

  const cachedSermonFromList = useMemo(
    () => cachedSermons.find((item) => item.id === sermonId) ?? null,
    [cachedSermons, sermonId]
  );

  const {
    data,
    isLoading: loading,
    error,
    refetch,
    isFetched,
    failureReason,
  } = useServerFirstQuery({
    queryKey: sermonDetailKey(uid, sermonId),
    queryFn: () => getSermonById(sermonId),
    enabled: Boolean(sermonId),
    initialData: () => cachedSermonFromList ?? undefined,
    initialDataUpdatedAt: () => {
      if (!uid) return undefined;
      return queryClient.getQueryState(sermonListKey(uid))?.dataUpdatedAt;
    },
    placeholderData: cachedSermonFromList ?? undefined,
  });

  useEffect(() => {
    if (isOnline) return;
    if (!sermonId || data || !cachedSermonFromList) return;
    queryClient.setQueryData(sermonDetailKey(uid, sermonId), cachedSermonFromList);
    debugLog("Sermon cache hydrated from list", { sermonId });
  }, [cachedSermonFromList, data, isOnline, queryClient, sermonId, uid]);

  const sermon = data ?? cachedSermonFromList ?? null;

  /**
   * A REFUSAL never reaches the screen as an error, and that is what trapped this
   * page in skeleton placeholders forever.
   *
   * Measured live 2026-07-28 on `/sermons/<foreign-id>`: Firestore rejects with
   * "Missing or insufficient permissions", React Query reads the failure as a lost
   * connection and PAUSES the retry — `fetchStatus:'paused'`, `status:'pending'`,
   * `error:null`, nothing in the console. The old test (`!sermon && !error`) reads
   * that as "still loading", so the page waited forever and its own "not found"
   * branch was unreachable.
   *
   * ⚠️ BUT PAUSED IS NOT THE SAME AS FINISHED, and treating it as such was the first
   * fix's mistake: a paused retry RESUMES on focus or reconnect, so a momentary
   * network failure would flash "not found" over a perfectly good sermon. What ends
   * the wait is therefore not the pause but the REASON: rules refusing the document
   * is an answer, and no amount of retrying will change it. Anything else — a
   * timeout, a dropped connection — is still on its way, and the page keeps waiting
   * exactly as it did before.
   */
  const refusalCode = (failureReason as { code?: string } | null | undefined)?.code;
  const refused = refusalCode === 'permission-denied' || refusalCode === 'not-found';

  const awaitingFirstAnswer =
    Boolean(sermonId) && !sermon && !error && isOnline && !isFetched && !refused;

  const setSermon = useCallback(
    async (updater: SermonUpdater) => {
      await queryClient.cancelQueries({ queryKey: sermonDetailKey(uid, sermonId) });
      queryClient.setQueryData(sermonDetailKey(uid, sermonId), (previous?: Sermon) => {
        const resolved = updater instanceof Function ? updater(previous ?? null) : updater;
        return resolved ?? undefined;
      });
      // Invalidate to ensure persisted cache syncs without immediate refetch
      queryClient.invalidateQueries({ queryKey: sermonDetailKey(uid, sermonId), refetchType: 'none' });

      // Also invalidate the global list so the dashboard reflects updated timestamps (like updatedAt)
      const currentUid = resolveOwnerUid();
      if (currentUid) {
        queryClient.invalidateQueries({ queryKey: sermonListKey(currentUid), refetchType: 'none' });
      }
    },
    [queryClient, sermonId, uid]
  );

  const refreshSermon = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const getSortedThoughts = (): Thought[] => {
    if (!sermon) return [];
    return [...sermon.thoughts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  };

  debugLog("useSermon state", {
    sermonId,
    hasSermon: !!sermon,
    loading,
    isOnline,
    hasData: !!data,
    hasCachedFromList: !!cachedSermonFromList,
    awaitingFirstAnswer
  });

  return {
    sermon,
    setSermon,
    loading,
    error: error as Error | null,
    isOnline,
    awaitingFirstAnswer,
    refreshSermon,
    getSortedThoughts,
  };
}

export default useSermon;
