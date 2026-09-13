'use client';

import { isCollectionOnEngine } from '@/data-engine/react.client';
import { useCouncils } from '@/hooks/useCouncils';
import { useCouncilsDataCollection } from '@/hooks/useCouncilsDataCollection';
import { COUNCILS_COLLECTION } from '@/services/councils.client';

import type { Council } from '@/models/models';

export interface CouncilsRead {
  councils: Council[];
  loading: boolean;
  error: unknown;
  refresh: () => unknown;
}

/**
 * THE ONE WAY TO READ COUNCILS, whichever road this deployment migrated.
 *
 * Screens that only display councils — the care hub, the breadcrumbs, the calendar — must not
 * each carry their own branch: a reader left on the legacy road while the domain moved shows a
 * council that was deleted, and the person cannot tell which screen is lying.
 *
 * Both hooks are called every render, because hooks cannot be called conditionally. That is safe:
 * without the engine the collection reader is idle and returns nothing, and with the engine the
 * legacy hook's read is the one this screen ignores. The cost is one extra list read while both
 * roads exist, which ends when the legacy hook is retired with the domain.
 */
export function useCouncilsRead(): CouncilsRead {
  const legacy = useCouncils();
  const engine = useCouncilsDataCollection();
  return isCollectionOnEngine(COUNCILS_COLLECTION)
    ? { councils: engine.councils, loading: engine.loading, error: engine.error, refresh: engine.refresh }
    : { councils: legacy.councils, loading: legacy.loading, error: legacy.error, refresh: legacy.refresh };
}
