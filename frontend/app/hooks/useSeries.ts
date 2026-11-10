import { useResolvedUid } from "@/hooks/useResolvedUid";
import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';

/** The caller's series from the data engine (series are engine-owned). */
export function useSeries(userId?: string | null) {
  const { uid: resolvedUid } = useResolvedUid();
  const effectiveUserId = userId ?? resolvedUid ?? null;
  const engine = useSeriesDataCollection(true, effectiveUserId);
  return {
    series: engine.series,
    loading: engine.loading,
    complete: engine.complete,
    checking: engine.checking,
    error: engine.error ? new Error(engine.error) : null,
    refreshSeries: async () => { await engine.refreshSeries(); },
  };
}
