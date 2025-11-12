import { useState, useEffect, useCallback } from "react";
import { getSeriesById } from "@services/series.service";
import { getSermonById } from "@services/sermon.service";
import { addSermonToSeries, removeSermonFromSeries, reorderSermons as reorderSermonsAPI, updateSeries } from "@services/series.service";
import type { Series, Sermon } from "@/models/models";

export function useSeriesDetail(seriesId: string) {
  const [series, setSeries] = useState<Series | null>(null);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshSeriesDetail = useCallback(async () => {
    if (!seriesId) {
      setSeries(null);
      setSermons([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Get series data
      const seriesData = await getSeriesById(seriesId);
      if (!seriesData) {
        throw new Error('Series not found');
      }

      setSeries(seriesData);

      // Get all sermons in the series
      const sermonsPromises = seriesData.sermonIds.map(sermonId => getSermonById(sermonId));
      const sermonsData = await Promise.all(sermonsPromises);

      // Filter out undefined sermons and sort by position
      const validSermons = sermonsData
        .filter((sermon): sermon is Sermon => sermon !== undefined)
        .sort((a, b) => (a.seriesPosition || 0) - (b.seriesPosition || 0));

      setSermons(validSermons);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setSeries(null);
      setSermons([]);
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    refreshSeriesDetail();
  }, [refreshSeriesDetail]);

  const addSermon = useCallback(async (sermonId: string, position?: number) => {
    if (!series) return;

    try {
      await addSermonToSeries(series.id, sermonId, position);
      await refreshSeriesDetail();
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [series, refreshSeriesDetail]);

  const addSermons = useCallback(async (sermonIds: string[]) => {
    if (!series) return;

    // Store previous state for potential rollback
    const previousSermons = [...sermons];

    try {
      // Optimistically add sermons to local state
      const newSermonsPromises = sermonIds.map(async (sermonId) => {
        // Get sermon data
        const sermonData = await getSermonById(sermonId);
        if (sermonData) {
          // Add series metadata
          return {
            ...sermonData,
            seriesId: series.id,
            seriesPosition: sermons.length + sermonIds.indexOf(sermonId) + 1
          };
        }
        return null;
      });

      const newSermons = (await Promise.all(newSermonsPromises)).filter((sermon): sermon is NonNullable<typeof sermon> => sermon !== null && sermon !== undefined);

      // Update local state immediately
      setSermons(prevSermons => [...prevSermons, ...newSermons]);

      // Send API requests
      await Promise.all(sermonIds.map(sermonId => addSermonToSeries(series.id, sermonId)));

    } catch (e: unknown) {
      // Rollback on error
      setSermons(previousSermons);
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [series, sermons, setSermons, setError]);

  const removeSermon = useCallback(async (sermonId: string) => {
    if (!series) return;

    // Store previous state for potential rollback
    const previousSermons = [...sermons];

    try {
      // Optimistically remove sermon from local state
      setSermons(prevSermons => prevSermons.filter(sermon => sermon.id !== sermonId));

      // Send API request
      await removeSermonFromSeries(series.id, sermonId);

    } catch (e: unknown) {
      // Rollback on error
      setSermons(previousSermons);
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [series, sermons, setSermons, setError]);

  const reorderSeriesSermons = useCallback(async (sermonIds: string[]) => {
    if (!series) return;

    // Store previous state for potential rollback
    const previousSermons = [...sermons];

    // Optimistically update UI with new order
    const reorderedSermons = sermonIds.map((sermonId, index) => {
      const sermon = sermons.find(s => s.id === sermonId);
      if (sermon) {
        return { ...sermon, seriesPosition: index + 1 };
      }
      throw new Error(`Sermon with id ${sermonId} not found`);
    });

    setSermons(reorderedSermons);

    try {
      await reorderSermonsAPI(series.id, sermonIds);
    } catch (e: unknown) {
      // Rollback on error
      setSermons(previousSermons);
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [series, sermons, setSermons, setError]);

  const updateSeriesDetail = useCallback(async (updates: Partial<Series>) => {
    if (!series) return;

    try {
      await updateSeries(series.id, updates);
      await refreshSeriesDetail();
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [series, refreshSeriesDetail]);

  return {
    series,
    sermons,
    loading,
    error,
    refreshSeriesDetail,
    addSermon,
    addSermons,
    removeSermon,
    reorderSeriesSermons,
    updateSeriesDetail
  };
}
