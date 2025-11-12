import { useState, useEffect, useCallback } from "react";
import { getAllSeries } from "@services/series.service";
import { createSeries, updateSeries, deleteSeries } from "@services/series.service";
import { addSermonToSeries, removeSermonFromSeries, reorderSermons } from "@services/series.service";
import type { Series } from "@/models/models";

export function useSeries(userId: string | null) {
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshSeries = useCallback(async () => {
    if (!userId) {
      setSeries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await getAllSeries(userId);
      setSeries(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refreshSeries();
  }, [refreshSeries]);

  const createNewSeries = useCallback(async (seriesData: Omit<Series, 'id'>) => {
    try {
      const newSeries = await createSeries(seriesData);
      setSeries(prev => [newSeries, ...prev]);
      return newSeries;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, []);

  const updateExistingSeries = useCallback(async (seriesId: string, updates: Partial<Series>) => {
    try {
      const updatedSeries = await updateSeries(seriesId, updates);
      setSeries(prev => prev.map(s => s.id === seriesId ? updatedSeries : s));
      return updatedSeries;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, []);

  const deleteExistingSeries = useCallback(async (seriesId: string) => {
    try {
      await deleteSeries(seriesId);
      setSeries(prev => prev.filter(s => s.id !== seriesId));
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, []);

  const addSermon = useCallback(async (seriesId: string, sermonId: string, position?: number) => {
    try {
      await addSermonToSeries(seriesId, sermonId, position);
      // Refresh to get updated series data
      await refreshSeries();
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [refreshSeries]);

  const removeSermon = useCallback(async (seriesId: string, sermonId: string) => {
    try {
      await removeSermonFromSeries(seriesId, sermonId);
      // Refresh to get updated series data
      await refreshSeries();
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [refreshSeries]);

  const reorderSeriesSermons = useCallback(async (seriesId: string, sermonIds: string[]) => {
    try {
      await reorderSermons(seriesId, sermonIds);
      // Refresh to get updated series data
      await refreshSeries();
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      throw error;
    }
  }, [refreshSeries]);

  return {
    series,
    loading,
    error,
    refreshSeries,
    createNewSeries,
    updateExistingSeries,
    deleteExistingSeries,
    addSermon,
    removeSermon,
    reorderSeriesSermons
  };
}
