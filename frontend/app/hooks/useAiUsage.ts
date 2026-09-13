import { useCallback } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { actionBlockedLabelKey, isActionBlocked, type UsageAction } from '@/utils/usageGates';

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
  const blocked = {
    ai: usage?.aiBlocked ?? false,
    transcription: usage?.transcriptionBlocked ?? false,
    audio: usage?.audioBlocked ?? false,
  };

  return {
    aiRemaining: usage?.aiRemaining ?? 0,
    aiBlocked: blocked.ai,
    transcriptionRemaining: usage?.transcriptionSecondsRemaining ?? 0,
    transcriptionBlocked: blocked.transcription,
    audioBlocked: blocked.audio,
    /**
     * ASK ABOUT THE ACTION, NOT ABOUT A RESOURCE.
     *
     * A screen knows what the person is about to do; only `usageGates` knows what that costs.
     * Every caller that assembled the answer itself got it wrong the same way — naming the
     * resource it had in mind and missing the other one the route also admits.
     */
    blocked: (action: UsageAction) => isActionBlocked(action, blocked),
    blockedLabelKey: (action: UsageAction) => actionBlockedLabelKey(action, blocked),
    loading: query.isLoading,
    refresh,
  };
}
