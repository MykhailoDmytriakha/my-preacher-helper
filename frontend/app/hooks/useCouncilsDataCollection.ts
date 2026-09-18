'use client';

import { useMemo } from 'react';

import { useDataCollection } from '@/data-engine/react.client';
import { hydrateCouncil } from '@/services/councils.client';

import type { Council } from '@/models/models';

/**
 * COUNCILS READ THROUGH THE ENGINE.
 *
 * The same list `useCouncils` serves, taken from the shared collection instead of the domain's
 * own read. Only reading: the protocol marker is written by an engine write, so nothing here
 * changes a stored document and the switch alone reverses this path.
 *
 * Shaping stays `hydrateCouncil`, the one the legacy road already uses. A second copy of that
 * rule would drift, and a screen cannot tell which of the two produced the council it received.
 */
export function useCouncilsDataCollection() {
  const collection = useDataCollection('councils');
  const state = collection.state;
  const councils = useMemo<Council[]>(
    () =>
      (state?.snapshots ?? [])
        // Tombstones and confirmed absences stay in the collection state on purpose: the list
        // must not show them, while the engine still knows the deletion was confirmed.
        .filter(snapshot => snapshot.value !== null && !snapshot.metadata?.deleted)
        .map(snapshot => hydrateCouncil(snapshot.value as Record<string, unknown>, snapshot.resource.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
    [state]
  );
  /**
   * Every id the engine knows about — live councils, tombstones and confirmed absences alike.
   * The pre-database carry-over must not re-create a council that was deleted since.
   */
  const knownIds = useMemo(() => new Set((state?.snapshots ?? []).map(snapshot => snapshot.resource.id)), [state]);
  return {
    councils,
    knownIds,
    /**
     * `complete` alone is loaded from the disk cursor of an EARLIER session, offline included;
     * "the server answered" needs this session's server read as well.
     */
    serverAnswered: Boolean(state?.complete) && state?.freshness === 'server',
    loading: collection.loading,
    error: collection.error,
    /** False means the cache is partial: an empty list is then unknown, not "no councils". */
    complete: state?.complete ?? false,
    freshness: state?.freshness ?? 'unknown',
    refresh: collection.refresh,
  };
}
