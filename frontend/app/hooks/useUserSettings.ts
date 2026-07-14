import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  getUserSettings,
  updatePrepModeAccess,
  updateAudioGenerationAccess,
  updateStructurePreviewAccess,
  updateShowAppVersion,
  updateFirstDayOfWeek,
  updateFunctionModelPreference as persistFunctionModelPreference,
  updateModelPreference as persistModelPreference,
} from '@/services/userSettings.service';
import { SETTINGS_MUTATION_KEYS } from '@/utils/mutationDefaults';

import type { UserSettings } from '@/models/models';
import type { ModelPreference } from '@/services/userSettings.service';
import type { FunctionModelPreference } from '@/services/userSettings.service';
import type { FirstDayOfWeek } from '@/utils/weekStart';

const SETTINGS_PREFIX = ['user-settings'];
const buildQueryKey = (userId: string | null | undefined) => ['user-settings', userId ?? null];

export function useUserSettings(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const settingsQuery = useServerFirstQuery<UserSettings | null>({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getUserSettings(userId) : Promise.resolve(null)),
    enabled: Boolean(userId),
  });

  // Each toggle is offline-buffered: mutationKey ties it to its resumable default
  // (mutationDefaults.ts) so a toggle flipped offline survives reload + replays on
  // reconnect; onMutate flips the cached value instantly; onError reverts. Setting
  // a boolean is naturally idempotent, so a replayed toggle cannot duplicate.
  const patchSettings = (patch: Partial<UserSettings>) =>
    queryClient.setQueryData<UserSettings | null>(buildQueryKey(userId), (prev) =>
      prev
        ? { ...prev, ...patch }
        : userId
          ? ({ id: userId, userId, language: 'en', ...patch } as UserSettings)
          : prev
    );

  const revert = (previous: UserSettings | null | undefined) =>
    queryClient.setQueryData(buildQueryKey(userId), previous ?? null);

  const updatePrepModeMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.prepMode,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) => updatePrepModeAccess(uid, value),
    onMutate: async ({ value }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings({ enablePrepMode: value });
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  });

  const updateAudioGenerationMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.audioGeneration,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) =>
      updateAudioGenerationAccess(uid, value),
    onMutate: async ({ value }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings({ enableAudioGeneration: value });
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  });

  const updateStructurePreviewMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.structurePreview,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) =>
      updateStructurePreviewAccess(uid, value),
    onMutate: async ({ value }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings({ enableStructurePreview: value });
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  });

  const updateFirstDayOfWeekMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.firstDayOfWeek,
    mutationFn: ({ userId: uid, value }: { userId: string; value: FirstDayOfWeek }) =>
      updateFirstDayOfWeek(uid, value),
    onMutate: async ({ value }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings({ firstDayOfWeek: value });
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  });

  const updateShowAppVersionMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.showAppVersion,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) => updateShowAppVersion(uid, value),
    onMutate: async ({ value }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings({ showAppVersion: value });
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  });

  const updateModelPreferenceMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.modelPreference,
    mutationFn: ({ userId: uid, preference }: { userId: string; preference: ModelPreference }) =>
      persistModelPreference(uid, preference),
    onMutate: async ({ preference }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings(preference);
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  });

  const updateFunctionModelPreferenceMutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEYS.functionModelPreference,
    mutationFn: ({ userId: uid, preference }: { userId: string; preference: FunctionModelPreference }) =>
      persistFunctionModelPreference(uid, preference),
    onMutate: async ({ preference }) => {
      await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
      const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
      patchSettings(preference);
      return { previous };
    },
    onError: (_e, _v, ctx) => revert(ctx?.previous),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
        queryClient.invalidateQueries({ queryKey: ['me', 'entitlement'] }),
      ]);
    },
  });

  // A toggle without a user id is an invalid call (settings require auth), not an
  // offline case — reject it rather than buffering a write the server can't key.
  const guarded = <T,>(run: (uid: string) => Promise<T>): Promise<T> =>
    userId ? run(userId) : Promise.reject(new Error('No user'));

  return {
    settings: settingsQuery.data ?? null,
    loading: settingsQuery.isLoading,
    error: settingsQuery.error as Error | null,
    refresh: settingsQuery.refetch,
    updatePrepModeAccess: (enabled: boolean) =>
      guarded((uid) => updatePrepModeMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingPrepMode: updatePrepModeMutation.isPending,
    updateAudioGenerationAccess: (enabled: boolean) =>
      guarded((uid) => updateAudioGenerationMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingAudioGeneration: updateAudioGenerationMutation.isPending,
    updateStructurePreviewAccess: (enabled: boolean) =>
      guarded((uid) => updateStructurePreviewMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingStructurePreview: updateStructurePreviewMutation.isPending,
    updateFirstDayOfWeek: (firstDayOfWeek: FirstDayOfWeek) =>
      guarded((uid) => updateFirstDayOfWeekMutation.mutateAsync({ userId: uid, value: firstDayOfWeek })),
    updatingFirstDayOfWeek: updateFirstDayOfWeekMutation.isPending,
    updateShowAppVersion: (enabled: boolean) =>
      guarded((uid) => updateShowAppVersionMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingShowAppVersion: updateShowAppVersionMutation.isPending,
    updateModelPreference: (preference: ModelPreference) =>
      guarded((uid) => updateModelPreferenceMutation.mutateAsync({ userId: uid, preference })),
    updatingModelPreference: updateModelPreferenceMutation.isPending,
    updateFunctionModelPreference: (preference: FunctionModelPreference) =>
      guarded((uid) => updateFunctionModelPreferenceMutation.mutateAsync({ userId: uid, preference })),
    updatingFunctionModelPreference: updateFunctionModelPreferenceMutation.isPending,
  };
}
