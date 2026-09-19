'use client';

import { useMemo } from 'react';

import { isCollectionOnEngine, useDataCollection } from '@/data-engine/react.client';
import { hydrateSermon, sortSermons } from '@/utils/sermonDocument';

import type { Sermon } from '@/models/models';

/** Lists render submitted work; editors still obtain their own confirmed opening copy. */
export function useSermonsDataCollection(enabled = true) {
  const collection = useDataCollection(enabled && isCollectionOnEngine('sermons') ? 'sermons' : null);
  const sermons = useMemo(() => sortSermons((collection.state?.documents ?? collection.state?.snapshots ?? [])
    .filter(snapshot => snapshot.value !== null)
    .map(snapshot => hydrateSermon({ ...snapshot.value, id: snapshot.resource.id } as unknown as Sermon))), [collection.state]);
  return { sermons, loading: collection.loading, error: collection.error, refresh: collection.refresh,
    state: collection.state, complete: collection.state?.complete ?? false };
}
