import { useState, useEffect } from "react";
import { getSermonById } from "@services/sermon.service";
import type { Sermon, Thought } from "@/models/models";

function useSermon(sermonId: string) {
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshSermon = async () => {
    setLoading(true);
    try {
      const data = await getSermonById(sermonId);
      setSermon(data || null);
    } catch (e: any) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sermonId) {
      refreshSermon();
    }
  }, [sermonId]);

  const getSortedThoughts = (): Thought[] => {
    if (!sermon) return [];
    return [...sermon.thoughts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  };

  return { sermon, setSermon, loading, error, refreshSermon, getSortedThoughts };
}

export default useSermon;
