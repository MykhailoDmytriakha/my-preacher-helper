import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSermonById } from "@services/sermon.service";

import type { Sermon, Thought } from "@/models/models";

type SermonUpdater = Sermon | null | ((previous: Sermon | null) => Sermon | null);

function useSermon(sermonId: string) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

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

  const sermon = data ?? null;

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
