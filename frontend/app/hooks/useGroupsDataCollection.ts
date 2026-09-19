'use client';

import { useMemo } from 'react';

import { isCollectionOnEngine, useDataCollection } from '@/data-engine/react.client';
import { hydrateGroup } from '@/utils/groupDocument';

import type { Group } from '@/models/models';

/** One collection projection for list, dashboard, calendar and membership readers. */
export function useGroupsDataCollection(enabled = true) {
  const collection = useDataCollection(enabled && isCollectionOnEngine('groups') ? 'groups' : null);
  const groups = useMemo(() => (collection.state?.snapshots ?? [])
    .filter(snapshot => snapshot.value !== null && !snapshot.metadata?.deleted)
    .map(snapshot => hydrateGroup({ ...snapshot.value, id: snapshot.resource.id } as unknown as Group))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')), [collection.state]);
  return { groups, loading: collection.loading, error: collection.error, refreshGroups: collection.refresh,
    complete: collection.state?.complete ?? false, freshness: collection.state?.freshness ?? 'unknown' };
}
