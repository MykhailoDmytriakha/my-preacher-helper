'use client';

import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';

/** The caller's groups from the data engine (groups are engine-owned). */
export function useGroupsRead(userId?: string | null) {
  const engine = useGroupsDataCollection();
  return { ...engine, groups: userId ? engine.groups.filter(group => group.userId === userId) : engine.groups };
}
