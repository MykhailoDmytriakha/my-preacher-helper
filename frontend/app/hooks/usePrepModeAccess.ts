'use client';

import { useAuth } from '@/hooks/useAuth';
import { useUserSettingsQuery } from '@/hooks/useUserSettings';

/** Use the account-scoped persisted settings instead of a second blocking read. */
export function usePrepModeAccess() {
  const { user, loading: authLoading } = useAuth();
  const settingsQuery = useUserSettingsQuery(authLoading ? null : user?.uid);

  return {
    hasAccess: !authLoading && (!user?.uid || Boolean(settingsQuery.data?.enablePrepMode)),
    loading: Boolean(authLoading) || settingsQuery.isLoading,
  };
}
