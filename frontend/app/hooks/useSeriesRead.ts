'use client';

import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';

/** Read-only chrome must not open its own editable copy of the series. */
export function useSeriesRead(seriesId: string) {
  const engine = useSeriesDataCollection(Boolean(seriesId));
  return { series: engine.series.find(series => series.id === seriesId) ?? null, loading: engine.loading, error: engine.error };
}
