import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSermonById } from "@services/sermon.service";
import { debugLog } from "@/utils/debugMode";
import { auth } from "@services/firebaseAuth.service";

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

  const { data: cachedSermons = [] } = useQuery<Sermon[]>({
    queryKey: ['sermons', uid],
    queryFn: () => Promise.resolve([]),
    enabled: false,
    staleTime: 60 * 1000,
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
  } = useQuery({
    queryKey: ["sermon", sermonId],
    queryFn: () => getSermonById(sermonId),
    enabled: Boolean(sermonId) && isOnline,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!sermonId || data || !cachedSermonFromList) return;
    queryClient.setQueryData(["sermon", sermonId], cachedSermonFromList);
    debugLog("Sermon cache hydrated from list", { sermonId });
  }, [cachedSermonFromList, data, queryClient, sermonId]);

  const sermon = data ?? cachedSermonFromList ?? null;

  const setSermon = useCallback(
    (updater: SermonUpdater) => {
      queryClient.setQueryData(["sermon", sermonId], (previous?: Sermon) => {
        const resolved = updater instanceof Function ? updater(previous ?? null) : updater;
        return resolved ?? undefined;
      });
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

  return { sermon, setSermon, loading, error: error as Error | null, refreshSermon, getSortedThoughts };
}

export default useSermon;
