import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  getUserSettings,
  updatePrepModeAccess,
  updateAudioGenerationAccess,
  updateStructurePreviewAccess,
  updateFirstDayOfWeek,
} from '@/services/userSettings.service';

import type { UserSettings } from '@/models/models';
import type { FirstDayOfWeek } from '@/utils/weekStart';

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

  const updateAudioGenerationMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      mutationGuard(() => {
        if (!userId) {
          throw new Error('No user');
        }
        return updateAudioGenerationAccess(userId, enabled);
      }),
    onSuccess: (_data, enabled) => {
      queryClient.setQueryData<UserSettings | null>(buildQueryKey(userId), (prev) =>
        prev ? { ...prev, enableAudioGeneration: enabled } : prev
      );
    },
  });

  const updateStructurePreviewMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      mutationGuard(() => {
        if (!userId) {
          throw new Error('No user');
        }
        return updateStructurePreviewAccess(userId, enabled);
      }),
    onSuccess: (_data, enabled) => {
      queryClient.setQueryData<UserSettings | null>(buildQueryKey(userId), (prev) =>
        prev ? { ...prev, enableStructurePreview: enabled } : prev
      );
    },
  });

  const updateFirstDayOfWeekMutation = useMutation({
    mutationFn: (firstDayOfWeek: FirstDayOfWeek) =>
      mutationGuard(() => {
        if (!userId) {
          throw new Error('No user');
        }
        return updateFirstDayOfWeek(userId, firstDayOfWeek);
      }),
    onSuccess: (_data, firstDayOfWeek) => {
      queryClient.setQueryData<UserSettings | null>(buildQueryKey(userId), (prev) =>
        prev
          ? { ...prev, firstDayOfWeek }
          : userId
            ? { id: userId, userId, language: 'en', isAdmin: false, firstDayOfWeek }
            : prev
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
    updateAudioGenerationAccess: updateAudioGenerationMutation.mutateAsync,
    updatingAudioGeneration: updateAudioGenerationMutation.isPending,
    updateStructurePreviewAccess: updateStructurePreviewMutation.mutateAsync,
    updatingStructurePreview: updateStructurePreviewMutation.isPending,
    updateFirstDayOfWeek: updateFirstDayOfWeekMutation.mutateAsync,
    updatingFirstDayOfWeek: updateFirstDayOfWeekMutation.isPending,
  };
}
