import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useServerFirstQuery } from "@/hooks/useServerFirstQuery";
import { debugLog } from "@/utils/debugMode";
import { auth } from "@services/firebaseAuth.service";
import { getSermonById } from "@services/sermon.service";

import type { Sermon, Thought } from "@/models/models";

type SermonUpdater = Sermon | null | ((previous: Sermon | null) => Sermon | null);

function resolveUid(): string | undefined {
  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    return currentUser.uid;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const guestData = window.localStorage.getItem('guestUser');
    if (!guestData) {
      return undefined;
    }

    const parsed = JSON.parse(guestData) as { uid?: string };
    return parsed.uid;
  } catch (error) {
    console.error('Error parsing guestUser from localStorage', error);
    return undefined;
  }
}

function useSermon(sermonId: string) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const uid = resolveUid();

  const cachedSermons = useMemo(() => {
    if (!uid) return [];
    return queryClient.getQueryData<Sermon[]>(['sermons', uid]) ?? [];
  }, [queryClient, uid]);

  const cachedSermonFromList = useMemo(
    () => cachedSermons.find((item) => item.id === sermonId) ?? null,
    [cachedSermons, sermonId]
  );

  const {
    data,
    isLoading: loading,
    error,
    refetch,
  } = useServerFirstQuery({
    queryKey: ["sermon", sermonId],
    queryFn: () => getSermonById(sermonId),
    enabled: Boolean(sermonId),
  });

  useEffect(() => {
    if (isOnline) return;
    if (!sermonId || data || !cachedSermonFromList) return;
    queryClient.setQueryData(["sermon", sermonId], cachedSermonFromList);
    debugLog("Sermon cache hydrated from list", { sermonId });
  }, [cachedSermonFromList, data, isOnline, queryClient, sermonId]);

  const sermon = data ?? (isOnline ? null : cachedSermonFromList) ?? null;

  const setSermon = useCallback(
    async (updater: SermonUpdater) => {
      await queryClient.cancelQueries({ queryKey: ["sermon", sermonId] });
      queryClient.setQueryData(["sermon", sermonId], (previous?: Sermon) => {
        const resolved = updater instanceof Function ? updater(previous ?? null) : updater;
        return resolved ?? undefined;
      });
      // Invalidate to ensure persisted cache syncs without immediate refetch
      queryClient.invalidateQueries({ queryKey: ["sermon", sermonId], refetchType: 'none' });
    },
    [queryClient, sermonId]
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
    hasCachedFromList: !!cachedSermonFromList
  });

  return { sermon, setSermon, loading, error: error as Error | null, refreshSermon, getSortedThoughts };
}

export default useSermon;
