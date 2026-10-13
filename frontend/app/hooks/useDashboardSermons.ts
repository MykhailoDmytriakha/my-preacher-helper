import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';
import { Sermon } from '@/models/models';

interface UseDashboardSermonsResult {
  sermons: Sermon[];
  loading: boolean;
  error: Error | string | null;
  state?: ReturnType<typeof useSermonsDataCollection>['state'];
  refresh: () => Promise<void>;
}

/** The owner's sermons, read from the engine's collection on this device. */
export function useDashboardSermons(): UseDashboardSermonsResult {
  const engine = useSermonsDataCollection();
  return { ...engine, refresh: async () => { await engine.refresh(); } };
}

export default useDashboardSermons;
