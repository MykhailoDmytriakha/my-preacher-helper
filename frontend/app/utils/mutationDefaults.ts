import { createGroup, deleteGroup, updateGroup } from '@/services/groups.service';

import type { Group } from '@/models/models';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Stable mutation keys shared between the hooks (where the in-session mutation
 * is defined) and {@link registerOfflineMutationDefaults} (where the resumable
 * default lives). They MUST be identical strings — React Query matches a
 * persisted/paused mutation back to its registered `mutationFn` by this key.
 */
export const GROUP_MUTATION_KEYS = {
  create: ['groups', 'create'] as const,
  update: ['groups', 'update'] as const,
  delete: ['groups', 'delete'] as const,
};

const GROUPS_QUERY_PREFIX = ['groups'];

/**
 * Why this exists (Stage 2 — offline write buffer):
 *
 * React Query persists paused/error mutations to IndexedDB and calls
 * `resumePausedMutations()` on reload. But a persisted mutation only carries
 * its `mutationKey` + serialized `variables` — the in-memory `mutationFn`
 * closure from `useMutation` is gone after a full page reload. Without a
 * `mutationFn` registered against that key, `resume` is a silent no-op and the
 * offline write is lost.
 *
 * `setMutationDefaults(key, { mutationFn })` registers the function to call for
 * any mutation with that key — including ones rehydrated from IndexedDB after a
 * reload. `onSuccess` re-fetches the authoritative server list so the optimistic
 * placeholder (a client-only temp row) is reconciled with the real record.
 *
 * Call this once, against the same QueryClient that PersistQueryClientProvider
 * uses, before mutations can be resumed.
 */
export function registerOfflineMutationDefaults(queryClient: QueryClient) {
  const invalidateGroups = () =>
    queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_PREFIX });

  queryClient.setMutationDefaults(GROUP_MUTATION_KEYS.create, {
    mutationFn: (payload: Omit<Group, 'id'>) => createGroup(payload),
    onSuccess: invalidateGroups,
  });

  queryClient.setMutationDefaults(GROUP_MUTATION_KEYS.update, {
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Group> }) =>
      updateGroup(id, updates),
    onSuccess: invalidateGroups,
  });

  queryClient.setMutationDefaults(GROUP_MUTATION_KEYS.delete, {
    mutationFn: (groupId: string) => deleteGroup(groupId),
    onSuccess: invalidateGroups,
  });
}
