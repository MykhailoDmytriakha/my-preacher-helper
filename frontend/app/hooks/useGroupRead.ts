'use client';

import { isCollectionOnEngine } from '@/data-engine/react.client';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';

/** Read-only chrome must not open its own editable copy of the group. */
export function useGroupRead(groupId: string) {
  const legacy = useGroupDetail(groupId);
  const engine = useGroupsDataCollection(Boolean(groupId));
  return isCollectionOnEngine('groups')
    ? { group: engine.groups.find(group => group.id === groupId) ?? null, loading: engine.loading, error: engine.error }
    : { group: legacy.group, loading: legacy.loading, error: legacy.error };
}
