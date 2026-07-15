import { useCallback } from 'react';

import { useAuth } from '@/providers/AuthProvider';

import { useServerFirstQuery } from './useServerFirstQuery';
import { fetchUserEntitlement, USER_ENTITLEMENT_QUERY_KEY } from './useUserEntitlement';

export const AI_USAGE_QUERY_KEY = USER_ENTITLEMENT_QUERY_KEY;

/**
 * UI-only view of the server-enforced AI allowance.
 *
 * This deliberately does not read user settings or any local entitlement model.
 * `useServerFirstQuery` fetches the authenticated server route whenever possible;
 * when offline, React Query exposes the last server response until reconnect.
 */
export function useAiUsage() {
  const { user } = useAuth();
  const query = useServerFirstQuery({
    queryKey: [...AI_USAGE_QUERY_KEY, user?.uid ?? null],
    queryFn: () => fetchUserEntitlement(user!),
    enabled: Boolean(user),
    mode: 'server-first',
  });

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const usage = query.data?.usage;

  return {
    aiRemaining: usage?.aiRemaining ?? 0,
    aiBlocked: usage?.aiBlocked ?? false,
    transcriptionRemaining: usage?.transcriptionSecondsRemaining ?? 0,
    transcriptionBlocked: usage?.transcriptionBlocked ?? false,
    loading: query.isLoading,
    refresh,
  };
}
