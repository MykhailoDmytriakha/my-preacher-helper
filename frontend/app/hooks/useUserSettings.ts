import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { getUserSettings, updatePrepModeAccess } from '@/services/userSettings.service';

import type { UserSettings } from '@/models/models';

const buildQueryKey = (userId: string | null | undefined) => ['user-settings', userId ?? null];

export function useUserSettings(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const settingsQuery = useServerFirstQuery<UserSettings | null>({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getUserSettings(userId) : Promise.resolve(null)),
    enabled: Boolean(userId),
  });

  const mutationGuard = useCallback(
    async <TResult>(action: () => Promise<TResult>) => {
      if (!isOnline) {
        throw new Error('Offline: operation not available.');
      }
      return action();
    },
    [isOnline]
  );

  const updatePrepModeMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      mutationGuard(() => {
        if (!userId) {
          throw new Error('No user');
        }
        return updatePrepModeAccess(userId, enabled);
      }),
    onSuccess: (_data, enabled) => {
      queryClient.setQueryData<UserSettings | null>(buildQueryKey(userId), (prev) =>
        prev ? { ...prev, enablePrepMode: enabled } : prev
      );
    },
  });

  return {
    settings: settingsQuery.data ?? null,
    loading: settingsQuery.isLoading,
    error: settingsQuery.error as Error | null,
    refresh: settingsQuery.refetch,
    updatePrepModeAccess: updatePrepModeMutation.mutateAsync,
    updatingPrepMode: updatePrepModeMutation.isPending,
  };
}
