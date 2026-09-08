import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

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
import { queuedMutation, refusedWrite, useWriteRecovery, type WriteSubmission } from '@/utils/recoverableWrite';

import type { UserSettings } from '@/models/models';
import type { ModelPreference } from '@/services/userSettings.service';
import type { FunctionModelPreference } from '@/services/userSettings.service';
import type { FirstDayOfWeek } from '@/utils/weekStart';

const SETTINGS_PREFIX = ['user-settings'];
const buildQueryKey = (userId: string | null | undefined) => ['user-settings', userId ?? null];

/** Shared persisted settings read for both feature access and the settings editor. */
export function useUserSettingsQuery(userId: string | null | undefined) {
  return useServerFirstQuery<UserSettings | null>({
    queryKey: buildQueryKey(userId),
    queryFn: () => (userId ? getUserSettings(userId) : Promise.resolve(null)),
    enabled: Boolean(userId),
  });
}

export function useUserSettings(userId: string | null | undefined) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const settingsQuery = useUserSettingsQuery(userId);

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

  const updateCachedSettings = async (patch: Partial<UserSettings>) => {
    await queryClient.cancelQueries({ queryKey: buildQueryKey(userId) });
    const previous = queryClient.getQueryData<UserSettings | null>(buildQueryKey(userId));
    patchSettings(patch);
    return { previous };
  };

  const mutationCallbacks = {
    onError: (_error: unknown, _variables: unknown, context: { previous: UserSettings | null | undefined } | undefined) =>
      revert(context?.previous),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_PREFIX }),
  };

  const updatePrepModeMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.prepMode,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) => updatePrepModeAccess(uid, value),
    onMutate: ({ value }) => updateCachedSettings({ enablePrepMode: value }),
  });

  const updateAudioGenerationMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.audioGeneration,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) =>
      updateAudioGenerationAccess(uid, value),
    onMutate: ({ value }) => updateCachedSettings({ enableAudioGeneration: value }),
  });

  const updateStructurePreviewMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.structurePreview,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) =>
      updateStructurePreviewAccess(uid, value),
    onMutate: ({ value }) => updateCachedSettings({ enableStructurePreview: value }),
  });

  const updateFirstDayOfWeekMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.firstDayOfWeek,
    mutationFn: ({ userId: uid, value }: { userId: string; value: FirstDayOfWeek }) =>
      updateFirstDayOfWeek(uid, value),
    onMutate: ({ value }) => updateCachedSettings({ firstDayOfWeek: value }),
  });

  const updateShowAppVersionMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.showAppVersion,
    mutationFn: ({ userId: uid, value }: { userId: string; value: boolean }) => updateShowAppVersion(uid, value),
    onMutate: ({ value }) => updateCachedSettings({ showAppVersion: value }),
  });

  const updateModelPreferenceMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.modelPreference,
    mutationFn: ({ userId: uid, preference }: { userId: string; preference: ModelPreference }) =>
      persistModelPreference(uid, preference),
    onMutate: ({ preference }) => updateCachedSettings(preference),
  });

  const updateFunctionModelPreferenceMutation = useMutation({
    ...mutationCallbacks,
    mutationKey: SETTINGS_MUTATION_KEYS.functionModelPreference,
    mutationFn: ({ userId: uid, preference }: { userId: string; preference: FunctionModelPreference }) =>
      persistFunctionModelPreference(uid, preference),
    onMutate: ({ preference }) => updateCachedSettings(preference),
    onSuccess: async () => {
      await Promise.all([
        mutationCallbacks.onSuccess(),
        queryClient.invalidateQueries({ queryKey: ['me', 'entitlement'] }),
      ]);
    },
  });

  // Named as a hook because it IS one: it calls useWriteRecovery. The previous name
  // broke the rules-of-hooks lint, and that rule is not cosmetic here — a helper that
  // hides a hook call is exactly how conditional hook order gets introduced later.
  const useSettingRecovery = <TVars,>(
    mutationKey: readonly unknown[],
    field: string,
    retry: (payload: TVars) => void
  ) =>
    useWriteRecovery<TVars>(queryClient, {
      mutationKey,
      fallbackTitleKey: 'errors.savingError',
      // A switch has no typed text, so the shared "your text is still here" wording
      // would promise something meaningless. This says what actually happened.
      refusalTitleKey: 'writeRecovery.refusedChange',
      recoveryText: () => undefined,
      toastId: (payload) => `write-recovery:settings:${field}:${(payload as { userId: string }).userId}`,
      owns: (payload) => (payload as { userId: string }).userId === userId,
      retry,
    });

  useSettingRecovery<{ userId: string; value: boolean }>(
    SETTINGS_MUTATION_KEYS.prepMode,
    'prep-mode',
    (payload) => updatePrepModeMutation.mutate(payload)
  );
  useSettingRecovery<{ userId: string; value: boolean }>(
    SETTINGS_MUTATION_KEYS.audioGeneration,
    'audio-generation',
    (payload) => updateAudioGenerationMutation.mutate(payload)
  );
  useSettingRecovery<{ userId: string; value: boolean }>(
    SETTINGS_MUTATION_KEYS.structurePreview,
    'structure-preview',
    (payload) => updateStructurePreviewMutation.mutate(payload)
  );
  useSettingRecovery<{ userId: string; value: FirstDayOfWeek }>(
    SETTINGS_MUTATION_KEYS.firstDayOfWeek,
    'first-day-of-week',
    (payload) => updateFirstDayOfWeekMutation.mutate(payload)
  );
  useSettingRecovery<{ userId: string; value: boolean }>(
    SETTINGS_MUTATION_KEYS.showAppVersion,
    'show-app-version',
    (payload) => updateShowAppVersionMutation.mutate(payload)
  );
  useSettingRecovery<{ userId: string; preference: ModelPreference }>(
    SETTINGS_MUTATION_KEYS.modelPreference,
    'model-preference',
    (payload) => updateModelPreferenceMutation.mutate(payload)
  );
  useSettingRecovery<{ userId: string; preference: FunctionModelPreference }>(
    SETTINGS_MUTATION_KEYS.functionModelPreference,
    'function-model-preference',
    (payload) => updateFunctionModelPreferenceMutation.mutate(payload)
  );

  // A toggle without a user id is an invalid call (settings require auth), not an
  // offline case — refuse it rather than buffering a write the server can't key.
  // `refusedWrite` and not a bare rejection: no mutation exists here, so no recovery
  // descriptor can ever speak for it, and the toggle would silently snap back.
  const guarded = (
    receipt: string,
    createRequest: (uid: string) => Promise<unknown>
  ): WriteSubmission =>
    userId
      ? queuedMutation(`${receipt}:${userId}`, createRequest(userId))
      : refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));

  return {
    settings: settingsQuery.data ?? null,
    loading: settingsQuery.isLoading,
    error: settingsQuery.error as Error | null,
    refresh: settingsQuery.refetch,
    updatePrepModeAccess: (enabled: boolean) =>
      guarded('settings:prep-mode', (uid) => updatePrepModeMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingPrepMode: updatePrepModeMutation.isPending,
    updateAudioGenerationAccess: (enabled: boolean) =>
      guarded('settings:audio-generation', (uid) => updateAudioGenerationMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingAudioGeneration: updateAudioGenerationMutation.isPending,
    updateStructurePreviewAccess: (enabled: boolean) =>
      guarded('settings:structure-preview', (uid) => updateStructurePreviewMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingStructurePreview: updateStructurePreviewMutation.isPending,
    updateFirstDayOfWeek: (firstDayOfWeek: FirstDayOfWeek) =>
      guarded('settings:first-day-of-week', (uid) => updateFirstDayOfWeekMutation.mutateAsync({ userId: uid, value: firstDayOfWeek })),
    updatingFirstDayOfWeek: updateFirstDayOfWeekMutation.isPending,
    updateShowAppVersion: (enabled: boolean) =>
      guarded('settings:show-app-version', (uid) => updateShowAppVersionMutation.mutateAsync({ userId: uid, value: enabled })),
    updatingShowAppVersion: updateShowAppVersionMutation.isPending,
    updateModelPreference: (preference: ModelPreference) =>
      guarded('settings:model-preference', (uid) => updateModelPreferenceMutation.mutateAsync({ userId: uid, preference })),
    updatingModelPreference: updateModelPreferenceMutation.isPending,
    updateFunctionModelPreference: (preference: FunctionModelPreference) =>
      guarded('settings:function-model-preference', (uid) => updateFunctionModelPreferenceMutation.mutateAsync({ userId: uid, preference })),
    updatingFunctionModelPreference: updateFunctionModelPreferenceMutation.isPending,
  };
}
