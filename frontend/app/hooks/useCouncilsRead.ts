'use client';

import { useCouncilsDataCollection } from '@/hooks/useCouncilsDataCollection';

import type { Council } from '@/models/models';

export interface CouncilsRead {
  councils: Council[];
  loading: boolean;
  complete: boolean;
  checking: boolean;
  error: unknown;
  refresh: () => unknown;
}

/**
 * THE ONE WAY TO READ COUNCILS. Screens that only display councils — the care hub and
 * the calendar — read the engine collection through here and never carry their own
 * branch, so no screen can show a council another screen already knows is gone.
 */
export function useCouncilsRead(): CouncilsRead {
  const engine = useCouncilsDataCollection();
  return { councils: engine.councils, loading: engine.loading, complete: engine.complete,
    checking: engine.state?.checking === true, error: engine.error, refresh: engine.refresh };
}
