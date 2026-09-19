'use client';

import { isCollectionOnEngine } from '@/data-engine/react.client';
import { useGroups } from '@/hooks/useGroups';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';

export function useGroupsRead(userId?: string | null) {
  const legacy = useGroups(userId);
  const engine = useGroupsDataCollection();
  return isCollectionOnEngine('groups') ? {
    ...engine, groups: userId ? engine.groups.filter(group => group.userId === userId) : engine.groups,
  } : { groups: legacy.groups, loading: legacy.loading, error: legacy.error, refreshGroups: legacy.refreshGroups };
}
