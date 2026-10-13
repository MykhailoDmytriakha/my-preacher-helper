'use client';

import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';

/** Read-only chrome must not open its own editable copy of the group. */
export function useGroupRead(groupId: string) {
  const engine = useGroupsDataCollection(Boolean(groupId));
  return { group: engine.groups.find(group => group.id === groupId) ?? null, loading: engine.loading, error: engine.error };
}
