'use client';

import { useMemo } from 'react';

import { isCollectionOnEngine, useDataCollection } from '@/data-engine/react.client';
import { hydrateSeries, sortSeries } from '@/utils/seriesDocument';

import type { Series } from '@/models/models';

/** Domain shape only. Confirmed copies, submitted overlays and freshness belong to the engine. */
export function useSeriesDataCollection(enabled = true, owner?: string | null) {
  const collection = useDataCollection(enabled && owner !== null && isCollectionOnEngine('series') ? 'series' : null);
  const series = useMemo(() => sortSeries((collection.state?.documents ?? collection.state?.snapshots ?? [])
    .filter(snapshot => snapshot.value !== null && (owner === undefined || snapshot.value.userId === owner))
    .map(snapshot => hydrateSeries({ ...snapshot.value, id: snapshot.resource.id } as unknown as Series))), [collection.state, owner]);
  return { series, loading: collection.loading, error: collection.error, refreshSeries: collection.refresh,
    state: collection.state, complete: collection.state?.complete ?? false, freshness: collection.state?.freshness ?? 'unknown' };
}
